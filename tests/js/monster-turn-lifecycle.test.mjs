import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { beginLuckEvent, finishLuckEvent } from '../../S3_content/src/luck.js';
import { captureRuntimeLuckActor } from '../../S3_content/src/luck-runtime.js';

const source = readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const attackSource = source.slice(source.indexOf('function applyMonsterAttack(monster,'), source.indexOf('async function runMonsterTurn('));
const turnSource = source.slice(source.indexOf('async function runAutoMonsterTurns('), source.indexOf('function handleCombatMovement('));

for (const name of ['Pirate', 'Beastman']) for (const hit of [false, true]) {
  test(`${name} finishes a ${hit ? 'hit' : 'miss'} after the animated turn replaces actor objects`, async () => {
    const oldMonster = { id: 'foe', type: 'monster', name, hp: 10, ambushAttack: true };
    const oldTarget = { id: 'hero', name: 'Hero', hp: 20, maxHitPoints: 20, armorClass: 10, raw: {} };
    const monster = { ...oldMonster }, target = structuredClone(oldTarget);
    const state = { entities: [monster], characters: [target], combat: { active: true, surpriseRound: false,
      turnIndex: 0, turnOrder: [{ id: 'foe', type: 'monster' }, { id: 'hero', type: 'character' }] } };
    let logged = 0, nextTurnStarted = false;
    const attack = { name: 'Dagger', rangeInfo: { maxRange: 1 }, damageExpression: '1d4' };
    const context = vm.createContext({ state, isLiveMonster: actor => actor.hp > 0,
      isCharacterTargetableByMonster: actor => actor.hp > 0, sameRoute: () => true,
      transformationMovementRules: () => ({}), blocksMindControl: () => false,
      hasWizardEffect: () => false, isStealthed: () => false, canCharacterSeeMonster: () => true,
      protectionDisadvantage: () => false, isInvisible: () => false, transformationAttackDisadvantage: () => false,
      conditionAttackMode: () => ({}), getMonsterDistanceToCharacter: () => 1,
      rollCheck: () => ({ roll: hit ? 19 : 2, modifier: 0, total: hit ? 19 : 2 }),
      revealAfterOffense() {}, detectThoughtsModifiers: () => ({ armorClass: 0 }),
      luckActorRef: actor => ({ collection: state.characters.includes(actor) ? 'characters' : 'entities', id: actor.id }),
      beginLuckEvent: (world, options) => beginLuckEvent(world, structuredClone(options)),
      captureLuckActor: (event, actor) => captureRuntimeLuckActor(state, event, actor), finishLuckEvent,
      attackRollSegments: () => [{ text: 'Attack resolved.' }], pushDiceHistory() { logged++; },
      interceptMirrorImageHit: () => null, rollDamageExpression: () => ({ total: 4, multiplier: 1 }),
      attackDamageMultiplier: () => 1, elementalDamage: (_actor, amount) => ({ total: amount }),
      setCharacterHp: (actor, hp) => { assert.equal(actor, target); actor.hp = hp; },
      clearMagicLightIfIncapacitated() {}, syncCharacterDyingRaw() {}, applyDamageResultToPanel() {},
      SERVER_RUNTIME: false, isSharedRoom: () => false, ensureCombatState: () => state.combat,
      isCombatActive: () => state.combat.active,
      getCurrentCombatEntry: () => state.combat.turnOrder[state.combat.turnIndex],
      announceCurrentTurn: async () => {}, delay: async () => {}, getMonsterById: () => oldMonster,
      runMonsterTurn: async () => context.applyMonsterAttack(oldMonster, oldTarget, attack),
      pushCombatLog() {}, checkCombatEnd: () => false, detectAdditionalCombatMonsters() {},
      startCurrentCombatTurn() { nextTurnStarted = true; }, setStatus() {}, render() {}, updatePanels() {} });
    vm.runInContext(attackSource + turnSource, context);
    await context.runAutoMonsterTurns();
    assert.equal(logged, 1);
    assert.equal(target.hp, hit ? 16 : 20);
    assert.equal(oldTarget.hp, 20);
    assert.equal(monster.ambushAttack, null);
    assert.equal(state.luckJournal.events.length, hit ? 1 : 0);
    if (hit) assert.equal(state.luckJournal.events[0].target.collection, 'characters');
    assert.equal(state.combat.turnIndex, 1);
    assert.equal(state.combat.autoRunning, false);
    assert.equal(nextTurnStarted, true);
    target.hp = 0;
    assert.equal(context.applyMonsterAttack(oldMonster, oldTarget, attack), '');
    state.characters = [];
    assert.equal(context.applyMonsterAttack(oldMonster, oldTarget, attack), '');
    state.entities = [];
    assert.equal(context.applyMonsterAttack(oldMonster, oldTarget, attack), '');
  });
}
