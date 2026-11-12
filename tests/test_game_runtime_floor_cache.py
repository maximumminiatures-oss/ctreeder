"""Inactive maps must not make every movement command parse ten dungeon floors."""
import io
import json
import queue
from types import SimpleNamespace

import pytest

from game_runtime import GameRuntime


@pytest.mark.parametrize("action", ["move", "tick", "normalize", "attack"])
def test_normal_commands_keep_floor_cache_out_of_worker_payload(action):
    runtime = GameRuntime()
    runtime._start = lambda: None
    runtime._process = SimpleNamespace(stdin=io.StringIO())
    runtime._responses = queue.Queue()
    runtime._responses.put(json.dumps({"ok": True, "state_json": {"level": 2, "characters": []}}))
    floors = {"1": {"level": 1, "tileRuns": [[100, {"type": "wall"}]]}}
    state = {"level": 2, "characters": [], "dungeonFloors": floors}
    result = runtime.apply(state, {"type": action})
    sent = json.loads(runtime._process.stdin.getvalue())
    assert "dungeonFloors" not in sent["state"]
    assert result["state_json"]["dungeonFloors"] == floors
    assert state["dungeonFloors"] == floors


@pytest.mark.parametrize("action", ["ascend", "descend"])
def test_travel_worker_reads_and_replaces_the_saved_floor_cache(action):
    runtime = GameRuntime()
    runtime._start = lambda: None
    runtime._process = SimpleNamespace(stdin=io.StringIO())
    runtime._responses = queue.Queue()
    runtime._responses.put(json.dumps({"ok": True, "state_json": {"level": 1, "dungeonFloors": {"2": {"level": 2}}}}))
    state = {"level": 2, "dungeonFloors": {"1": {"level": 1}}}
    result = runtime.apply(state, {"type": action, "confirmed": True})
    sent = json.loads(runtime._process.stdin.getvalue())
    assert sent["state"]["dungeonFloors"] == state["dungeonFloors"]
    assert result["state_json"]["dungeonFloors"] == {"2": {"level": 2}}
