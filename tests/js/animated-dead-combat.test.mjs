import test from 'node:test';
import assert from 'node:assert/strict';
import { animatedDeadInitiativeCharacters, animatedDeadPlayerEntries, insertAnimatedDeadTurns } from '../../S3_content/src/animated-dead-combat.js';

const child = (id, owner = 'caster') => ({ id, hp: 11, companion: { kind: 'animate-dead', controllerCharacterId: owner } });
const entries = ids => ids.map(id => ({ type: 'character', id }));

test('undead have separate consecutive turns after the caster despite marching order', () => {
  const state = { characters: [child('one'), { id: 'ally' }, { id: 'caster' }, child('two')] };
  assert.deepEqual(animatedDeadPlayerEntries(state, ['one', 'ally', 'caster', 'two']), entries(['ally', 'caster', 'one', 'two']));
  assert.deepEqual(animatedDeadInitiativeCharacters(state, state.characters).map(actor => actor.id), ['ally', 'caster']);
});

test('dead and removed caster anchors preserve surviving children, including later rounds', () => {
  for (const caster of [{ id: 'caster', dead: true }, null]) {
    const state = { characters: [child('one'), { id: 'ally' }, ...(caster ? [caster] : []), child('two')] };
    assert.deepEqual(animatedDeadPlayerEntries(state, ['caster', 'ally']), entries(['one', 'two', 'ally']));
    const rolls = animatedDeadInitiativeCharacters(state, state.characters);
    assert.deepEqual(rolls.map(actor => actor.id), ['one', 'ally']);
    assert.deepEqual(animatedDeadPlayerEntries(state, ['ally', 'one']), entries(['ally', 'one', 'two']));
  }
});

test('sleeping or dying casters do not suppress their undead group', () => {
  for (const condition of [{ hp: 0, dyingRounds: 2 }, { hp: 10, conditions: { sleeping: true } }]) {
    const state = { characters: [{ id: 'caster', ...condition }, child('one')] };
    assert.deepEqual(animatedDeadPlayerEntries(state, ['caster']), entries(['caster', 'one']));
  }
});

test('new undead insert after caster without spending movement, restarting turn, or creating duplicates', () => {
  const state = { characters: [{ id: 'caster' }, child('one'), child('two'), { id: 'ally' }],
    combat: { active: true, turnOrder: entries(['caster', 'ally']), playerOrderIds: ['caster', 'ally'],
      turnIndex: 0, actionUsed: true, movementRemaining: 3 } };
  insertAnimatedDeadTurns(state);
  insertAnimatedDeadTurns(state);
  assert.deepEqual(state.combat.turnOrder, entries(['caster', 'one', 'two', 'ally']));
  assert.equal(state.combat.turnIndex, 0);
  assert.equal(state.combat.actionUsed, true);
  assert.equal(state.combat.movementRemaining, 3);
});

test('normalization preserves the current actor and surprise exclusions', () => {
  const state = { characters: [{ id: 'caster' }, child('one'), { id: 'ally' }],
    combat: { active: true, turnOrder: entries(['caster', 'ally']), playerOrderIds: ['caster', 'ally'], turnIndex: 1 } };
  insertAnimatedDeadTurns(state);
  assert.equal(state.combat.turnOrder[state.combat.turnIndex].id, 'ally');
  state.combat = { active: true, surpriseRound: true, surpriseParticipantIds: ['ally'],
    turnOrder: entries(['ally']), playerOrderIds: ['caster', 'ally'], turnIndex: 0 };
  insertAnimatedDeadTurns(state);
  assert.deepEqual(state.combat.turnOrder, entries(['ally']));
});
