from copy import deepcopy
import pytest
from game_runtime import game_runtime
from test_rooms import dungeon, character


def fight():
    state = dungeon()
    state["characters"][0].update(hp=100, maxHitPoints=100, lightSource="torch", lightRadius=6, gear=[{"name": "Torch", "quantity": 3}, {"name": "Sword", "quantity": 1}])
    state["player"].update(torchLit=True, lightSource="torch", lightRadius=6)
    state["visibility"] = {"visibleNow": [f"{x},{y}" for x in range(7) for y in range(7)]}
    state["entities"].append({"id": "m1", "type": "monster", "name": "Test Monster", "hp": 100,
        "maxHp": 100, "ac": 1, "x": 3, "y": 2, "roomId": "r1", "level": 1,
        "attack": "1 claw +99 (1d4)", "hostile": True, "visible": True, "attitude": "hostile"})
    state["combat"] = {"active": True, "round": 1, "turnIndex": 0, "movementRemaining": 6, "actionUsed": False,
        "playerOrderIds": ["host-char"], "monsterIds": ["m1"], "turnOrder": [{"type": "character", "id": "host-char"}, {"type": "monster", "id": "m1"}]}
    return state


def test_movement_is_applied_to_the_command_character():
    result = game_runtime.apply(dungeon(), {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0})
    assert (result["state_json"]["characters"][0]["x"], result["state_json"]["characters"][0]["y"]) == (3, 2)
    with pytest.raises(ValueError, match="adjacent"):
        game_runtime.apply(dungeon(), {"type": "move", "character_id": "host-char", "dx": 20, "dy": 0})


def door_scene():
    state = dungeon()
    state["characters"][0].update(lightSource="torch", lightRadius=6,
        gear=[{"name": "Torch", "lit": True, "equipped": True}])
    state["player"].update(torchLit=True, lightSource="torch", lightRadius=6)
    state["entities"].append({"id": "door", "type": "feature", "subtype": "door", "x": 4, "y": 2,
        "wallSide": "east", "orientation": "vertical", "doorState": "closed", "visible": True})
    near = character("Near", "near")
    near.update(x=3, y=2)
    state["characters"].append(near)
    return state


def test_authoritative_door_interaction_requires_the_command_actor_to_be_adjacent():
    state = door_scene()
    with pytest.raises(ValueError, match="next to the door"):
        game_runtime.apply(state, {"type": "interact", "character_id": "host-char", "x": 4, "y": 2})
    state["entities"].append({"id": "trap", "type": "trap", "targetType": "door", "targetEntityId": "door",
        "name": "Needle", "trigger": "Open door", "effect": "Damage"})
    result = game_runtime.apply(state, {"type": "interact", "character_id": "near", "x": 4, "y": 2})
    assert result["state_json"]["activeCharacterId"] == "near"
    assert (result["state_json"]["player"]["x"], result["state_json"]["player"]["y"]) == (3, 2)
    assert next(entity for entity in result["state_json"]["entities"] if entity["id"] == "door")["doorState"] == "open"
    assert next(entity for entity in result["state_json"]["entities"] if entity["id"] == "trap")["triggered"] is True
    assert result["state_json"]["activity"][-1]["characterId"] == "near"


def test_combat_door_interaction_cannot_switch_to_an_out_of_turn_neighbor():
    state = door_scene()
    state["combat"] = {"active": True, "round": 1, "turnIndex": 0, "movementRemaining": 6, "actionUsed": False,
        "turnOrder": [{"type": "character", "id": "host-char"}, {"type": "character", "id": "near"}],
        "playerOrderIds": ["host-char", "near"], "monsterIds": []}
    with pytest.raises(ValueError, match="next to the door"):
        game_runtime.apply(state, {"type": "interact", "character_id": "host-char", "x": 4, "y": 2})
    with pytest.raises(ValueError, match="turn"):
        game_runtime.apply(state, {"type": "interact", "character_id": "near", "x": 4, "y": 2})


def test_reviewed_terrain_blocks_runtime_movement_and_import_positions():
    state = dungeon()
    state["tiles"][2 * 7 + 3]["meta"] = {"layoutBlocks": True}
    blocked = game_runtime.apply(state, {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0})
    assert (blocked["state_json"]["characters"][0]["x"], blocked["state_json"]["characters"][0]["y"]) == (2, 2)
    for tile in state["tiles"]:
        if (tile["x"], tile["y"]) not in ((2, 2), (1, 2)):
            tile["meta"] = {"layoutBlocks": True}
    imported = game_runtime.apply(state, {"type": "import", "character_json": character("New"), "new_character_id": "new-char"})
    added = next(char for char in imported["state_json"]["characters"] if char["id"] == "new-char")
    assert (added["x"], added["y"]) == (1, 2)


def test_hall_stair_entrance_is_a_starting_room_for_trading():
    state = dungeon()
    state["rooms"][0]["reviewedTemplate"] = "hall-stair-entrance"
    state["entities"][0].update(type="door", subtype="door", doorKind="stairs-up", doorState="open", hiddenStairSprite=True)
    state["characters"][0]["gold"] = 10
    bought = game_runtime.apply(state, {"type": "buy_gear", "character_id": "host-char", "item_id": "torch"})
    assert any("torch" in item["name"].lower() for item in bought["state_json"]["characters"][0]["gear"])


def test_isolated_canal_sentry_uses_ranged_attack_without_leaving_bank():
    state = fight()
    state["entities"][-1].update(x=5, y=2, canalSentry=True, attack="1 claw +99 (1d4), or 1 bow +99 (1d4), far")
    turn = game_runtime.apply(state, {"type": "end_turn", "character_id": "host-char", "online_character_ids": ["host-char"]})
    monster = next(entity for entity in turn["state_json"]["entities"] if entity["id"] == "m1")
    assert (monster["x"], monster["y"]) == (5, 2)
    assert turn["state_json"]["characters"][0]["hp"] < 100


def test_movement_batch_applies_each_step_in_order():
    result = game_runtime.apply(dungeon(), {"type": "move_batch", "character_id": "host-char",
        "motion_id": "movement-request-0001", "motion_actor_id": "host-member", "moves": [
        {"dx": 1, "dy": 0}, {"dx": 1, "dy": 0}, {"dx": 0, "dy": 1},
    ]})

    assert (result["state_json"]["characters"][0]["x"], result["state_json"]["characters"][0]["y"]) == (4, 3)
    motion = result["state_json"]["multiplayerMotions"][-1]
    assert motion["id"] == "movement-request-0001"
    assert motion["actorId"] == "host-member"
    assert [(frame["x"], frame["y"]) for frame in motion["frames"]] == [
        (2, 2), (3, 2), (4, 2), (4, 3)
    ]


def test_combat_attack_uses_action_and_monster_turn_completes():
    state = fight()
    attack = game_runtime.apply(state, {"type": "attack", "character_id": "host-char", "monster_id": "m1", "attack_index": 0})
    assert "attacks" in attack["message"], attack["message"]
    assert attack["state_json"]["combat"]["actionUsed"] is True
    assert attack["state_json"]["entities"][-1]["hp"] < 100
    turn = game_runtime.apply(attack["state_json"], {"type": "end_turn", "character_id": "host-char", "online_character_ids": ["host-char"]})
    assert turn["state_json"]["combat"]["round"] == 2, turn["message"]
    assert turn["state_json"]["characters"][0]["hp"] < 100
    assert turn["state_json"]["combat"]["turnOrder"][turn["state_json"]["combat"]["turnIndex"]]["id"] == "host-char"


def test_wrong_combat_turn_cannot_move_and_rolls_are_bounded():
    state = fight()
    state["combat"]["turnIndex"] = 1
    with pytest.raises(ValueError, match="turn"):
        game_runtime.apply(state, {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0})
    roll = game_runtime.apply(dungeon(), {"type": "roll", "character_id": "host-char", "sides": 6, "count": 2, "modifier": 3})
    assert 5 <= roll["dice"]["total"] <= 15
    with pytest.raises(ValueError, match="dice"):
        game_runtime.apply(dungeon(), {"type": "roll", "character_id": "host-char", "sides": 6, "count": 100000, "modifier": 0})


def test_sheet_edit_cannot_change_position_or_resurrect_dead_characters():
    state = dungeon()
    state["characters"][0].update(dead=True, slain=True, hp=0)
    result = game_runtime.apply(state, {"type": "edit_character", "character_id": "host-char", "character_json": {
        "x": 6, "y": 6, "dead": False, "slain": False, "hp": 8, "name": "Updated", "raw": {"dead": False}}})
    char = result["state_json"]["characters"][0]
    assert char["x"] == 2 and char["y"] == 2
    assert char["dead"] is True and char["hp"] == 0


def test_shared_damage_roll_is_logged_and_bounded():
    result = game_runtime.apply(dungeon(), {"type": "roll", "character_id": "host-char", "expression": "2d6+3x2"})
    assert 10 <= result["dice"]["total"] <= 30
    assert "2d6+3x2" in result["state_json"]["activity"][-1]["message"]
    for expression in ("999999d6", "1d0", "0d6", "100d6+100d6", "1d6x999999", "process.exit()"):
        with pytest.raises(ValueError, match="dice"):
            game_runtime.apply(dungeon(), {"type": "roll", "character_id": "host-char", "expression": expression})


def test_combat_occupancy_allows_passing_characters_but_not_ending_on_them():
    state = fight()
    state["entities"][-1].update(x=6, y=6, attitudeChecked=True)
    other = character("Friend", "friend")
    other.update(x=3, y=2)
    state["characters"].append(other)
    state["combat"]["movementRemaining"] = 2
    passed = game_runtime.apply(state, {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0})
    assert passed["state_json"]["characters"][0]["x"] == 3
    state["combat"]["movementRemaining"] = 1
    stopped = game_runtime.apply(state, {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0})
    assert stopped["state_json"]["characters"][0]["x"] == 2
    assert "can't end turn on Friend" in stopped["message"]
    state["entities"][-1].update(x=3, y=2)
    blocked = game_runtime.apply(state, {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0})
    assert blocked["state_json"]["characters"][0]["x"] == 2
    assert "blocks the way" in blocked["message"]


def test_lighting_and_equipment_use_combat_actions_and_inactive_sheets_cannot_edit():
    state = fight()
    equipped = game_runtime.apply(state, {"type": "equip", "character_id": "host-char", "gear_index": 1, "equipped": True})
    assert equipped["state_json"]["combat"]["actionUsed"] is True
    with pytest.raises(ValueError, match="already acted"):
        game_runtime.apply(equipped["state_json"], {"type": "light", "character_id": "host-char", "source": "torch"})
    with pytest.raises(ValueError, match="sheet edits"):
        game_runtime.apply(state, {"type": "edit_character", "character_id": "host-char", "character_json": {"hp": 999}})
    state["combat"]["turnIndex"] = 1
    with pytest.raises(ValueError, match="turn"):
        game_runtime.apply(state, {"type": "light", "character_id": "host-char", "source": "torch"})


def test_attack_history_is_shared_with_raw_roll_and_ability_breakdown():
    result = game_runtime.apply(fight(), {"type": "attack", "character_id": "host-char", "monster_id": "m1", "attack_index": 0})
    assert "1d20 = " not in result["message"]
    hover = "".join(part["text"] for segment in result["state_json"]["rollHistory"][0]["segments"] for part in segment.get("tooltip", []))
    assert "1d20 = " in hover
    assert "STR" in hover
    # Status formatting supplies final sentence punctuation without changing history.
    assert result["state_json"]["rollHistory"][0]["detail"].removesuffix(".") == result["message"].removesuffix(".")
    assert result["state_json"]["rollHistory"][0]["segments"]


def test_followers_move_one_lit_step_with_motion_frames_and_stop_in_combat():
    state = dungeon()
    state["characters"][0].update(lightSource="torch", lightRadius=6, gear=[{"name": "Torch", "lit": True, "equipped": True}])
    state["player"].update(torchLit=True, lightSource="torch", lightRadius=6)
    follower = character("Follower", "follower")
    follower.update(x=2, y=4)
    state["characters"].append(follower)
    command = {"type": "move", "character_id": "host-char", "dx": 1, "dy": 0,
        "marching_order": ["host-char", "follower"], "following_ids": ["follower"],
        "follow_group_id": "member", "motion_id": "test-follow-motion-0001", "motion_actor_id": "member"}
    result = game_runtime.apply(state, command)
    moved = result["state_json"]["characters"][1]
    assert (moved["x"], moved["y"]) != (2, 4)
    assert max(abs(moved["x"] - 2), abs(moved["y"] - 4)) == 1
    assert any(motion["characterId"] == "follower" for motion in result["state_json"]["multiplayerMotions"])
    combat = fight()
    combat["characters"].append(follower)
    command["dx"], command["dy"] = 0, 1
    result = game_runtime.apply(combat, command)
    assert (result["state_json"]["characters"][1]["x"], result["state_json"]["characters"][1]["y"]) == (2, 4)
