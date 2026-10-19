from copy import deepcopy

import pytest

from game_runtime import game_runtime
from rooms import validate_viewer_visibility
from validation import validate_state
from test_rooms import clients, dungeon, post, join, command


def crossing():
    state = dungeon()
    state["underpasses"] = [{
        "id": "lower", "axis": "horizontal",
        "lowerCells": [{"x": x, "y": 3} for x in range(1, 6)],
        "upperCrossings": [{"x": 3, "y": 3}],
        "portals": [{"upper": {"x": 0, "y": 3}, "lower": {"x": 1, "y": 3}},
                    {"upper": {"x": 6, "y": 3}, "lower": {"x": 5, "y": 3}}],
        "art": [],
    }]
    state["characters"][0].update(x=2, y=3, routeId="lower", lightRadius=6, lightSource="torch",
        gear=[{"name": "Torch", "lit": True, "equipped": True}])
    state["player"].update(x=2, y=3, routeId="lower", torchLit=True, lightRadius=6)
    state["entities"].append({"id": "above", "type": "monster", "name": "Orc", "x": 3, "y": 3,
        "routeId": "", "hp": 30, "maxHp": 30, "visible": True, "hostile": False,
        "attitude": "neutral", "attitudeChecked": True})
    return state


def test_authoritative_route_movement_and_motion_frames_cannot_turn_at_the_crossing():
    result = game_runtime.apply(crossing(), {"type": "move_batch", "character_id": "host-char",
        "moves": [{"dx": 1, "dy": 0}], "motion_id": "underpass-test-0001"})
    hero = result["state_json"]["characters"][0]
    assert (hero["x"], hero["y"], hero["routeId"]) == (3, 3, "lower")
    assert result["state_json"]["entities"][-1]["hp"] == 30
    blocked = game_runtime.apply(result["state_json"], {"type": "move", "character_id": "host-char", "dx": 0, "dy": -1})
    assert (blocked["state_json"]["characters"][0]["x"], blocked["state_json"]["characters"][0]["y"]) == (3, 3)
    assert result["state_json"]["multiplayerMotions"][-1]["frames"][-1]["routeId"] == "lower"


def test_underpass_state_rejects_invalid_coordinates_ids_and_cross_level_shortcuts():
    validate_state(crossing(), require_map=True)
    illustrated = crossing()
    illustrated["underpasses"][0]["art"] = [{"asset": "stairs-down-straight-1x2", "x": 2, "y": 3, "w": 2, "h": 1, "turn": 0}]
    validate_state(illustrated, require_map=True)
    for field, bad in [("id", "__proto__"), ("upperCrossings", [{"x": 6, "y": 6}]),
                       ("lowerCells", [{"x": 999, "y": 3}] * 5), ("portals", [])]:
        state = crossing()
        state["underpasses"][0][field] = bad
        with pytest.raises(ValueError, match="[Uu]nderpass"):
            validate_state(state, require_map=True)
    state = crossing()
    state["underpasses"].append(deepcopy(state["underpasses"][0]))
    state["underpasses"][1]["id"] = "overlapping"
    with pytest.raises(ValueError, match="separate"):
        validate_state(state, require_map=True)


def test_viewer_exploration_retains_both_levels_but_rejects_unknown_routes():
    saved = validate_viewer_visibility({"routeExplored": {"": ["3,3"], "lower": ["3,3", "4,3"]}}, crossing())
    assert saved["routeExplored"] == {"": ["3,3"], "lower": ["3,3", "4,3"]}
    with pytest.raises(ValueError, match="visibility"):
        validate_viewer_visibility({"routeExplored": {"not-a-route": ["3,3"]}}, crossing())


def test_multiplayer_room_round_trip_preserves_independent_route_and_guest_access(clients):
    host, guest, _ = clients
    response = post(host, "/api/rooms", {"state_json": crossing(), "options": {}})
    assert response.status_code == 201, response.json
    room = response.json
    view = join(guest, room)
    assert view["state_json"]["underpasses"][0]["id"] == "lower"
    result = command(host, room, "move", character_id="host-char", dx=1, dy=0)
    assert result.status_code == 200, result.json
    latest = guest.get(f"/api/rooms/{room['id']}").json
    assert latest["state_json"]["characters"][0]["routeId"] == "lower"


def pit_tunnel_state():
    state = dungeon()
    pits = [{"id": f"pit-{x}", "type": "feature", "subtype": "pit", "name": "Pit", "x": x, "y": 3,
             "routeId": "", "lowerRouteId": "pit-route", "cells": [{"x": x, "y": 3}], "visible": True, "revealed": True}
            for x in (2, 4)]
    state["entities"] = pits
    state["underpasses"] = [{"id": "pit-route", "kind": "pit-tunnel", "axis": "free", "artVersion": 2,
                            "lowerCells": [{"x": x, "y": 3} for x in range(2, 5)],
                            "upperCrossings": [{"x": x, "y": 3} for x in range(2, 5)],
                            "pitIds": [pit["id"] for pit in pits], "portals": [], "art": []}]
    hero = state["characters"][0]
    hero.update(x=1, y=3, routeId="", gear=[{"name": "Rope", "quantity": 1, "totalUnits": 1, "slots": 1}], conditions={})
    state["player"].update(x=1, y=3, routeId="")
    return state


def test_pit_network_validation_requires_connected_cells_and_real_pit_links():
    validate_state(pit_tunnel_state(), require_map=True)
    for change in ("disconnected", "missing-pit", "invalid-portal"):
        state = pit_tunnel_state()
        if change == "disconnected":
            state["underpasses"][0]["lowerCells"].append({"x": 6, "y": 6})
        elif change == "missing-pit":
            state["underpasses"][0]["pitIds"][1] = "not-a-pit"
        else:
            state["underpasses"][0]["portals"] = [{"upper": {"x": 1, "y": 3}, "lower": {"x": 2, "y": 3}}]
        with pytest.raises(ValueError, match="[Pp]it underpass"):
            validate_state(state, require_map=True)


def test_authoritative_rope_descent_enters_lower_route_without_damage_and_cannot_select_remote_pit():
    state = pit_tunnel_state()
    with pytest.raises(ValueError, match="pit action"):
        game_runtime.apply(state, {"type": "pit_action", "character_id": "host-char", "action": "descend", "pit_id": "pit-4"})
    result = game_runtime.apply(state, {"type": "pit_action", "character_id": "host-char", "action": "descend", "pit_id": "pit-2"})
    assert result["ok"], result
    hero = result["state_json"]["characters"][0]
    assert (hero["x"], hero["y"], hero["routeId"]) == (2, 3, "pit-route")
    assert hero["hp"] == state["characters"][0]["hp"]
    moved = game_runtime.apply(result["state_json"], {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0})
    assert moved["state_json"]["characters"][0]["routeId"] == "pit-route"
