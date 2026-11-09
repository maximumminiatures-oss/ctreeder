import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { circleBlocksHostileAction, circleBlocksMentalControl } from '../../S3_content/src/magic-circle.js';
import { isGaseousForm } from '../../S3_content/src/conditions.js';

const source = readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const attackSource = source.slice(source.indexOf('function applyMonsterAttack('), source.indexOf('async function runMonsterTurn('));

test('animated monster attacks rebind normalized actors before Luck capture and HP changes', () => {
  for (const hit of [false, true]) {
    const oldMonster = { id: 'foe', name: 'Bandit', hp: 10, ambushAttack: true };
    const oldTarget = { id: 'hero', name: 'Hero', hp: 20, armorClass: 10 };
    const monster = { ...oldMonster, type: 'monster' }, target = { ...oldTarget };
    const state = { entities: [monster], characters: [target], combat: { surpriseRound: false } };
    let captured = false;
    const context = vm.createContext({ state, isLiveMonster: actor => actor.hp > 0, isIllusionCreature: actor => actor?.illusion?.kind === 'creature',
      circleBlocksHostileAction, circleBlocksMentalControl, isGaseousForm,
      isCharacterTargetableByMonster: actor => actor.hp > 0, sameRoute: () => true,
      transformationMovementRules: () => ({}), blocksMindControl: () => false,
      hasWizardEffect: () => false, isStealthed: () => false, canCharacterSeeMonster: () => true,
      protectionDisadvantage: () => false, isInvisible: () => false, transformationAttackDisadvantage: () => false,
      conditionAttackMode: () => ({}), getMonsterDistanceToCharacter: () => 1,
      rollCheck: () => ({ roll: hit ? 20 : 1, total: hit ? 20 : 1 }),
      revealAfterOffense() {}, detectThoughtsModifiers: () => ({ armorClass: 0 }),
      luckActorRef: actor => ({ id: actor.id }), beginLuckEvent: () => ({ context: {} }),
      captureLuckActor: (_event, actor) => { assert.equal(actor, target); captured = true; },
      finishLuckEvent() {}, attackRollSegments: () => [{ text: 'Attack resolved.' }], pushDiceHistory() {},
      interceptMirrorImageHit: () => null, rollDamageExpression: () => ({ total: 4, multiplier: 1 }),
      attackDamageMultiplier: () => 1, elementalDamage: (_actor, amount) => ({ total: amount }),
      setCharacterHp: (actor, hp) => { assert.equal(actor, target); actor.hp = hp; },
      clearMagicLightIfIncapacitated() {}, syncCharacterDyingRaw() {}, applyDamageResultToPanel() {} });
    vm.runInContext(attackSource, context);
    context.applyMonsterAttack(oldMonster, oldTarget, { name: 'Dagger', rangeInfo: { maxRange: 1 }, damageExpression: '1d4' });
    assert.equal(captured, true);
    assert.equal(target.hp, hit ? 16 : 20);
    assert.equal(oldTarget.hp, 20);
    assert.equal(monster.ambushAttack, null); assert.equal(oldMonster.ambushAttack, true);
  }
});
