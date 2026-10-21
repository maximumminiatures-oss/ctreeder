from copy import deepcopy

import pytest

from game_runtime import game_runtime
from test_rooms import dungeon, character


def lit_party():
    state = dungeon()
    actor = state['characters'][0]
    actor.update(hp=100, maxHitPoints=100, lightSource='', lightRadius=0, gear=[])
    ally = character('Light bearer', 'light-bearer')
    ally.update(x=2, y=3, hp=100, maxHitPoints=100, lightSource='torch', lightRadius=6,
                gear=[{'name': 'Torch', 'lit': True, 'equipped': True}])
    state['characters'].append(ally)
    return state


def test_search_uses_another_characters_light_and_wisdom():
    state = lit_party()
    state['characters'][0]['stats']['WIS'] = 18
    result = game_runtime.apply(state, {'type': 'search', 'character_id': 'host-char'})
    assert 'dark' not in result['message'].lower()
    assert result['state_json']['timers']['torchElapsedMs'] >= 600000


def test_remote_loot_cannot_be_collected_but_an_adjacent_party_member_can_help():
    state = lit_party()
    loot = {'id': 'remote-loot', 'type': 'treasure', 'name': 'Gem', 'kind': 'gem',
            'x': 5, 'y': 5, 'roomId': 'r1', 'visible': True, 'value': 1, 'slots': 1}
    state['entities'].append(loot)
    denied = game_runtime.apply(state, {'type': 'pickup', 'character_id': 'host-char', 'entity_id': loot['id']})
    assert 'beside' in denied['message']
    assert not next(e for e in denied['state_json']['entities'] if e['id'] == loot['id']).get('collected')
    state['characters'][1].update(x=4, y=5)
    collected = game_runtime.apply(state, {'type': 'pickup', 'character_id': 'host-char', 'entity_id': loot['id']})
    assert next(e for e in collected['state_json']['entities'] if e['id'] == loot['id'])['collected']


def test_tied_character_cannot_bypass_restrictions_with_commands():
    state = lit_party()
    state['characters'][0]['conditions'] = {'tied': {'dc': 1}}
    for command in [{'type': 'move', 'dx': 1, 'dy': 0}, {'type': 'search'}, {'type': 'ancestry_invisibility'}]:
        with pytest.raises(ValueError, match='rope'):
            game_runtime.apply(deepcopy(state), {**command, 'character_id': 'host-char'})
    escaped = game_runtime.apply(state, {'type': 'pit_action', 'action': 'escape', 'character_id': 'host-char'})
    assert not escaped['state_json']['characters'][0].get('conditions', {}).get('tied')


def missile_scene():
    state = dungeon()
    actor = state['characters'][0]
    actor.update(className='Wizard', hp=100, maxHitPoints=100, lightSource='', lightRadius=0, gear=[],
                 pendingSpell={'spell': 'magic missile', 'phase': 'targeting', 'remaining': 2,
                               'total': 2, 'spent': [], 'diceSides': 4})
    state['player'].update(torchLit=False, lightSource='', lightRadius=0)
    state['entities'].append({'id': 'hidden', 'type': 'monster', 'name': 'Test Monster', 'x': 4, 'y': 2,
                              'hp': 100, 'maxHp': 100, 'ac': 10, 'level': 1, 'hostile': True,
                              'attitude': 'combat', 'attitudeChecked': True, 'I': 0, 'attack': '1 claw +0 (1d4)'})
    state['combat'] = {'active': True, 'round': 1, 'turnIndex': 0, 'movementRemaining': 6, 'actionUsed': True,
                       'turnOrder': [{'type': 'character', 'id': 'host-char'}, {'type': 'monster', 'id': 'hidden'}],
                       'playerOrderIds': ['host-char'], 'monsterIds': ['hidden']}
    return state


def test_magic_missile_guessed_square_is_authoritative_and_empty_squares_spend_it():
    state = missile_scene()
    hit = game_runtime.apply(state, {'type': 'resolve_spell', 'character_id': 'host-char', 'blind': True, 'x': 4, 'y': 2})
    monster = next(e for e in hit['state_json']['entities'] if e['id'] == 'hidden')
    assert 96 <= monster['hp'] <= 99
    assert monster['darkGuess']['x'] == 4
    assert hit['state_json']['characters'][0]['pendingSpell']['remaining'] == 1
    missed = game_runtime.apply(missile_scene(), {'type': 'resolve_spell', 'character_id': 'host-char', 'blind': True, 'x': 4, 'y': 3})
    assert next(e for e in missed['state_json']['entities'] if e['id'] == 'hidden')['hp'] == 100
    assert missed['state_json']['characters'][0]['pendingSpell']['remaining'] == 1


def test_animated_armor_reveals_on_the_adjacent_movement_command():
    state = lit_party()
    state['entities'].append({'id': 'armor', 'type': 'monster', 'name': 'Animated Armor', 'x': 4, 'y': 2,
                              'hp': 100, 'maxHp': 100, 'ac': 15, 'level': 2, 'hostile': False,
                              'attitude': 'neutral', 'attitudeChecked': True, 'attack': '1 longsword +0 (1d8)'})
    moved = game_runtime.apply(state, {'type': 'move', 'character_id': 'host-char', 'dx': 1, 'dy': 0})
    armor = next(e for e in moved['state_json']['entities'] if e['id'] == 'armor')
    assert armor['disguiseRevealed']
    assert armor['hostile']


def test_friendly_class_named_monsters_can_equip_fighter_gear():
    state = lit_party()
    actor = state['characters'][0]
    actor.update(className='Wizard', companion={'kind': 'friendly', 'source': {'name': 'Mage', 'ac': 10}},
                 gear=[{'name': 'Shield', 'type': 'armor', 'equipped': False, 'quantity': 1, 'slots': 1}])
    result = game_runtime.apply(state, {'type': 'equip', 'character_id': 'host-char', 'gear_index': 0, 'equipped': True})
    assert result['state_json']['characters'][0]['gear'][0]['equipped']
    assert result['state_json']['characters'][0]['armorClass'] == 12
