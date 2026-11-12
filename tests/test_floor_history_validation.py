"""Floor-history validation and save boundaries retain the ordinary request budget."""
from copy import deepcopy
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest

from app import app
from validation import validate_json, validate_state
from test_rooms import clients, dungeon, post
from test_underpasses import crossing


def compact_floor(state):
    floor = {key: deepcopy(value) for key, value in state.items()
             if key not in {"tiles", "characters", "player", "run", "activeCharacterId", "dungeonFloors"}}
    runs = []
    for tile in state["tiles"]:
        value = {key: deepcopy(value) for key, value in tile.items() if key not in {"x", "y"}}
        if runs and runs[-1][1] == value:
            runs[-1][0] += 1
        else:
            runs.append([1, value])
    floor["tileRuns"] = runs
    return floor


def history_state():
    state = dungeon()
    state["level"] = 2
    state["dungeonFloors"] = {"1": compact_floor(dungeon())}
    return state


@pytest.fixture(scope="module")
def ten_generated_floors():
    executable = os.environ.get("GAME_NODE_EXECUTABLE") or shutil.which("node")
    assert executable, "Floor-history integration requires Node.js."
    script = """
      import {generateDungeon} from './S3_content/src/generator.js';
      import {serializeDungeonState} from './S3_content/src/persistence.js';
      import {snapshotDungeonFloor} from './S3_content/src/dungeon-descent.js';
      const floors = {};
      let state;
      for(let level=1;level<=10;level++) {
        state=generateDungeon(61019+level,level,{reviewedLayouts:false,pits:false,underpasses:false});
        floors[level]=snapshotDungeonFloor(state);
      }
      process.stdout.write(JSON.stringify({...serializeDungeonState(state),dungeonFloors:floors}));
    """
    options = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}
    result = subprocess.run([executable, "--input-type=module", "-e", script],
        cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, encoding="utf-8",
        timeout=45, check=True, **options)
    return json.loads(result.stdout)


def test_ten_generated_compact_snapshots_fit_existing_json_and_http_run_budgets(clients, ten_generated_floors):
    host, _, _ = clients
    state = deepcopy(ten_generated_floors)
    assert set(state["dungeonFloors"]) == {str(level) for level in range(1, 11)}
    assert all("tiles" not in floor and "characters" not in floor and "dungeonFloors" not in floor
               for floor in state["dungeonFloors"].values())
    validate_state(state, require_map=True)
    payload = {"seed": state["seed"], "level": state["level"], "state_json": state}
    validate_json(payload)
    assert len(json.dumps(payload).encode("utf-8")) < 5 * 1024 * 1024
    assert app.config["MAX_CONTENT_LENGTH"] == 5 * 1024 * 1024
    created = post(host, "/api/runs", payload)
    assert created.status_code == 201, created.json
    run_id = created.json["id"]
    loaded = host.get(f"/api/runs/{run_id}")
    assert loaded.status_code == 200
    assert loaded.json["state_json"]["dungeonFloors"] == state["dungeonFloors"]
    updated = post(host, f"/api/runs/{run_id}", {**payload, "revision": created.json["revision"]}, "put")
    assert updated.status_code == 200, updated.json
    assert host.get(f"/api/runs/{run_id}").json["state_json"]["dungeonFloors"] == state["dungeonFloors"]


@pytest.mark.parametrize("history", [[], None, {"0": {}}, {"11": {}}, {"01": {}}, {"-1": {}},
    {str(level): {} for level in range(1, 12)}, {"1": []}])
def test_floor_history_rejects_invalid_container_counts_and_level_keys(history):
    state = history_state()
    state["dungeonFloors"] = history
    with pytest.raises(ValueError, match="floor history"):
        validate_state(state)


@pytest.mark.parametrize("changes", [
    {"level": 2}, {"level": True}, {"seed": "bad"}, {"map": {"width": 257, "height": 1}},
    {"dungeonFloors": {}}, {"characters": [{"id": "hidden-party-copy"}]},
    {"tileRuns": []}, {"tileRuns": [[0, {}]]}, {"tileRuns": [[-1, {}]]},
    {"tileRuns": [[True, {}]]}, {"tileRuns": [[49.0, {}]]}, {"tileRuns": [[2**32, {}]]},
    {"tileRuns": [[48, {}]]}, {"tileRuns": [[49, {}], [1, {}]]},
    {"tileRuns": [[49, []]]}, {"tileRuns": [[49, {}, "extra"]]}, {"tileRuns": {}},
    {"tiles": []}, {"entities": [{}] * 4097}, {"rooms": [{}] * 513}, {"halls": [{}] * 2049},
])
def test_each_cached_floor_has_the_same_map_entity_bounds_and_safe_rle_expansion(changes):
    state = history_state()
    state["dungeonFloors"]["1"].update(changes)
    with pytest.raises(ValueError):
        validate_state(state)


def test_cached_floor_underpasses_are_validated_without_decompressing_tiles():
    state = history_state()
    state["dungeonFloors"]["1"] = compact_floor(crossing())
    assert validate_state(state) is state
    state["dungeonFloors"]["1"]["underpasses"][0]["portals"][0]["lower"]["x"] = 99
    with pytest.raises(ValueError, match="underpass"):
        validate_state(state)


def test_maximum_compressed_floor_size_is_allowed_but_does_not_expand_the_request_budget():
    state = history_state()
    floor = state["dungeonFloors"]["1"]
    floor.update(map={"width": 256, "height": 256}, tileRuns=[[65536, {"type": "wall"}]])
    assert validate_state(state) is state
    for level in range(2, 11):
        state["dungeonFloors"][str(level)] = {**deepcopy(floor), "level": level}
    assert validate_state(state) is state
    with pytest.raises(ValueError, match="too large"):
        validate_json({"padding": ["x" * 16000] * 330})


def test_http_save_rejects_invalid_history_before_storing_it(clients):
    host, _, _ = clients
    state = history_state()
    state["dungeonFloors"]["1"]["tileRuns"] = [[65536, {"type": "floor"}]]
    rejected = post(host, "/api/runs", {"seed": state["seed"], "level": state["level"], "state_json": state})
    assert rejected.status_code == 400, rejected.json
    assert rejected.json["error"] == "invalid_state"
    assert host.get("/api/runs").json["results"] == []


def test_uuid_identifiers_are_not_dice_but_actual_oversized_expressions_still_fail():
    identifier = "123d4567-1234-4abc-8def-0123456789ab"
    for value in (identifier, f"floor-companion-{identifier}", f"floor-companion-{identifier}-2"):
        assert validate_json({"id": value}) == {"id": value}
    for value in ("101d6", "Damage: 1000d6", "123d4567", f"101d6 and {identifier}"):
        with pytest.raises(ValueError, match="at most 100 dice"):
            validate_json({"damage": value})
