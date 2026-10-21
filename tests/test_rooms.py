import os
import uuid
from copy import deepcopy

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

import pytest
from sqlmodel import SQLModel, Session, select
from werkzeug.security import generate_password_hash
from app import app, engine, User, SavedCharacter
from room_models import GameRoom, RoomMember, SaveCheckpoint


def character(name="Host", identifier=None):
    identifier = identifier or f"{name.lower()}-char"
    return {"id": identifier, "name": name, "className": "Fighter", "class": "Fighter",
            "level": 1, "hp": 8, "maxHitPoints": 8, "armorClass": 12,
            "stats": {key: 10 for key in ("STR", "DEX", "CON", "INT", "WIS", "CHA")},
            "gear": [], "attacks": ["Sword: +2, 1d6, close"], "x": 2, "y": 2, "roomId": "r1"}


def dungeon():
    return {"seed": 123, "level": 1, "map": {"width": 7, "height": 7},
            "generation": {"entranceRoomId": "r1"},
            "tiles": [{"x": x, "y": y, "type": "floor", "roomId": "r1"} for y in range(7) for x in range(7)],
            "rooms": [{"id": "r1", "x": 0, "y": 0, "width": 7, "height": 7}],
            "visibility": {"exploredEver": [f"{x},{y}" for y in range(7) for x in range(7)]},
            "entities": [{"id": "stairs", "type": "stairs", "subtype": "up", "x": 2, "y": 2, "roomId": "r1"}],
            "characters": [character()], "activeCharacterId": "host-char",
            "player": {"x": 2, "y": 2, "roomId": "r1", "torchLit": False}, "run": {}}


@pytest.fixture
def clients():
    app.config.update(TESTING=True, WTF_CSRF_ENABLED=True)
    SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as db:
        host = User(username="host", password_hash=generate_password_hash("secret"))
        player = User(username="player", password_hash=generate_password_hash("secret"))
        db.add(host)
        db.add(player)
        db.commit()
        ids = host.get_id(), player.get_id()
    host, guest, player = app.test_client(), app.test_client(), app.test_client()
    for client, username in ((host, "host"), (player, "player")):
        token = client.get("/api/session").json["csrf_token"]
        response = client.post("/login", data={"username": username, "password": "secret", "csrf_token": token})
        assert response.status_code == 302
    yield host, guest, player
    app.config["WTF_CSRF_ENABLED"] = False


def post(client, path, data, method="post"):
    token = client.get("/api/session").json["csrf_token"]
    return getattr(client, method)(path, json=data, headers={"X-CSRFToken": token})


def create(host, **options):
    result = post(host, "/api/rooms", {"state_json": dungeon(), "options": options})
    assert result.status_code == 201, result.json
    return result.json


def join(client, room):
    result = post(client, "/api/rooms/join", {"code": room["invite_code"]})
    assert result.status_code == 200, result.json
    return result.json


def command(client, room, action_type, **args):
    current = client.get(f"/api/rooms/{room['id']}").json
    return post(client, f"/api/rooms/{room['id']}/commands", {
        "revision": current["revision"], "request_id": uuid.uuid4().hex,
        "command": {"type": action_type, **args}})


def test_guest_owns_import_and_cannot_invite_or_control_host(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    assert len(room["invite_code"]) == 4 and room["invite_code"].isalnum()
    member = join(guest, room)
    assert member["owned_character_ids"] == []
    assert "invite_code" not in member and "invite_url" not in member
    assert post(guest, f"/api/rooms/{room['id']}/invite", {}).status_code == 404
    assert command(guest, room, "move", character_id="host-char", dx=1, dy=0).status_code == 403
    imported = command(guest, room, "import", character_json=character("Guest"))
    assert imported.status_code == 200, imported.json
    owned = imported.json["owned_character_ids"][0]
    moved = command(guest, room, "move", character_id=owned, dx=1, dy=0)
    assert moved.status_code == 200, moved.json
    host_view = host.get(f"/api/rooms/{room['id']}").json
    assert host_view["state_json"] == moved.json["state_json"]
    assert command(host, room, "move", character_id=owned, dx=1, dy=0).status_code == 403
    assert post(guest, f"/api/rooms/{room['id']}/characters/{owned}/save", {}).status_code == 401


def test_new_condition_commands_cannot_control_another_players_character(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    for action in ("revive", "stand", "wake", "phase", "steal", "steal_target", "steal_take", "attack_empty", "attack_door", "advance_choice", "level_up", "read_wand", "mishap_action", "pit_action"):
        response = command(guest, room, action, character_id="host-char", target_id="host-char")
        assert response.status_code == 403, (action, response.json)


def test_rope_rescue_controls_only_owned_helper_but_can_rescue_another_players_character(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    imported = command(guest, room, "import", character_json=character("Guest"))
    guest_id = imported.json["owned_character_ids"][0]
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        helper = next(item for item in state["characters"] if item["id"] == "host-char")
        helper.update(x=2, y=2, gear=[{"name": "Rope", "quantity": 1, "slots": 1}])
        target = next(item for item in state["characters"] if item["id"] == guest_id)
        target.update(x=3, y=2, hp=8, dyingRounds=0, conditions={"sinkhole": "pit", "prone": True})
        state["entities"].append({"id": "pit", "type": "feature", "subtype": "pit", "x": 3, "y": 2,
                                  "cells": [{"x": 3, "y": 2}], "revealed": True, "visible": True})
        stored.state_json = state
        db.add(stored)
        db.commit()
    denied = command(guest, room, "pit_action", character_id="host-char", action="rescue", target_id=guest_id)
    assert denied.status_code == 403
    rescued = command(host, room, "pit_action", character_id="host-char", action="rescue", target_id=guest_id)
    assert rescued.status_code == 200, rescued.json
    target = next(item for item in rescued.json["state_json"]["characters"] if item["id"] == guest_id)
    assert not target["conditions"].get("sinkhole")
    assert (target["x"], target["y"]) not in {(2, 2), (3, 2)}
    assert target["hp"] == 8
    assert guest_id in guest.get(f"/api/rooms/{room['id']}").json["owned_character_ids"]


def test_confirmed_party_attack_uses_owned_attacker_and_damages_other_players_character(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    imported = command(guest, room, "import", character_json=character("Guest"))
    guest_id = imported.json["owned_character_ids"][0]
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        state["characters"][0].update(equipmentInitialized=True, lightSpellLit=True,
                                       gear=[{"name": "Dagger", "type": "weapon", "equipped": True, "attackBonus": 80, "damage": "1"}])
        victim = next(item for item in state["characters"] if item["id"] == guest_id)
        victim.update(x=3, y=2)
        stored.state_json = state
        db.add(stored)
        db.commit()
    assert command(host, room, "attack", character_id="host-char", target_id=guest_id, attack_index=0).status_code == 400
    result = command(host, room, "attack", character_id="host-char", target_id=guest_id, attack_index=0, confirmed=True)
    assert result.status_code == 200, result.json
    victim = next(item for item in result.json["state_json"]["characters"] if item["id"] == guest_id)
    assert victim["hp"] == 7, result.json.get("message")


def test_reaction_is_owned_and_server_created_companion_inherits_speaker(clients, monkeypatch):
    import rooms
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        state["encounterPrompt"] = {"monsterId": "peasant", "speakerId": "host-char"}
        stored.state_json = state
        db.add(stored)
        db.commit()
    assert command(guest, room, "reaction", character_id="host-char", talk=True).status_code == 403
    def apply(state, action):
        result = deepcopy(state)
        result["encounterPrompt"] = None
        result["characters"].append({**character("Peasant", "companion-peasant"),
            "companion": {"kind": "friendly", "controllerCharacterId": "host-char"}})
        return {"state_json": result, "message": "Friendly"}
    monkeypatch.setattr(rooms.game_runtime, "apply", apply)
    result = command(host, room, "reaction", character_id="host-char", talk=True)
    assert result.status_code == 200, result.json
    assert "companion-peasant" in result.json["owned_character_ids"]


def test_halfling_ability_cannot_control_another_members_character(clients):
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    assert command(guest, room, "ancestry_invisibility", character_id="host-char").status_code == 403


def test_gear_reordering_requires_ownership_and_keeps_the_inventory(clients):
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    with Session(engine) as db:
        stored = db.get(GameRoom, room['id'])
        state = deepcopy(stored.state_json)
        state['characters'][0]['gear'] = [{'name':'Dagger'}, {'name':'Shortsword'}]
        stored.state_json = state
        db.add(stored)
        db.commit()
    assert command(guest, room, 'reorder_gear', character_id='host-char', from_index=0, to_index=1).status_code == 403
    result = command(host, room, 'reorder_gear', character_id='host-char', from_index=0, to_index=1)
    assert result.status_code == 200, result.json
    assert [item['name'] for item in result.json['state_json']['characters'][0]['gear']] == ['Shortsword','Dagger']


def test_critical_spell_choice_belongs_to_caster_not_healing_target_owner(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    imported = command(guest, room, "import", character_json=character("Guest"))
    target_id = imported.json["owned_character_ids"][0]
    with Session(engine) as db:
        saved = db.get(GameRoom, room["id"])
        state = deepcopy(saved.state_json)
        state["characters"][0]["pendingSpell"] = {"spell": "cure wounds", "targetId": target_id, "diceCount": 1}
        target = next(char for char in state["characters"] if char["id"] == target_id)
        target.update(hp=1, maxHitPoints=20)
        saved.state_json = state
        db.add(saved)
        db.commit()
    assert command(guest, room, "resolve_spell", character_id="host-char", choice="double-total").status_code == 403
    result = command(host, room, "resolve_spell", character_id="host-char", choice="double-total")
    assert result.status_code == 200, result.json
    healed = next(char for char in result.json["state_json"]["characters"] if char["id"] == target_id)
    assert 3 <= healed["hp"] <= 13
    assert command(host, room, "resolve_spell", character_id="host-char", choice="double-total").status_code == 400


def test_rest_requires_all_connected_members_even_guest_without_character(clients):
    host, guest, _ = clients
    room = create(host)
    guest_view = join(guest, room)
    with Session(engine) as db:
        saved = db.get(GameRoom, room["id"])
        state = deepcopy(saved.state_json)
        state["characters"][0]["gear"] = [{"name": "Rations", "quantity": 1}, {"name": "Torch", "quantity": 3}]
        saved.state_json = state
        db.add(saved)
        db.commit()
    proposed = command(host, room, "rest", character_id="host-char", rest_member_ids=["forged"])
    assert proposed.status_code == 200, proposed.json
    rest = proposed.json["state_json"]["rest"]
    assert rest["phase"] == "voting"
    assert guest_view["current_player_id"] in rest["requiredMemberIds"]
    assert "forged" not in rest["requiredMemberIds"]
    assert command(host, room, "move", character_id="host-char", dx=1, dy=0).status_code == 400
    accepted = command(guest, room, "rest_accept", rest_member_id="forged", character_id="host-char")
    assert accepted.status_code == 200, accepted.json
    assert accepted.json["state_json"]["rest"]["phase"] == "sleeping"
    scene = accepted.json["state_json"]["rest"]["scene"]
    assert scene["placements"][0]["characterId"] == "host-char"
    assert (scene["placements"][0]["x"], scene["placements"][0]["y"]) != (scene["x"], scene["y"])
    assert host.get(f"/api/rooms/{room['id']}").json["state_json"]["rest"]["scene"] == scene
    assert accepted.json["state_json"]["characters"][0]["gear"] == []
    assert command(guest, room, "rest_cancel").status_code == 200


def test_level_up_is_owned_authoritative_and_cannot_reroll(clients):
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    with Session(engine) as db:
        saved = db.get(GameRoom, room["id"])
        state = deepcopy(saved.state_json)
        state["characters"][0]["XP"] = 12
        saved.state_json = state
        db.add(saved)
        db.commit()
    assert command(guest, room, "level_up", character_id="host-char").status_code == 403
    result = command(host, room, "level_up", character_id="host-char")
    assert result.status_code == 200, result.json
    character = result.json["state_json"]["characters"][0]
    assert character["level"] == 2 and character["XP"] == 2
    assert character["maxHitPoints"] > 8
    assert command(host, room, "level_up", character_id="host-char").status_code == 400


def test_rest_watch_order_uses_verified_owners_not_client_supplied_ownership(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    guest_view = join(guest, room)
    imported = command(guest, room, "import", character_json=character("Guest"))
    assert imported.status_code == 200, imported.json
    guest_char = imported.json["owned_character_ids"][0]
    host_member = room["current_player_id"]
    guest_member = guest_view["current_player_id"]
    with Session(engine) as db:
        saved = db.get(GameRoom, room["id"])
        state = deepcopy(saved.state_json)
        second_host = character("Host Two", "host-two")
        second_guest = character("Guest Two", "guest-two")
        state["characters"] += [second_host, second_guest]
        for item in state["characters"]:
            item.update(roomId="r1", x=2, y=2)
            item["gear"] = [{"name": "Rations", "quantity": 1}, {"name": "Torch", "quantity": 1}]
        saved.state_json = state
        saved.ownership_json = {"host-char": host_member, "host-two": host_member,
                                guest_char: guest_member, "guest-two": guest_member}
        db.add(saved)
        db.commit()
    assert command(host, room, "rest", character_id="host-char", watch_order_ids=["forged"]).status_code == 400
    assert command(host, room, "rest", character_id="host-char", watch_order_ids=["host-char", "host-char"]).status_code == 400
    result = command(guest, room, "rest", character_id=guest_char,
                     watch_order_ids=["guest-two", guest_char, "host-two", "host-char"],
                     rest_ownership={"host-char": guest_member}, rest_member_order=["forged"])
    assert result.status_code == 200, result.json
    assert result.json["state_json"]["rest"]["watchOrderIds"] == ["guest-two", "host-two", guest_char, "host-char"]
    accepted = command(host, room, "rest_accept")
    assert accepted.status_code == 200, accepted.json
    assert accepted.json["state_json"]["rest"]["watchOrderIds"] == ["guest-two", "host-two", guest_char, "host-char"]
    assert accepted.json["state_json"]["rest"]["phase"] == "sleeping"


def test_only_missile_caster_owner_can_choose_fire_or_dismiss_and_retries_are_idempotent(clients):
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    with Session(engine) as db:
        saved = db.get(GameRoom, room["id"])
        state = deepcopy(saved.state_json)
        state["characters"][0].update(
            className="Wizard", spellsKnown="Magic Missile", lightRadius=6, lightSource="torch",
            gear=[{"name": "Torch", "lit": True, "equipped": True}],
            pendingSpell={"spell": "magic missile", "phase": "critical", "castNumber": 1,
                          "total": 1, "remaining": 1, "diceSides": 4, "spent": []})
        state["entities"].append({"id": "foe", "type": "monster", "name": "Foe", "hp": 100,
                                  "x": 4, "y": 2, "visible": True, "roomId": "r1",
                                  "hostile": True, "attitude": "combat", "attitudeChecked": True})
        saved.state_json = state
        db.add(saved)
        db.commit()
    for arguments in ({"choice": "two-missiles"}, {"target_id": "foe"}, {"dismiss": True}):
        assert command(guest, room, "resolve_spell", character_id="host-char", **arguments).status_code == 403
    chosen = command(host, room, "resolve_spell", character_id="host-char", choice="two-missiles")
    assert chosen.status_code == 200, chosen.json
    payload = {"revision": chosen.json["revision"], "request_id": uuid.uuid4().hex,
               "command": {"type": "resolve_spell", "character_id": "host-char", "target_id": "foe"}}
    path = f"/api/rooms/{room['id']}/commands"
    fired = post(host, path, payload)
    assert fired.status_code == 200, fired.json
    assert fired.json["state_json"]["characters"][0]["pendingSpell"]["remaining"] == 1
    retried = post(host, path, payload)
    assert retried.json["revision"] == fired.json["revision"]
    assert retried.json["state_json"] == fired.json["state_json"]


def test_door_click_cannot_borrow_an_adjacent_character_from_another_player(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    imported = command(guest, room, "import", character_json=character("Guest"))
    owned = imported.json["owned_character_ids"][0]
    with Session(engine) as db:
        saved_room = db.get(GameRoom, room["id"])
        state = deepcopy(saved_room.state_json)
        for char in state["characters"]:
            char.update(x=3 if char["id"] == owned else 1, y=2)
            if char["id"] == "host-char":
                char.update(lightSource="torch", lightRadius=6, equipmentInitialized=True,
                    gear=[{"name": "Torch", "lit": True, "equipped": True}])
        state["entities"].extend([
            {"id": "door", "type": "feature", "subtype": "door", "x": 4, "y": 2,
                "wallSide": "east", "orientation": "vertical", "doorState": "closed", "visible": True},
            {"id": "door-trap", "type": "trap", "targetType": "door", "targetEntityId": "door",
                "name": "Needle", "trigger": "Open door", "effect": "Damage"},
        ])
        saved_room.state_json = state
        db.add(saved_room)
        db.commit()
    refused = command(host, room, "interact", character_id="host-char", x=4, y=2)
    assert refused.status_code == 400, refused.json
    assert "next to the door" in refused.json["message"]
    assert command(host, room, "interact", character_id=owned, x=4, y=2).status_code == 403
    unchanged = host.get(f"/api/rooms/{room['id']}").json["state_json"]
    assert next(entity for entity in unchanged["entities"] if entity["id"] == "door")["doorState"] == "closed"
    assert not next(entity for entity in unchanged["entities"] if entity["id"] == "door-trap").get("triggered")
    opened = command(guest, room, "interact", character_id=owned, x=4, y=2)
    assert opened.status_code == 200, opened.json
    assert opened.json["state_json"]["activity"][-1]["characterId"] == owned
    assert next(entity for entity in opened.json["state_json"]["entities"] if entity["id"] == "door")["doorState"] == "open"


def test_marching_order_cannot_move_another_players_characters(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    imported = command(guest, room, "import", character_json=character("Guest"))
    own = imported.json["owned_character_ids"][0]
    for action, extra in (("follow_step", {}), ("move_batch", {"moves": [{"dx": 1, "dy": 0}]})):
        response = command(guest, room, action, character_id=own, marching_order=["host-char", own], following_ids=["host-char"], **extra)
        assert response.status_code == 403
        assert response.json["error"] == "character_not_owned"
    response = command(guest, room, "follow_step", character_id=own, marching_order=[own], following_ids=[own])
    assert response.status_code == 200, response.json


def test_import_allowance_is_separate_for_guests_and_host_on_same_network(clients, monkeypatch):
    from app import limiter
    host, guest, _ = clients
    room = create(host, players_can_import=True, extra_characters_without_host=True)
    join(guest, room)
    other_guest = app.test_client()
    join(other_guest, room)
    monkeypatch.setitem(app.config, "TESTING", False)
    monkeypatch.setitem(app.config, "SHADOWDARKLINGS_IMPORT_ENABLED", True)
    monkeypatch.setitem(app.config, "RATELIMIT_ENABLED", True)
    monkeypatch.setattr(limiter, "enabled", True)
    monkeypatch.setattr("app.fetch_shadowdarklings_character_json",
                        lambda base_classes_only=False: '{"name":"Party Member"}')
    limiter.reset()
    try:
        for member, count in ((guest, 32), (other_guest, 16), (host, 16)):
            for _ in range(count):
                response = post(member, "/api/shadowdarklings/import", {"room_id": room["id"]})
                assert response.status_code == 200, response.json
        assert post(guest, "/api/shadowdarklings/import", {"room_id": room["id"]}).status_code == 429
    finally:
        limiter.reset()


def test_movement_batches_are_bounded_and_applied_atomically(clients):
    host, _, _ = clients
    room = create(host)
    moved = command(host, room, "move_batch", character_id="host-char", moves=[
        {"dx": 1, "dy": 0}, {"dx": 1, "dy": 0}, {"dx": 0, "dy": 1},
    ])

    assert moved.status_code == 200, moved.json
    character_state = moved.json["state_json"]["characters"][0]
    assert (character_state["x"], character_state["y"]) == (4, 3)
    motion = moved.json["state_json"]["multiplayerMotions"][-1]
    assert motion["actorId"] == moved.json["current_player_id"]
    assert [(frame["x"], frame["y"]) for frame in motion["frames"]] == [
        (2, 2), (3, 2), (4, 2), (4, 3)
    ]

    too_many = command(host, room, "move_batch", character_id="host-char", moves=[{"dx": 1, "dy": 0}] * 9)
    assert too_many.status_code == 400
    assert too_many.json["error"] == "invalid_request"


def test_each_member_persists_separate_exploration(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    guest_view = join(guest, room)
    visibility = {
        "exploredEver": ["2,2", "3,2"],
        "visitedRoomIds": ["r1"],
        "exploredInnerWallInteriors": [],
        "closedDoorExploredSides": {},
    }
    heartbeat = post(guest, f"/api/rooms/{room['id']}/presence", {
        "revision": guest_view["revision"], "viewer_visibility": visibility})
    assert heartbeat.status_code == 200, heartbeat.json
    guest_after = guest.get(f"/api/rooms/{room['id']}").json
    host_after = host.get(f"/api/rooms/{room['id']}").json
    assert guest_after["viewer_visibility"]["exploredEver"] == ["2,2", "3,2"]
    assert host_after["viewer_visibility"]["exploredEver"] != ["2,2", "3,2"]

    invalid = post(guest, f"/api/rooms/{room['id']}/presence", {
        "revision": guest_after["revision"],
        "viewer_visibility": {**visibility, "exploredEver": ["999,999"]}})
    assert invalid.status_code == 400


def test_host_controls_player_imports_and_character_assignments(clients):
    host, guest, player = clients
    room = create(host)
    guest_view = join(guest, room)
    player_view = join(player, room)
    denied = command(guest, room, "import", character_json=character("Guest"))
    assert denied.status_code == 403
    assert denied.json["error"] == "player_import_disabled"
    current = guest.get(f"/api/rooms/{room['id']}").json
    assert post(guest, f"/api/rooms/{room['id']}/assignments", {
        "revision": current["revision"], "player_id": guest_view["current_player_id"],
        "character_id": "host-char"}, "patch").status_code == 404

    current = host.get(f"/api/rooms/{room['id']}").json
    assigned = post(host, f"/api/rooms/{room['id']}/assignments", {
        "revision": current["revision"], "player_id": guest_view["current_player_id"],
        "character_id": "host-char"}, "patch")
    assert assigned.status_code == 200, assigned.json
    assert assigned.json["ownership"]["host-char"] == guest_view["current_player_id"]
    assert assigned.json["assignments"][guest_view["current_player_id"]] == "host-char"
    assert command(guest, room, "move", character_id="host-char", dx=1, dy=0).status_code == 200

    current = host.get(f"/api/rooms/{room['id']}").json
    transferred = post(host, f"/api/rooms/{room['id']}/assignments", {
        "revision": current["revision"], "player_id": player_view["current_player_id"],
        "character_id": "host-char"}, "patch")
    assert transferred.status_code == 200, transferred.json
    assert transferred.json["owned_character_ids"] == []
    assert transferred.json["assignments"][guest_view["current_player_id"]] is None
    assert transferred.json["ownership"]["host-char"] == player_view["current_player_id"]
    assert command(guest, room, "move", character_id="host-char", dx=1, dy=0).status_code == 403
    assert command(player, room, "move", character_id="host-char", dx=1, dy=0).status_code == 200


def test_player_single_character_limit_resets_after_dismissal(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    guest_view = join(guest, room)
    imported = command(guest, room, "import", character_json=character("First"))
    assert imported.status_code == 200, imported.json
    character_id = imported.json["owned_character_ids"][0]
    second = command(guest, room, "import", character_json=character("Second"))
    assert second.status_code == 403
    assert second.json["error"] == "import_limit"
    assert command(guest, room, "dismiss", character_id=character_id).status_code == 200
    replacement = command(guest, room, "import", character_json=character("Replacement"))
    assert replacement.status_code == 200, replacement.json

    replacement_id = replacement.json["owned_character_ids"][0]
    current = host.get(f"/api/rooms/{room['id']}").json
    reassigned = post(host, f"/api/rooms/{room['id']}/assignments", {
        "revision": current["revision"], "player_id": guest_view["current_player_id"],
        "character_id": "host-char"}, "patch")
    assert reassigned.status_code == 200, reassigned.json
    assert reassigned.json["ownership"]["host-char"] == guest_view["current_player_id"]
    assert reassigned.json["ownership"][replacement_id] == reassigned.json["current_player_id"]
    assert command(guest, room, "move", character_id=replacement_id, dx=1, dy=0).status_code == 403


def test_guest_shadowdarklings_generation_obeys_room_import_permission(clients, monkeypatch):
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    called = []
    monkeypatch.setattr("app.fetch_shadowdarklings_character_json", lambda base_classes_only=False: called.append(True) or '{"name":"Guest"}')
    previous = app.config.get("SHADOWDARKLINGS_IMPORT_ENABLED")
    app.config["SHADOWDARKLINGS_IMPORT_ENABLED"] = True
    try:
        malformed = post(guest, "/api/shadowdarklings/import", [])
        assert malformed.status_code == 400
        assert malformed.is_json and malformed.json["error"] == "invalid_json"
        assert called == []

        denied = post(guest, "/api/shadowdarklings/import", {"room_id": room["id"]})
        assert denied.status_code == 403
        assert denied.is_json and denied.json["error"] == "player_import_disabled"
        assert called == []

        current = host.get(f"/api/rooms/{room['id']}").json
        enabled = post(host, f"/api/rooms/{room['id']}/options", {
            "revision": current["revision"], "players_can_import": True}, "patch")
        assert enabled.status_code == 200
        imported = post(guest, "/api/shadowdarklings/import", {"room_id": room["id"]})
        assert imported.status_code == 200, imported.json
        assert imported.is_json and called == [True]
    finally:
        app.config["SHADOWDARKLINGS_IMPORT_ENABLED"] = previous


def test_host_absence_options_and_returning_membership(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    imported = command(guest, room, "import", character_json=character("Guest")).json
    owned = imported["owned_character_ids"][0]
    post(host, f"/api/rooms/{room['id']}/leave", {})
    assert command(guest, room, "move", character_id=owned, dx=1, dy=0).status_code == 403
    assert command(guest, room, "edit_character", character_id=owned, character_json=character()).status_code == 403
    assert command(guest, room, "import", character_json=character()).status_code == 403
    current = host.get(f"/api/rooms/{room['id']}").json
    updated = post(host, f"/api/rooms/{room['id']}/options", {
        "revision": current["revision"], "autonomous_exploration": True,
        "extra_characters_without_host": True}, "patch")
    assert updated.status_code == 200
    assert command(guest, room, "move", character_id=owned, dx=1, dy=0).status_code == 200
    assert command(guest, room, "import", character_json=character("Second Guest")).status_code == 200
    post(host, f"/api/rooms/{room['id']}/invite", {})
    assert post(guest, f"/api/rooms/{room['id']}/resume", {}).status_code == 200


def test_burial_and_sixteen_character_cap(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True, extra_characters_without_host=True)
    join(guest, room)
    with Session(engine) as db:
        saved = db.get(GameRoom, room["id"])
        state = deepcopy(saved.state_json)
        state["characters"][0].update(dead=True, slain=True, hp=0, dyingRounds=0)
        saved.state_json = state
        db.add(saved)
        db.commit()
    assert command(guest, room, "bury", character_id="host-char").status_code == 403
    assert command(host, room, "bury", character_id="host-char").status_code == 200
    for index in range(16):
        result = command(guest, room, "import", character_json=character(f"Guest {index}"))
        assert result.status_code == 200, result.json
    assert command(guest, room, "import", character_json=character()).status_code == 409


def test_revision_idempotency_csrf_and_private_saved_characters(clients):
    host, guest, player = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    join(player, room)
    payload = {"revision": room["revision"], "request_id": uuid.uuid4().hex,
               "command": {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0}}
    path = f"/api/rooms/{room['id']}/commands"
    assert host.post(path, json=payload).status_code == 400
    first = post(host, path, payload)
    assert first.status_code == 200, first.json
    again = post(host, path, payload)
    assert again.json["revision"] == first.json["revision"]
    payload["request_id"] = uuid.uuid4().hex
    assert post(host, path, payload).status_code == 409
    private = post(host, f"/api/rooms/{room['id']}/characters/host-char/save", {"name": "Hero"})
    assert private.status_code == 201
    assert command(player, room, "import", saved_character_id=private.json["id"]).status_code == 404
    assert command(player, room, "import", saved_character_id={}).status_code == 400


def test_named_host_save_preserves_roster_and_personal_characters(clients):
    host, _, player = clients
    room = create(host, players_can_import=True)
    join(player, room)
    imported = command(player, room, "import", character_json=character("Player")).json
    owned = imported["owned_character_ids"][0]
    current = host.get(f"/api/rooms/{room['id']}").json
    saved = post(host, f"/api/rooms/{room['id']}/save", {"name": "Old Crypt", "revision": current["revision"]})
    assert saved.status_code == 200, saved.json
    results = player.get("/api/rooms/saved").json["results"]
    assert results[0]["name"] == "Old Crypt"
    assert post(player, f"/api/rooms/{room['id']}/save", {"name": "Stolen", "revision": current["revision"]}).status_code == 404
    assert post(player, f"/api/rooms/{room['id']}/characters/{owned}/save", {"name": "My Hero"}).status_code == 201
    with Session(engine) as db:
        checkpoint = db.exec(select(SaveCheckpoint)).first()
        assert len(checkpoint.roster_json) == 2
        assert checkpoint.ownership_json[owned] == imported["current_player_id"]


def test_malformed_state_and_origin_are_rejected(clients):
    host, _, _ = clients
    assert post(host, "/api/rooms", []).status_code == 400
    state = dungeon()
    state["map"]["width"] = 999999
    assert post(host, "/api/rooms", {"state_json": state}).status_code == 400
    token = host.get("/api/session").json["csrf_token"]
    result = host.post("/api/rooms", json={"state_json": dungeon()}, headers={"X-CSRFToken": token, "Origin": "https://attacker.invalid"})
    assert result.status_code == 403


def test_invite_expiration_lock_and_kick_do_not_grant_reentry(clients):
    from datetime import timedelta
    from room_models import RoomInvite, utcnow
    host, guest, player = clients
    room = create(host)
    assert player.get(f"/api/rooms/{room['id']}").status_code == 404
    with Session(engine) as db:
        invite = db.exec(select(RoomInvite).where(RoomInvite.room_id == room["id"])).one()
        invite.expires_at = utcnow() - timedelta(seconds=1)
        db.add(invite)
        db.commit()
    assert post(guest, "/api/rooms/join", {"code": room["invite_code"]}).status_code == 404
    room.update(post(host, f"/api/rooms/{room['id']}/invite", {}).json)
    member = join(guest, room)
    current = host.get(f"/api/rooms/{room['id']}").json
    assert post(host, f"/api/rooms/{room['id']}/options", {"revision": current["revision"], "joins_locked": True}, "patch").status_code == 200
    assert post(player, "/api/rooms/join", {"code": room["invite_code"]}).status_code == 404
    assert post(guest, f"/api/rooms/{room['id']}/resume", {}).status_code == 200
    current = host.get(f"/api/rooms/{room['id']}").json
    assert post(host, f"/api/rooms/{room['id']}/players/{member['current_player_id']}/kick", {"revision": current["revision"]}).status_code == 200
    assert guest.get(f"/api/rooms/{room['id']}").status_code == 404
    assert post(guest, f"/api/rooms/{room['id']}/resume", {}).status_code == 404


def test_replacement_invite_keeps_previous_code_valid_for_five_minutes(clients):
    from datetime import timedelta
    from room_models import RoomInvite
    from rooms import INVITE_LIFETIME

    host, guest, player = clients
    room = create(host)
    first_code = room["invite_code"]
    replacement = post(host, f"/api/rooms/{room['id']}/invite", {})
    assert replacement.status_code == 200, replacement.json
    assert INVITE_LIFETIME == timedelta(minutes=5)

    with Session(engine) as db:
        invites = db.exec(select(RoomInvite).where(RoomInvite.room_id == room["id"])).all()
        assert len(invites) == 2

    first_join = post(guest, "/api/rooms/join", {"code": first_code})
    replacement_join = post(player, "/api/rooms/join", {"code": replacement.json["invite_code"]})
    assert first_join.status_code == 200, first_join.json
    assert replacement_join.status_code == 200, replacement_join.json


def test_guest_cookie_survives_session_cookie_expiry(clients):
    host, guest, _ = clients
    room = create(host)
    member = join(guest, room)
    cookie = guest.get_cookie("sd_guest")
    assert cookie.http_only and cookie.same_site == "Lax"
    guest.delete_cookie(app.config["SESSION_COOKIE_NAME"])
    resumed = post(guest, f"/api/rooms/{room['id']}/resume", {})
    assert resumed.status_code == 200
    assert resumed.json["current_player_id"] == member["current_player_id"]


def test_deleted_host_save_is_hidden_from_joined_load_list(clients):
    host, _, player = clients
    room = create(host)
    join(player, room)
    current = host.get(f"/api/rooms/{room['id']}").json
    saved = post(host, f"/api/rooms/{room['id']}/save", {"revision": current["revision"], "name": "Old Crypt"}).json
    assert player.get("/api/rooms/saved").json["results"]
    run_id = saved["saved_run_id"]
    assert post(host, f"/api/runs/{run_id}", {}, "delete").status_code == 204
    assert player.get("/api/rooms/saved").json["results"] == []


def test_account_storage_limit_rolls_back_room_creation(clients, monkeypatch):
    import storage_limits
    host, _, _ = clients
    monkeypatch.setattr(storage_limits, "MAX_ACCOUNT_BYTES", 1)
    response = post(host, "/api/rooms", {"state_json": dungeon()})
    assert response.status_code == 409 and response.json["error"] == "storage_limit"
    with Session(engine) as db:
        assert db.exec(select(GameRoom)).all() == []


@pytest.mark.parametrize("action", ["identify", "drink_potion", "read_scroll", "learn_scroll", "fall_response", "sell_treasure"])
def test_magic_actions_cannot_control_another_members_character(clients, action):
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    response = command(guest, room, action, character_id="host-char", gear_index=0, attempt=True, items=[], coins={})
    assert response.status_code == 403
    assert response.json["error"] == "character_not_owned"


def test_potion_receipt_is_idempotent_and_magic_sale_price_is_authoritative(clients):
    host, _, _ = clients
    room = create(host)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        state["characters"][0]["gear"] = [
            {"name": "Potion of Healing I", "value": 50, "slots": 1,
             "magic": {"kind": "potion", "potion": "healing-1", "identified": True}},
            {"name": "Magic Greataxe", "value": 210, "slots": 2,
             "magic": {"kind": "weapon", "bonus": 1, "identified": False, "trueName": "+1 Greataxe"}},
        ]
        stored.state_json = state
        db.add(stored)
        db.commit()
    current = host.get(f"/api/rooms/{room['id']}").json
    body = {"revision": current["revision"], "request_id": uuid.uuid4().hex,
            "command": {"type": "drink_potion", "character_id": "host-char", "gear_index": 0}}
    first = post(host, f"/api/rooms/{room['id']}/commands", body)
    second = post(host, f"/api/rooms/{room['id']}/commands", body)
    assert first.status_code == second.status_code == 200
    assert first.json["revision"] == second.json["revision"]
    assert second.json["state_json"]["characters"][0]["gear"][0]["name"] == "Empty flask"
    sale = command(host, room, "sell_treasure", character_id="host-char",
                   items=[{"index": 1, "name": "Magic Greataxe"}], coins={}, claimed_price=999999)
    assert sale.status_code == 200, sale.json
    assert sale.json["state_json"]["partyAssets"]["gold"] == 100


def test_disc_ownership_tracks_caster_and_cannot_be_assigned_or_saved_separately(clients):
    from rooms import reconcile_companion_ownership
    host, guest, _ = clients
    room = create(host)
    joined = join(guest, room)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        state["characters"].append({**character("Floating Disc", "disc"), "hp": 0, "maxHitPoints": 0,
                                    "summon": {"kind": "floating-disc", "casterId": "host-char", "remainingMs": 3600000}})
        stored.state_json = state
        reconcile_companion_ownership(db, stored, dict(stored.ownership_json))
        db.add(stored)
        db.commit()
    view = host.get(f"/api/rooms/{room['id']}").json
    assert view["ownership"]["disc"] == view["ownership"]["host-char"]
    assert post(host, f"/api/rooms/{room['id']}/assignments", {
        "revision": view["revision"], "player_id": joined["current_player_id"], "character_id": "disc"}, method="patch").status_code == 404
    assert post(host, f"/api/rooms/{room['id']}/characters/disc/save", {}).status_code == 400
    result = post(host, f"/api/rooms/{room['id']}/assignments", {
        "revision": view["revision"], "player_id": joined["current_player_id"], "character_id": "host-char"}, method="patch")
    assert result.status_code == 200, result.json
    assert result.json["ownership"]["disc"] == joined["current_player_id"]
    assert command(host, room, "get", character_id="disc").status_code == 403
    assert command(guest, room, "move", character_id="disc", dx=1, dy=0).status_code == 400


def test_disc_cannot_be_saved_in_personal_library_or_imported(clients):
    host, guest, _ = clients
    room = create(host, players_can_import=True)
    join(guest, room)
    disc = {**character("Floating Disc"), "summon": {"kind": "floating-disc", "casterId": "host-char", "remainingMs": 3600000}}
    assert post(host, "/api/characters", {"name": "Disc", "character_json": disc}).status_code == 400
    result = command(guest, room, "import", character_json=disc)
    assert result.status_code == 400, result.json


def test_alarm_is_owned_and_allowed_while_rest_vote_is_pending(clients):
    host, guest, _ = clients
    room = create(host)
    join(guest, room)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        state["characters"][0].update(className="Wizard", spellsKnown="Alarm", stats={"INT": 100},
                                      gear=[{"name": "Torch", "quantity": 3}, {"name": "Rations", "quantity": 1}])
        stored.state_json = state
        db.add(stored)
        db.commit()
    assert command(host, room, "rest", character_id="host-char").status_code == 200
    assert command(guest, room, "rest_alarm", character_id="host-char").status_code == 403
    result = command(host, room, "rest_alarm", character_id="host-char")
    assert result.status_code == 200, result.json
    assert result.json["state_json"]["rest"]["phase"] == "voting"


def test_route_darkvision_visibility_survives_presence_leave_and_reconnect_per_viewer(clients):
    from test_underpasses import crossing
    host, guest, _ = clients
    created = post(host, "/api/rooms", {"state_json": crossing()})
    assert created.status_code == 201, created.json
    room = created.json
    joined = join(guest, room)
    visibility = {"routeExplored": {"": ["2,2"], "lower": ["3,3"]},
                  "routeDarkvisionExplored": {"": ["4,4", "4,4"], "lower": ["3,3", "4,3"]}}
    expected = {"": ["4,4"], "lower": ["3,3", "4,3"]}
    updated = post(guest, f"/api/rooms/{room['id']}/presence", {"viewer_visibility": visibility})
    assert updated.status_code == 200, updated.json
    assert updated.json["viewer_visibility"]["routeDarkvisionExplored"] == expected
    assert updated.json["viewer_visibility"]["routeExplored"] == visibility["routeExplored"]
    assert post(guest, f"/api/rooms/{room['id']}/leave", {"viewer_visibility": visibility}).status_code == 200
    resumed = post(guest, f"/api/rooms/{room['id']}/resume", {})
    assert resumed.status_code == 200, resumed.json
    assert resumed.json["viewer_visibility"]["routeDarkvisionExplored"] == expected
    assert guest.get(f"/api/rooms/{room['id']}").json["viewer_visibility"]["routeDarkvisionExplored"] == expected
    assert host.get(f"/api/rooms/{room['id']}").json["viewer_visibility"].get("routeDarkvisionExplored", {}) != expected
    with Session(engine) as db:
        member = db.get(RoomMember, joined["current_player_id"])
        assert member.visibility_json["routeDarkvisionExplored"] == expected


@pytest.mark.parametrize("routes", [
    {"not-a-route": ["3,3"]}, {"lower": ["7,3"]}, {"": ["-1,0"]},
    {"lower": ["3,7"]}, {"lower": ["3,3", 5]}, {"lower": "3,3"},
    {"lower": ["0,0"] * 50}, [], None,
])
def test_route_darkvision_visibility_rejects_invalid_routes_bounds_and_shapes(clients, routes):
    from test_underpasses import crossing
    host, guest, _ = clients
    room = post(host, "/api/rooms", {"state_json": crossing()}).json
    join(guest, room)
    valid = {"routeDarkvisionExplored": {"lower": ["3,3"]}}
    assert post(guest, f"/api/rooms/{room['id']}/presence", {"viewer_visibility": valid}).status_code == 200
    rejected = post(guest, f"/api/rooms/{room['id']}/presence", {"viewer_visibility": {"routeDarkvisionExplored": routes}})
    assert rejected.status_code == 400, rejected.json
    assert guest.get(f"/api/rooms/{room['id']}").json["viewer_visibility"]["routeDarkvisionExplored"] == valid["routeDarkvisionExplored"]
