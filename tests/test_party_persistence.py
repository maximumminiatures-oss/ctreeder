from copy import deepcopy
from datetime import timedelta

import pytest
from sqlmodel import Session, select

from app import app, engine, SavedCharacter
from party_persistence import SavedParty, party_name
from room_models import GameRoom, RoomMember, utcnow
from test_rooms import clients, post, create, join, character, dungeon, command
from test_account_recovery import form


def snapshot():
    source = dungeon()
    source.update(timers={"torchElapsedMs": 123456, "torchDurationMs": 3600000, "lightEverLit": True},
                  partyAssets={"gold": 12, "silver": 3, "copper": 4}, arcaneTime={"roundElapsedMs": 324})
    source["characters"] += [
        {**character("Disc", "disc"), "summon": {"kind": "floating-disc", "casterId": "host-char", "remainingMs": 12345}},
        {**character("Charmed Orc", "orc"), "companion": {"kind": "charmed", "charm": {"remainingMs": 54321}}},
        {**character("False Friend", "double"), "companion": {"kind": "doppelganger", "disguise": "Host"}},
    ]
    return source


def save(client, source=None, name="The Party"):
    return post(client, "/api/parties", {"name": name, "party_json": source or snapshot()})


def group(client, room, action="save_party", **kwargs):
    return post(client, f"/api/rooms/{room['id']}/group-action", {"action": action, **kwargs})


def test_party_roundtrip_private_metadata_and_timers(clients):
    host, guest, player = clients
    result = save(host)
    assert result.status_code == 201, result.json
    data = result.json
    stored = host.get(f"/api/parties/{data['id']}").json
    party = stored["party_json"]
    assert party["timers"] == snapshot()["timers"]
    assert party["partyAssets"] == snapshot()["partyAssets"]
    assert party["arcaneTime"] == snapshot()["arcaneTime"]
    assert party["characters"][1]["summon"]["remainingMs"] == 12345
    assert party["characters"][2]["companion"]["charm"]["remainingMs"] == 54321
    assert party["characters"][3]["companion"]["kind"] == "doppelganger"
    assert all(char["lineageId"] == char["id"] for char in party["characters"])
    assert "tiles" not in party and "groupAction" not in party
    assert host.get("/api/parties").json["results"][0]["character_count"] == 4
    assert player.get("/api/parties").json["results"] == []
    assert guest.get("/api/parties").status_code == 401
    for method in ("get", "delete"):
        result = player.get(f"/api/parties/{data['id']}") if method == "get" else post(player, f"/api/parties/{data['id']}", {"revision": 1}, "delete")
        assert result.status_code == 404


def test_party_delete_revision_recovery_export_and_account_delete(clients):
    host, _, player = clients
    saved = save(host).json
    path = f"/api/parties/{saved['id']}"
    assert post(host, path, {}, "delete").status_code == 409
    assert post(host, path, {"revision": 1}, "delete").status_code == 200
    assert host.get(path).status_code == 404
    assert host.get("/api/parties").json["results"] == []
    assert any(item["kind"] == "party" for item in host.get("/api/recovery").json["results"])
    assert post(player, f"/api/recovery/party/{saved['id']}", {}).status_code == 404
    assert post(host, f"/api/recovery/party/{saved['id']}", {}).status_code == 200
    assert host.get(path).json["revision"] == 3
    assert host.get("/api/account/export").json["parties"][0]["id"] == saved["id"]
    assert form(host, "/account", {"action": "recovery", "current_password": "secret"}).status_code == 200
    assert host.get(path).status_code == 200  # regenerating recovery codes must not delete parties
    assert form(host, "/account", {"action": "delete", "current_password": "secret", "confirmation": "host"}).status_code == 302
    with Session(engine) as db:
        assert db.exec(select(SavedParty)).all() == []


@pytest.mark.parametrize("name", ["", "  ", "x" * 81, "Bad\x00Name", "Bad\u202eName", "<script>", "shit party", "sh1t party"])
def test_party_names_validate_locally_without_echoing_input(clients, name):
    host, _, _ = clients
    result = save(host, name=name)
    assert result.status_code == 400
    assert name not in result.json.get("message", "") or not name.strip()


def test_identity_words_are_not_automatically_offensive():
    assert party_name("Queer Adventurers") == "Queer Adventurers"


def test_party_shape_limits_and_duplicate_lineage(clients):
    host, _, _ = clients
    for characters in ([], [character(str(i), str(i)) for i in range(17)],
                       [{**character("A", "a"), "lineageId": "one"}, {**character("B", "b"), "lineageId": "one"}]):
        result = save(host, {"characters": characters})
        assert result.status_code == 400, result.json


@pytest.mark.parametrize("body,content_type", [
    ("[1]", "application/json"),
    ("[]", "application/json"),
    ('"party"', "application/json"),
    ('""', "application/json"),
    ("7", "application/json"),
    ("0", "application/json"),
    ("true", "application/json"),
    ("false", "application/json"),
    ("null", "application/json"),
    ("{", "application/json"),
    ("", "application/json"),
    ('{"name":"Wrong content type"}', "text/plain"),
])
def test_party_save_rejects_malformed_or_nonobject_bodies_without_changing_saves(clients, body, content_type):
    host, _, _ = clients
    saved = save(host).json
    token = host.get("/api/session").json["csrf_token"]
    result = host.post("/api/parties", data=body, content_type=content_type,
                       headers={"X-CSRFToken": token})
    assert result.status_code == 400, result.data
    assert result.json["error"] == "invalid_json"
    assert [item["id"] for item in host.get("/api/parties").json["results"]] == [saved["id"]]
    assert host.get(f"/api/parties/{saved['id']}").json["party_json"] == saved["party_json"]
    with Session(engine) as db:
        assert len(db.exec(select(SavedParty)).all()) == 1


def test_party_quotas_count_soft_deleted_payloads_and_limit_save_churn(clients, monkeypatch):
    import storage_limits
    import party_persistence
    host, _, _ = clients
    monkeypatch.setattr(storage_limits, "MAX_ACCOUNT_BYTES", 1)
    assert save(host).status_code == 409
    with Session(engine) as db:
        assert db.exec(select(SavedParty)).all() == []
    monkeypatch.setattr(storage_limits, "MAX_ACCOUNT_BYTES", 64 * 1024 * 1024)
    monkeypatch.setattr(party_persistence, "MAX_RETAINED_PARTIES", 1)
    first = save(host).json
    assert post(host, f"/api/parties/{first['id']}", {"revision": 1}, "delete").status_code == 200
    assert save(host).status_code == 409
    with Session(engine) as db:
        from storage_limits import storage_available
        from app import SavedRun, User
        owner = db.exec(select(User).where(User.username == "host")).one()
        monkeypatch.setattr(storage_limits, "MAX_ACCOUNT_BYTES", 1)
        assert not storage_available(db, owner.id, SavedRun, SavedCharacter)


def test_save_party_requires_all_connected_votes_and_uses_server_snapshot(clients):
    host, guest, player = clients
    room = create(host)
    guest_view = join(guest, room)
    player_view = join(player, room)
    assert group(guest, room).status_code == 401
    start = group(player, room, name="Party of Friends", state_json={"characters": []})
    assert start.status_code == 200, start.json
    proposal = start.json["group_action"]
    assert proposal["status"] == "pending"
    assert len(proposal["requiredMemberIds"]) == 3
    assert proposal["acceptedMemberIds"] == [player_view["current_player_id"]]
    assert player.get("/api/parties").json["results"] == []
    assert group(host, room, vote_id=proposal["id"], accept=True).json["group_action"]["status"] == "pending"
    final = group(guest, room, vote_id=proposal["id"], accept=True)
    assert final.status_code == 200, final.json
    assert final.json["group_action"]["status"] == "completed"
    assert host.get("/api/parties").json["results"] == []
    saved = player.get("/api/parties").json["results"]
    assert len(saved) == 1
    actual = player.get(f"/api/parties/{saved[0]['id']}").json["party_json"]
    assert actual["characters"][0]["name"] == "Host"
    assert actual["name"] == "Party of Friends"
    assert "ownership" not in actual and "groupAction" not in actual
    assert group(guest, room, vote_id=proposal["id"], accept=True).json["group_action"]["status"] == "completed"
    assert len(player.get("/api/parties").json["results"]) == 1
    assert guest_view["current_player_id"] in final.json["group_action"]["acceptedMemberIds"]


@pytest.mark.parametrize("reason", ["decline", "leave", "expire", "disconnect", "new_player"])
def test_group_action_never_assumes_consent(clients, reason):
    host, guest, player = clients
    room = create(host)
    joined = join(guest, room)
    vote = group(host, room).json["group_action"]
    if reason == "decline":
        result = group(guest, room, vote_id=vote["id"], accept=False)
    elif reason == "leave":
        assert post(guest, f"/api/rooms/{room['id']}/leave", {}).status_code == 200
        result = group(host, room, vote_id=vote["id"], accept=True)
    elif reason == "new_player":
        join(player, room)
        result = group(guest, room, vote_id=vote["id"], accept=True)
    else:
        with Session(engine) as db:
            if reason == "expire":
                stored = db.get(GameRoom, room["id"])
                proposal = {**stored.state_json["groupAction"], "expiresAt": (utcnow() - timedelta(seconds=1)).isoformat()}
                stored.state_json = {**stored.state_json, "groupAction": proposal}
                db.add(stored)
            else:
                member = db.get(RoomMember, joined["current_player_id"])
                member.last_seen_at = utcnow() - timedelta(minutes=2)
                db.add(member)
            db.commit()
        result = group(guest, room, vote_id=vote["id"], accept=True)
    assert result.status_code == 200, result.json
    assert result.json["group_action"]["status"] == "cancelled"
    assert host.get("/api/parties").json["results"] == []


def test_group_action_unjoined_stale_ids_and_general_command_bypass(clients):
    host, guest, player = clients
    room = create(host)
    join(guest, room)
    proposal = group(host, room).json["group_action"]
    assert group(player, room, vote_id=proposal["id"], accept=True).status_code == 404
    assert group(guest, room, vote_id="wrong", accept=True).status_code == 409
    assert group(guest, room, vote_id=proposal["id"], accept="yes").status_code == 400
    assert group(guest, room, vote_id=proposal["id"], accept=None).status_code == 400
    assert command(guest, room, "descend", confirmed=True).status_code == 400
    assert post(host, "/api/parties", {"name": "Bypass", "room_id": room["id"], "state_json": dungeon()}).status_code == 409


def test_guest_can_initiate_descent_but_only_unanimous_vote_calls_runtime(clients, monkeypatch):
    import rooms
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    called = []
    def apply(state, command):
        called.append(deepcopy(command))
        state = deepcopy(state)
        state["level"] += 1
        return {"state_json": state, "message": "Descended."}
    monkeypatch.setattr(rooms.game_runtime, "apply", apply)
    start = group(guest, room, action="descend")
    assert start.status_code == 200, start.json
    assert called == []
    done = group(host, room, action="descend", vote_id=start.json["group_action"]["id"], accept=True)
    assert done.status_code == 200, done.json
    assert called == [{"type": "descend", "confirmed": True}]
    assert done.json["state_json"]["level"] == 2
    assert done.json["ownership"] == room["ownership"]
    assert done.json["viewer_visibility"] == {}
    assert done.json["group_action"]["status"] == "completed"
    again = group(host, room, action="descend", vote_id=start.json["group_action"]["id"], accept=True)
    assert again.status_code == 200 and len(called) == 1


def test_rejected_descent_rolls_back_without_advancing_or_dropping_characters(clients, monkeypatch):
    import rooms
    host, _, _ = clients
    room = create(host)
    monkeypatch.setattr(rooms.game_runtime, "apply", lambda state, command: {"state_json": state, "message": "Gather your party before descending deeper."})
    result = group(host, room, action="descend")
    assert result.status_code == 400
    assert host.get(f"/api/rooms/{room['id']}").json["state_json"]["level"] == 1


def test_saved_versions_share_lineage_and_room_duplicate_is_rejected(clients):
    host, _, _ = clients
    original = character("Original", "original")
    first = post(host, "/api/characters", {"name": "First Save", "character_json": original}).json
    second = post(host, "/api/characters", {"name": "Second Save", "character_json": original}).json
    assert first["character_json"]["lineageId"] == "original"
    listed = host.get("/api/characters").json["results"]
    assert all(item["lineageId"] == "original" for item in listed)
    room = create(host)
    assert command(host, room, "import", saved_character_id=first["id"]).status_code == 200
    result = command(host, room, "import", saved_character_id=second["id"])
    assert result.status_code == 409 and result.json["error"] == "duplicate_character"
    changed = post(host, f"/api/characters/{second['id']}", {"revision": 1, "character_json": {**original, "id": "new", "lineageId": "forged"}}, "put")
    assert changed.status_code == 200
    assert host.get(f"/api/characters/{second['id']}").json["character_json"]["lineageId"] == "original"


def test_create_room_cannot_seed_a_forged_approved_proposal(clients):
    host, _, _ = clients
    state = dungeon()
    state["groupAction"] = {"status": "completed", "action": "descend", "acceptedMemberIds": ["fake"]}
    room = post(host, "/api/rooms", {"state_json": state})
    assert room.status_code == 201, room.json
    assert room.json["group_action"] is None


def test_expired_party_recovery_retention_is_owner_scoped(clients, monkeypatch):
    import party_persistence
    host, _, player = clients
    mine = save(host).json
    theirs = save(player).json
    with Session(engine) as db:
        for identifier in (mine["id"], theirs["id"]):
            record = db.get(SavedParty, identifier)
            record.deleted_at = utcnow() - timedelta(days=31)
            db.add(record)
        db.commit()
    monkeypatch.setattr(party_persistence, "MAX_RETAINED_PARTIES", 1)
    assert save(host).status_code == 201
    with Session(engine) as db:
        assert db.get(SavedParty, mine["id"]) is None
        assert db.get(SavedParty, theirs["id"]) is not None


def test_vote_quota_failure_does_not_save_or_complete(clients, monkeypatch):
    import storage_limits
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    proposal = group(host, room).json["group_action"]
    monkeypatch.setattr(storage_limits, "MAX_ACCOUNT_BYTES", 1)
    result = group(guest, room, vote_id=proposal["id"], accept=True)
    assert result.status_code == 409
    assert host.get("/api/parties").json["results"] == []
    assert host.get(f"/api/rooms/{room['id']}").json["group_action"]["status"] == "pending"


def test_lapsed_member_cannot_restore_consent_by_heartbeat(clients):
    host, guest, _ = clients
    room = create(host)
    joined = join(guest, room)
    proposal = group(host, room).json["group_action"]
    with Session(engine) as db:
        member = db.get(RoomMember, joined["current_player_id"])
        member.last_seen_at = utcnow() - timedelta(minutes=2)
        db.add(member)
        db.commit()
    assert post(guest, f"/api/rooms/{room['id']}/presence", {}).status_code == 200
    result = group(guest, room, vote_id=proposal["id"], accept=True)
    assert result.status_code == 200
    assert result.json["group_action"]["status"] == "cancelled"
    assert host.get("/api/parties").json["results"] == []


def test_party_table_bootstrap_is_additive_and_idempotent(clients):
    from app import bootstrap_database
    host, _, _ = clients
    saved = post(host, "/api/characters", {"name": "Keep Me", "character_json": character()}).json
    SavedParty.__table__.drop(engine)
    bootstrap_database()
    bootstrap_database()
    assert host.get(f"/api/characters/{saved['id']}").json["character_json"]["name"] == "Host"
    assert save(host).status_code == 201


def test_malformed_delete_is_rejected_and_csrf_is_required(clients):
    host, _, _ = clients
    saved = save(host).json
    path = f"/api/parties/{saved['id']}"
    assert post(host, path, [1], "delete").status_code == 400
    assert host.delete(path, json={"revision": 1}).status_code == 400
    assert host.get(path).status_code == 200


@pytest.mark.parametrize("role", ["host", "player"])
@pytest.mark.parametrize("room_field", ["omitted", "null"])
def test_direct_party_save_requires_consensus_for_server_derived_online_membership(clients, role, room_field):
    host, _, player = clients
    room = create(host)
    join(player, room)
    caller = host if role == "host" else player
    source = caller.get(f"/api/rooms/{room['id']}").json["state_json"]
    payload = {"name": "No Vote", "party_json": source}
    if room_field == "null":
        payload["room_id"] = None
    result = post(caller, "/api/parties", payload)
    assert result.status_code == 409, result.json
    assert result.json["error"] == "consensus_required"
    assert caller.get("/api/parties").json["results"] == []
    with Session(engine) as db:
        assert db.exec(select(SavedParty)).all() == []
        assert db.get(GameRoom, room["id"]).state_json.get("groupAction") is None


@pytest.mark.parametrize("membership", ["offline", "left", "kicked", "closed"])
def test_direct_party_save_allowed_without_online_active_membership_in_open_room(clients, membership):
    host, _, player = clients
    room = create(host)
    member = join(player, room)
    with Session(engine) as db:
        record = db.get(RoomMember, member["current_player_id"])
        if membership == "offline":
            record.last_seen_at = utcnow() - timedelta(minutes=2)
        elif membership in {"left", "kicked"}:
            record.status = membership
        else:
            stored = db.get(GameRoom, room["id"])
            stored.closed_at = utcnow()
            db.add(stored)
        db.add(record)
        db.commit()
    result = save(player)
    assert result.status_code == 201, result.json


def test_unrelated_online_account_does_not_block_local_party_save(clients):
    host, _, player = clients
    create(host)
    assert save(player).status_code == 201


def test_online_membership_in_any_open_room_blocks_direct_party_save(clients):
    host, _, player = clients
    first = create(host)
    old_member = join(player, first)
    with Session(engine) as db:
        record = db.get(RoomMember, old_member["current_player_id"])
        record.last_seen_at = utcnow() - timedelta(minutes=2)
        db.add(record)
        db.commit()
    second = create(host)
    join(player, second)
    # An unrelated local snapshot and no room_id must not change the decision.
    result = save(player)
    assert result.status_code == 409 and result.json["error"] == "consensus_required"


def test_authenticated_guest_identity_also_requires_consensus(clients):
    host, guest, player = clients
    room = create(host)
    join(guest, room)
    player.set_cookie("sd_guest", guest.get_cookie("sd_guest").value)
    result = save(player)
    assert result.status_code == 409 and result.json["error"] == "consensus_required"


def test_leaving_room_reenables_local_party_save_and_group_save_still_works(clients):
    host, _, player = clients
    room = create(host)
    join(player, room)
    assert save(player).status_code == 409
    proposal = group(player, room, name="Consented Party").json["group_action"]
    completed = group(host, room, vote_id=proposal["id"], accept=True)
    assert completed.status_code == 200, completed.json
    assert completed.json["group_action"]["status"] == "completed"
    assert len(player.get("/api/parties").json["results"]) == 1
    assert post(player, f"/api/rooms/{room['id']}/leave", {}).status_code == 200
    assert save(player, name="Local Party").status_code == 201
