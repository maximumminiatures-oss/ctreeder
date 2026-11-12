"""HTTP consensus through the real Node worker and generator, not a runtime mock."""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
from datetime import timedelta

import pytest
from sqlmodel import Session, select

from app import engine
from game_runtime import game_runtime
from room_models import GameRoom, RoomMember, utcnow
from rooms import validate_viewer_visibility
from test_rooms import clients, post, join, character, command


@pytest.fixture(autouse=True)
def frozen_presence_clock(monkeypatch):
    now = utcnow()
    monkeypatch.setattr("rooms.utcnow", lambda: now)


def generated_stair_party(level=1, stair_kind="stairs-down"):
    executable = os.environ.get("GAME_NODE_EXECUTABLE") or shutil.which("node")
    assert executable, "Real descent integration requires Node.js."
    script = """
      import {generateDungeon,isSafeDungeonArrival} from './S3_content/src/generator.js';
      import {serializeDungeonState} from './S3_content/src/persistence.js';
      for(let seed=61019;seed<61039;seed++) {
        const state=generateDungeon(seed,Number(process.argv[1]),{reviewedLayouts:false,pits:false,underpasses:false});
        const stairs=state.entities.find(entity=>entity.doorKind===process.argv[2]);
        if(!stairs) continue;
        const cells=state.tiles.filter(tile=>tile.roomId===stairs.roomId&&isSafeDungeonArrival(state,tile));
        if(cells.length<5) continue;
        process.stdout.write(JSON.stringify({state:serializeDungeonState(state),cells:cells.slice(0,5)}));
        break;
      }
    """
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    result = subprocess.run([executable, "--input-type=module", "-e", script, str(level), stair_kind],
                            cwd=Path(__file__).resolve().parents[1], capture_output=True,
                            text=True, encoding="utf-8", timeout=30, **options)
    assert result.returncode == 0, result.stderr
    generated = json.loads(result.stdout)
    state = generated["state"]
    state["characters"] = [character(name, identifier) for name, identifier in (
        ("Wizard", "host-char"), ("Guest", "guest-char"), ("Floating Disc", "disc"),
        ("Charmed Orc", "charmed"), ("False Friend", "doppelganger"))]
    for member, cell in zip(state["characters"], generated["cells"]):
        member.update(x=cell["x"], y=cell["y"], roomId=cell["roomId"], routeId="", lineageId=member["id"])
    state["characters"][0].update(className="Wizard", spellsKnown="Light, Sleep", lightSource="torch", lightRadius=6,
        gear=[{"name": "Torch", "lit": True, "equipped": True, "quantity": 1}],
        faithEffects=[{"spell": "shield of faith", "rounds": 3, "bonus": 2}],
        focusSpell={"spell": "protection from evil", "centerId": "host-char", "radius": 1, "opposes": "chaotic"})
    state["characters"][2].update(hp=0, maxHitPoints=0,
        summon={"kind": "floating-disc", "casterId": "host-char", "remainingMs": 123450,
                "trail": [{"x": 1, "y": 1}]})
    state["characters"][3]["companion"] = {"kind": "charmed", "controllerCharacterId": "guest-char",
        "charm": {"casterId": "host-char", "remainingMs": 987650}, "sourceMonsterId": "old-orc",
        "source": {"id": "old-orc", "name": "Orc", "type": "monster", "hp": 8, "maxHp": 8, "ac": 12,
                   "attack": "1 greataxe +1 (1d8)", "level": 1, "S": 1, "D": 0, "C": 1, "I": 0, "W": 0, "Ch": 0}}
    state["characters"][4]["companion"] = {"kind": "doppelganger", "sourceMonsterId": "old-double",
        "source": {"id": "old-double", "name": "Doppelganger", "type": "monster", "hp": 8, "maxHp": 8, "ac": 12,
                   "attack": "1 dagger +2 (1d4)", "level": 3, "S": 1, "D": 2, "C": 1, "I": 1, "W": 0, "Ch": 2}}
    state.update(partyName="The Descent", partyAssets={"gold": 51, "silver": 3, "copper": 2},
                 arcaneTime={"elapsedMs": 50000, "crawlRemainderMs": 1250}, activeCharacterId="host-char")
    state["timers"].update(torchElapsedMs=123456, lightEverLit=True)
    state["player"].update({key: state["characters"][0][key] for key in ("x", "y", "roomId", "routeId", "lightSource", "lightRadius")})
    state["player"]["torchLit"] = True
    return state


@pytest.fixture(scope="module")
def generated_descent():
    return generated_stair_party()


@pytest.fixture(scope="module")
def generated_fresh_ascent():
    return generated_stair_party(3, "stairs-up")


def create_generated_room(host, guest, state):
    result = post(host, "/api/rooms", {"state_json": deepcopy(state)})
    assert result.status_code == 201, result.json
    room = result.json
    player = join(guest, room)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        ownership = dict(stored.ownership_json)
        ownership.update({"guest-char": player["current_player_id"], "charmed": player["current_player_id"]})
        stored.ownership_json = ownership
        stored.primary_assignments_json = {room["current_player_id"]: "host-char", player["current_player_id"]: "guest-char"}
        db.add(stored)
        db.commit()
    return room


def test_unanimous_descent_uses_real_generated_floor_and_preserves_party(clients, generated_descent):
    host, guest, _ = clients
    game_runtime.close()  # This test process only; load the current trusted module.
    room = create_generated_room(host, guest, generated_descent)
    old_fog = {}
    for index, client in enumerate((host, guest)):
        fog = {"floorLevel": 1, "exploredEver": [f"{index},0"], "visitedRoomIds": [f"memory-{index}"],
               "routeExplored": {"": [f"{index},0"]}, "routeDarkvisionExplored": {"": [f"{index},1"]},
               "exploredInnerWallInteriors": [f"{index},2"], "closedDoorExploredSides": {f"door-{index}": ["left"]}}
        response = post(client, f"/api/rooms/{room['id']}/presence", {"viewer_visibility": fog})
        assert response.status_code == 200, response.json
        old_fog[response.json["current_player_id"]] = response.json["viewer_visibility"]
    before = host.get(f"/api/rooms/{room['id']}").json
    start = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": "descend"})
    assert start.status_code == 200, start.json
    assert start.json["group_action"]["status"] == "pending"
    assert start.json["state_json"]["level"] == 1
    vote = start.json["group_action"]["id"]
    done = post(host, f"/api/rooms/{room['id']}/group-action", {"action": "descend", "vote_id": vote, "accept": True})
    assert done.status_code == 200, done.json
    view, previous = done.json, before["state_json"]
    next_floor = view["state_json"]
    assert view["group_action"]["status"] == "completed"
    assert next_floor["level"] == 2 and next_floor["seed"] != previous["seed"]
    assert next_floor["rooms"] and next_floor["tiles"]
    assert next_floor["generation"]["entranceRoomId"]
    assert next_floor["partyName"] == "The Descent"
    assert next_floor["partyAssets"] == previous["partyAssets"]
    assert next_floor["arcaneTime"] == previous["arcaneTime"]
    assert next_floor["timers"]["torchElapsedMs"] == previous["timers"]["torchElapsedMs"]
    assert view["ownership"] == before["ownership"] and view["assignments"] == before["assignments"]
    assert view["viewer_visibility"] == {}
    assert {member["id"] for member in next_floor["characters"]} == {member["id"] for member in previous["characters"]}
    members = {member["id"]: member for member in next_floor["characters"]}
    assert len({(member["x"], member["y"], member.get("routeId", "")) for member in members.values()}) == 5
    assert all(member["roomId"] == next_floor["generation"]["entranceRoomId"] for member in members.values())
    assert members["disc"]["summon"]["remainingMs"] == 123450
    assert members["charmed"]["companion"]["charm"]["remainingMs"] == 987650
    assert members["doppelganger"]["companion"]["kind"] == "doppelganger"
    assert members["host-char"]["faithEffects"] == previous["characters"][0]["faithEffects"]
    assert members["host-char"]["focusSpell"] == previous["characters"][0]["focusSpell"]
    assert all(member["lineageId"] == member["id"] for member in members.values())
    with Session(engine) as db:
        for member in db.exec(select(RoomMember).where(RoomMember.room_id == room["id"])).all():
            assert {key: value for key, value in member.visibility_json.items() if key != "_floors"} == {}
            assert member.visibility_json["_floors"] == {"1": old_fog[member.id]}
    replay = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": "descend", "vote_id": vote, "accept": True})
    assert replay.status_code == 200
    assert replay.json["state_json"]["seed"] == next_floor["seed"]
    assert replay.json["state_json"]["level"] == 2


def test_real_descent_rejects_a_straggler_and_general_command_bypass(clients, generated_descent):
    host, guest, _ = clients
    room = create_generated_room(host, guest, generated_descent)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        entrance = state["generation"]["entranceRoomId"]
        cell = next(tile for tile in state["tiles"] if tile.get("roomId") == entrance and tile["type"] == "floor")
        state["characters"][1].update(x=cell["x"], y=cell["y"], roomId=entrance)
        stored.state_json = state
        db.add(stored)
        db.commit()
    start = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": "descend"}).json
    done = post(host, f"/api/rooms/{room['id']}/group-action", {"action": "descend", "vote_id": start["group_action"]["id"], "accept": True})
    assert done.status_code == 400, done.json
    assert "Gather your party" in done.json["message"]
    unchanged = host.get(f"/api/rooms/{room['id']}").json
    assert unchanged["state_json"]["level"] == 1
    assert unchanged["group_action"]["status"] == "pending"
    assert len(unchanged["group_action"]["acceptedMemberIds"]) == 1
    with pytest.raises(ValueError, match="confirm"):
        game_runtime.apply(generated_descent, {"type": "descend"})


def travel(host, guest, room, action):
    start = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": action})
    assert start.status_code == 200, start.json
    assert start.json["group_action"]["status"] == "pending"
    done = post(host, f"/api/rooms/{room['id']}/group-action", {
        "action": action, "vote_id": start.json["group_action"]["id"], "accept": True})
    assert done.status_code == 200, done.json
    assert done.json["group_action"]["status"] == "completed"
    return done.json


def floor_geometry(state):
    return {key: deepcopy(state.get(key)) for key in
            ("seed", "level", "map", "tiles", "rooms", "halls", "entities", "decor", "generation", "underpasses")}


def assert_floor_geometry(actual, expected):
    geometry = floor_geometry(actual)
    for key, value in floor_geometry(expected).items():
        restored = geometry[key]
        if isinstance(value, list) and all(isinstance(item, dict) for item in value):
            assert len(restored) == len(value), key
            for old, new in zip(value, restored):
                if key == "entities":
                    old = {**old, "routeId": old.get("routeId") or ""}
                    new = {**new, "routeId": new.get("routeId") or ""}
                # Arrival may reveal more of the restored map, but cannot erase discovery.
                derived = {"discovered", "explored"} if key == "rooms" else {"visible"} if key == "entities" else set()
                if key == "rooms":
                    for field in derived:
                        if old.get(field) is True:
                            assert new.get(field) is True, (key, old.get("id"), f"lost {field}")
                differences = {field: (old.get(field), new.get(field)) for field in old.keys() | new.keys()
                               if field not in derived and old.get(field) != new.get(field)}
                assert not differences, (key, old.get("id"), differences)
        else:
            assert restored == value, key


def member_fog(room):
    with Session(engine) as db:
        return {member.id: deepcopy(member.visibility_json) for member in
                db.exec(select(RoomMember).where(RoomMember.room_id == room["id"])).all()}


def stored_state(room):
    with Session(engine) as db:
        return deepcopy(db.get(GameRoom, room["id"]).state_json)


def test_unanimous_ascent_restores_exact_floor_and_each_players_fog_then_revisits_lower_floor(clients, generated_descent):
    host, guest, _ = clients
    room = create_generated_room(host, guest, generated_descent)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        # Isolate cache restoration from the separately owned arrival-encounter roll.
        state["wanderingMonsters"]["numerator"] = 0
        state["entities"].append({"id": "old-floor-scar", "type": "feature", "subtype": "dropped-equipment",
                                  "x": 0, "y": 0, "visible": True, "magicDetected": False,
                                  "gearItem": {"name": "Dagger", "instanceId": "unique-old-dagger"}})
        stored.state_json = state
        for index, member in enumerate(db.exec(select(RoomMember).where(RoomMember.room_id == room["id"])).all()):
            member.visibility_json = validate_viewer_visibility({"exploredEver": [f"{index},0"],
                "routeExplored": {"": [f"{index},1"]}, "routeDarkvisionExplored": {"": [f"{index},2"]},
                "visitedRoomIds": [f"private-room-{index}"], "exploredInnerWallInteriors": [f"{index},3"],
                "closedDoorExploredSides": {f"private-door-{index}": ["left", "top"]}}, state)
            db.add(member)
        db.add(stored)
        db.commit()
    original = floor_geometry(host.get(f"/api/rooms/{room['id']}").json["state_json"])
    first_fog = member_fog(room)
    lower = travel(host, guest, room, "descend")
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        state = deepcopy(stored.state_json)
        state["wanderingMonsters"]["numerator"] = 0
        state = game_runtime.apply(state, {"type": "normalize"})["state_json"]
        stored.state_json = state
        db.add(stored)
        db.commit()
    lower = host.get(f"/api/rooms/{room['id']}").json
    lower_geometry = floor_geometry(lower["state_json"])
    second_fog = {}
    for index, client in enumerate((host, guest)):
        response = post(client, f"/api/rooms/{room['id']}/presence", {"viewer_visibility": {
            "floorLevel": 2, "exploredEver": [f"{index},4"], "visitedRoomIds": [f"lower-{index}"],
            "routeExplored": {"": [f"{index},4"]}, "routeDarkvisionExplored": {"": [f"{index},5"]},
            "_floors": {"1": {"exploredEver": ["99,99"]}}}})
        assert response.status_code == 200, response.json
        assert "_floors" not in response.json["viewer_visibility"]
        second_fog[response.json["current_player_id"]] = response.json["viewer_visibility"]
    before_ascent = deepcopy(lower["state_json"])
    pending = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": "ascend", "confirmed": True,
        "state_json": {"level": 1, "entities": []}, "acceptedMemberIds": list(first_fog)})
    assert pending.status_code == 200, pending.json
    proposal = pending.json["group_action"]
    assert proposal["status"] == "pending"
    assert set(proposal["requiredMemberIds"]) == set(first_fog)
    assert proposal["acceptedMemberIds"] == [guest.get(f"/api/rooms/{room['id']}").json["current_player_id"]]
    assert floor_geometry(pending.json["state_json"]) == lower_geometry
    with pytest.raises(ValueError, match="[Cc]onfirm"):
        game_runtime.apply(before_ascent, {"type": "ascend"})
    done = post(host, f"/api/rooms/{room['id']}/group-action", {
        "action": "ascend", "vote_id": proposal["id"], "accept": True})
    assert done.status_code == 200, done.json
    restored = done.json
    assert restored["group_action"]["status"] == "completed"
    assert_floor_geometry(restored["state_json"], original)
    assert restored["ownership"] == lower["ownership"]
    assert restored["assignments"] == lower["assignments"]
    assert "dungeonFloors" not in restored["state_json"]
    assert set(stored_state(room)["dungeonFloors"]) == {"2"}
    for member_id, fog in member_fog(room).items():
        assert fog == {**first_fog[member_id], "_floors": {"2": second_fog[member_id]}}
    for client in (host, guest):
        view = client.get(f"/api/rooms/{room['id']}").json
        assert view["viewer_visibility"] == first_fog[view["current_player_id"]]
    replay = post(guest, f"/api/rooms/{room['id']}/group-action", {
        "action": "ascend", "vote_id": proposal["id"], "accept": True})
    assert replay.status_code == 200
    assert replay.json["state_json"]["floorTransitions"] == restored["state_json"]["floorTransitions"]
    returned = travel(host, guest, room, "descend")
    assert_floor_geometry(returned["state_json"], lower_geometry)
    for member_id, fog in member_fog(room).items():
        assert fog == {**second_fog[member_id], "_floors": {"1": first_fog[member_id]}}


@pytest.mark.parametrize("endpoint", ["presence", "leave"])
@pytest.mark.parametrize("floor_level", [1, True, 2.0, "2", None])
def test_stale_or_malformed_floor_tag_cannot_overwrite_active_or_cached_fog(clients, generated_descent, endpoint, floor_level):
    host, guest, _ = clients
    room = create_generated_room(host, guest, generated_descent)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        stored.state_json = {**stored.state_json, "level": 2}
        guest_member = db.exec(select(RoomMember).where(RoomMember.room_id == room["id"], RoomMember.role != "host")).one()
        fog = {"exploredEver": ["1,1"], "_floors": {"1": {"exploredEver": ["2,2"]}}}
        guest_member.visibility_json = deepcopy(fog)
        db.add(guest_member)
        db.add(stored)
        db.commit()
        member_id = guest_member.id
    response = post(guest, f"/api/rooms/{room['id']}/{endpoint}", {"viewer_visibility": {
        "floorLevel": floor_level, "exploredEver": ["3,3"], "_floors": {"1": {"exploredEver": []}}}})
    assert response.status_code == 200, response.json
    assert member_fog(room)[member_id] == fog
    if endpoint == "presence":
        assert response.json["viewer_visibility"] == {"exploredEver": ["1,1"]}


@pytest.mark.parametrize("action", ["ascend", "descend"])
def test_stair_actions_require_membership_and_cannot_bypass_consensus_via_commands(clients, generated_descent, action):
    host, guest, outsider = clients
    room = create_generated_room(host, guest, generated_descent)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        stored.state_json = {**stored.state_json, "level": 2}
        db.add(stored)
        db.commit()
    before = host.get(f"/api/rooms/{room['id']}").json
    assert post(outsider, f"/api/rooms/{room['id']}/group-action", {"action": action}).status_code == 404
    for client in (host, guest):
        assert command(client, room, action, confirmed=True).status_code == 400
    start = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": action}).json
    vote = start["group_action"]["id"]
    assert post(outsider, f"/api/rooms/{room['id']}/group-action", {"action": action, "vote_id": vote, "accept": True}).status_code == 404
    assert post(host, f"/api/rooms/{room['id']}/group-action", {"action": action, "vote_id": uuid.uuid4().hex, "accept": True}).status_code == 409
    rejected = post(host, f"/api/rooms/{room['id']}/group-action", {"action": action, "vote_id": vote, "accept": False})
    assert rejected.json["group_action"]["status"] == "cancelled"
    assert floor_geometry(rejected.json["state_json"]) == floor_geometry(before["state_json"])


@pytest.mark.parametrize("action", ["ascend", "descend"])
def test_stair_consensus_obeys_host_absence_policy(clients, generated_descent, monkeypatch, action):
    host, guest, _ = clients
    room = create_generated_room(host, guest, generated_descent)
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        stored.state_json = {**stored.state_json, "level": 2}
        host_member = db.get(RoomMember, room["current_player_id"])
        host_member.last_seen_at = utcnow() - timedelta(minutes=2)
        db.add(host_member)
        db.add(stored)
        db.commit()
    called = []
    def apply(state, cmd):
        called.append(cmd)
        return {"state_json": {**state, "level": state["level"] + (-1 if action == "ascend" else 1)}}
    monkeypatch.setattr("rooms.game_runtime.apply", apply)
    denied = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": action})
    assert denied.status_code == 403 and denied.json["error"] == "host_absent"
    assert called == []
    with Session(engine) as db:
        stored = db.get(GameRoom, room["id"])
        stored.autonomous_exploration = True
        db.add(stored)
        db.commit()
    allowed = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": action})
    assert allowed.status_code == 200, allowed.json
    assert allowed.json["group_action"]["status"] == "completed"
    assert called == [{"type": action, "confirmed": True}]


def test_fresh_higher_floor_ascent_generates_upper_floor_at_downstairs_only_after_consensus(clients, generated_fresh_ascent):
    host, guest, _ = clients
    room = create_generated_room(host, guest, generated_fresh_ascent)
    before = host.get(f"/api/rooms/{room['id']}").json
    assert not stored_state(room).get("dungeonFloors")
    upper = travel(host, guest, room, "ascend")
    state = upper["state_json"]
    assert state["level"] == 2
    stairs = next(entity for entity in state["entities"] if entity.get("doorKind") == "stairs-down")
    assert all(member["roomId"] == stairs["roomId"] and member.get("routeId", "") == stairs.get("routeId", "")
               for member in state["characters"])
    assert "dungeonFloors" not in state
    assert set(stored_state(room)["dungeonFloors"]) == {"3"}
    assert upper["ownership"] == before["ownership"]
    assert upper["assignments"] == before["assignments"]


def test_level_one_ascent_remains_a_dungeon_exit_not_a_generated_floor(clients, generated_descent, monkeypatch):
    host, guest, _ = clients
    room = create_generated_room(host, guest, generated_descent)
    def unexpected(*_args):
        pytest.fail("Level one cannot generate a level-zero floor.")
    monkeypatch.setattr("rooms.game_runtime.apply", unexpected)
    response = post(guest, f"/api/rooms/{room['id']}/group-action", {"action": "ascend"})
    assert response.status_code == 400, response.json
    assert "out of the dungeon" in response.json["message"]


def test_floor_history_is_not_broadcast_but_polls_preserve_cache_and_ascent_restores_it(clients, generated_descent):
    host, guest, _ = clients
    state = deepcopy(generated_descent)
    state["wanderingMonsters"]["numerator"] = 0
    room = create_generated_room(host, guest, state)
    original = floor_geometry(room["state_json"])
    lower = travel(host, guest, room, "descend")
    assert "dungeonFloors" not in lower["state_json"]
    cache = stored_state(room)["dungeonFloors"]
    assert set(cache) == {"1"}
    for client in (host, guest):
        response = client.get(f"/api/rooms/{room['id']}")
        assert response.status_code == 200
        assert "dungeonFloors" not in response.json["state_json"]
        response = post(client, f"/api/rooms/{room['id']}/presence", {"revision": -1})
        assert response.status_code == 200
        assert "dungeonFloors" not in response.json["state_json"]
    assert stored_state(room)["dungeonFloors"] == cache
    # The trusted worker's ordinary-command fast path also preserves inactive floors.
    normalized = game_runtime.apply(stored_state(room), {"type": "normalize"})
    assert normalized["state_json"]["dungeonFloors"] == cache
    assert stored_state(room)["dungeonFloors"] == cache
    restored = travel(host, guest, room, "ascend")
    assert "dungeonFloors" not in restored["state_json"]
    assert_floor_geometry(restored["state_json"], original)
    assert set(stored_state(room)["dungeonFloors"]) == {"2"}
