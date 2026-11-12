import test from 'node:test';
import assert from 'node:assert/strict';
import { monsterIntelligence, selectMonsterAiTarget, planMonsterCover } from '../../S3_content/src/monster-ai.js';
import { makeUnderpass } from '../../S3_content/src/underpasses.js';

const attacks = [{ name: 'claw', averageDamage: 8 }, { name: 'bow', averageDamage: 3 }];
const targets = [{ id: 'near', hp: 8, distance: 1 }, { id: 'weak', hp: 1, distance: 5 },
  { id: 'wizard', className: 'Wizard', hp: 12, distance: 7 }];
function choose(intelligence, extra = {}) {
  return selectMonsterAiTarget({ intelligence, targets, attacks, distance: target => target.distance, random: () => 0,
    planAttack: (target, attack) => target.distance <= (attack.name === 'claw' ? 6 : 8) ? { steps: [] } : null, ...extra });
}

test('Intelligence modifiers use exact -2/-1/0/1/2/3 boundaries', () => {
  assert.equal(monsterIntelligence({ '**I**': '+3' }), 3);
  assert.equal(monsterIntelligence({ I: -2 }), -2);
  assert.equal(choose(-2).target.id, 'near');
  assert.equal(choose(-1), null);
  assert.equal(choose(0), null);
  for (const intelligence of [1, 2]) {
    assert.equal(choose(intelligence).target.id, 'weak');
    assert.equal(choose(intelligence).attack.name, 'claw');
  }
  assert.equal(choose(3).target.id, 'wizard');
  assert.equal(choose(3).attack.name, 'bow');
});

test('smart targeting falls back from an unreachable wizard and never picks unreachable low HP for this turn', () => {
  for (const intelligence of [1, 2, 3, 4]) {
    const result = choose(intelligence, { planAttack: target => target.id === 'near' ? { steps: [] } : null });
    assert.equal(result.target.id, 'near');
    assert.equal(result.attack.name, 'claw');
  }
});

test('nearest and equal-HP ties are randomized without mutating input', () => {
  const tied = [{ id: 'a', hp: 1, distance: 1 }, { id: 'b', hp: 1, distance: 1 }];
  for (const intelligence of [-2, 1, 2, 3]) {
    assert.equal(choose(intelligence, { targets: tied, random: () => .99 }).target.id, 'b');
  }
  assert.deepEqual(attacks.map(attack => attack.name), ['claw', 'bow']);
});

const scene = () => ({ map: { width: 12, height: 3 }, tiles: [] });
const coverOptions = extra => ({ movement: 2, canStep: (_from, next) => next.y === 1,
  isCover: point => point.x >= 5, ...extra });

test('cover planner reaches nearby darkness or party line-of-sight cover using remaining movement', () => {
  for (const isCover of [point => point.x >= 2, point => point.x === 2 && point.y === 1]) {
    const plan = planMonsterCover(scene(), { x: 0, y: 1 }, coverOptions({ isCover }));
    assert.equal(plan.x, 2); assert.equal(plan.cost, 2); assert.equal(plan.reachesCover, true);
  }
});

test('distant cover produces only an affordable prefix and respects departure water costs', () => {
  const plan = planMonsterCover(scene(), { x: 0, y: 1 }, coverOptions({ movement: 3, stepCost: x => x === 0 ? 2 : 1 }));
  assert.equal(plan.x, 2); assert.equal(plan.cost, 3); assert.equal(plan.reachesCover, false);
  assert.equal(plan.steps.length, 2);
});

test('cover stays on actual underpass routes', () => {
  const state = scene();
  state.underpasses = [makeUnderpass('below', Array.from({ length: 8 }, (_, x) => ({ x: x + 2, y: 1 })),
    { x: 6, y: 1 }, [{ x: 1, y: 1 }, { x: 10, y: 1 }])];
  const plan = planMonsterCover(state, { x: 4, y: 1, routeId: 'below' }, coverOptions({ isCover: point => point.x === 6 }));
  assert.equal(plan.routeId, 'below'); assert.ok(plan.steps.every(step => step.routeId === 'below'));
});

test('no cover, no path, zero budget, bad costs and bounded searches terminate', () => {
  const monster = { x: 0, y: 1 };
  for (const extra of [{ isCover: () => false }, { canStep: () => false }, { movement: 0 },
    { stepCost: () => 0 }, { stepCost: () => NaN }, { stepCost: () => -1 }, { maxNodes: 1 }, { isCover: () => true }])
    assert.equal(planMonsterCover(scene(), monster, coverOptions(extra)), null);
});
