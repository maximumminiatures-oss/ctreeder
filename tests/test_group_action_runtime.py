"""HTTP consensus through the real Node worker and generator, not a runtime mock."""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest
from sqlmodel import Session, select

from app import engine
from game_runtime import game_runtime
from room_models import GameRoom, RoomMember
from test_rooms import clients, post, join, character


@pytest.fixture(scope="module")
def generated_descent():
    executable = os.environ.get("GAME_NODE_EXECUTABLE") or shutil.which("node")
    assert executable, "Real descent integration requires Node.js."
    script = """
      import {generateDungeon,isSafeDungeonArrival} from './S3_content/src/generator.js';
      import {serializeDungeonState} from './S3_content/src/persistence.js';
      for(let seed=61019;seed<61039;seed++) {
        const state=generateDungeon(seed,1,{reviewedLayouts:false,pits:false,underpasses:false});
        const stairs=state.entities.find(entity=>entity.doorKind==='stairs-down');
        if(!stairs) continue;
        const cells=state.tiles.filter(tile=>tile.roomId===stairs.roomId&&isSafeDungeonArrival(state,tile));
        if(cells.length<5) continue;
        process.stdout.write(JSON.stringify({state:serializeDungeonState(state),cells:cells.slice(0,5)}));
        break;
      }
    """
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    result = subprocess.run([executable, "--input-type=module", "-e", script],
                            cwd=Path(__file__).resolve().parents[1], capture_output=True,
                            text=True, encoding="utf-8", timeout=30, check=True, **options)
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
        assert all(member.visibility_json == {} for member in db.exec(select(RoomMember).where(RoomMember.room_id == room["id"])).all())
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
