import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseMonsterAttack, monsterAttackSegments, monsterAttackSequence } from '../../S3_content/src/monster-attacks.js';
import { monsterIntelligence, selectMonsterAiTarget, planMonsterCover } from '../../S3_content/src/monster-ai.js';
import { planFiringPosition, findPursuitStep, planDarkReposition } from '../../S3_content/src/pursuit.js';
import { routeStep, routeOf, sameRoute, makeUnderpass } from '../../S3_content/src/underpasses.js';
import { normalizeDamageExpression } from '../../S3_content/src/damage.js';
import { beginLuckEvent, finishLuckEvent } from '../../S3_content/src/luck.js';
import { captureRuntimeLuckActor } from '../../S3_content/src/luck-runtime.js';
import { conditionAttackMode, isSleeping, wakeCreature } from '../../S3_content/src/conditions.js';

const source = readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const parser = source.slice(source.indexOf('function parseMonsterAttackSegment('), source.indexOf('function appendMonsterAttackSegment('));
const helpers = source.slice(source.indexOf('function getMonsterAttackOptions('), source.indexOf('function applyMonsterAttack(monster,'));
const turnSource = source.slice(source.indexOf('async function runMonsterTurn('), source.indexOf('async function runAutoMonsterTurns('));
const hero = (id, x, hp = 10, extra = {}) => ({ id, name: id, x, y: 1, hp, className: 'Fighter', ...extra });

function runtime(characters, extra = {}) {
  const monster = { id: 'foe', name: 'Beast', type: 'monster', x: 0, y: 1, hp: 20, I: 0,
    movement: 'near', attack: '2 claws +4 (1d8)', ...extra.monster };
  const state = { map: { width: 15, height: 3 }, entities: [monster], characters, combat: { round: 1 }, ...extra.state };
  const moves = [], attacks = [];
  const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  const math = Object.create(Math); math.random = extra.random || (() => 0);
  const context = vm.createContext({ state, Math: math, RANGE_LIMITS: { close: 1, near: 6, far: 12 },
    parseMonsterAttack, monsterAttackSegments, monsterAttackSequence, monsterIntelligence, selectMonsterAiTarget, planMonsterCover,
    planFiringPosition, findPursuitStep, planDarkReposition, normalizeDamageExpression, routeStep, routeOf, sameRoute,
    prettifyAttackName: name => name,
    parseSignedNumber: (value, fallback) => Number.parseInt(value, 10) || fallback,
    getAttackDamageExpression: attack => attack.detail.match(/\((\d+d\d+|\d+)/)?.[1] || '',
    getAttackRangeInfo: segment => ({ maxRange: /near/.test(segment) ? 6 : 1, hasNear: /near/.test(segment),
      hasClose: !/near/.test(segment), isCloseOnly: !/near/.test(segment), ranges: new Set([/near/.test(segment) ? 'near' : 'close']) }),
    getMonsterById: id => state.entities.find(actor => actor.id === id),
    getLiveMonsters: () => state.entities.filter(actor => actor.hp > 0), isLiveMonster: actor => actor?.hp > 0,
    isCharacterTargetableByMonster: actor => !actor.dead && !actor.stealthed && !actor.gaseous,
    hasCharacterMapPosition: actor => Number.isFinite(actor.x), isCharacterDead: actor => !!actor.dead,
    isFloatingDisc: () => false, isIllusionCreature: () => false,
    getMonsterDistanceToCharacter: distance,
    withinTargetRange: (actor, target, range) => distance(actor, target) <= range,
    canTargetAtRange: (_state, actor, target, range) => sameRoute(state, actor, target) && distance(actor, target) <= range,
    canMonsterSeeCharacter: (actor, target) => sameRoute(state, actor, target) && !actor.conditions?.blind && !target.hidden &&
      (!extra.sight || extra.sight(actor, target)),
    creatureSight: (actor, target) => !extra.sight || extra.sight(actor, target),
    monsterCanPlanStep: (actor, fromX, fromY, x, y, point) => x >= 0 && y >= 0 && x < 15 && y < 3 &&
      !state.characters.some(target => target.x === x && target.y === y && !target.dead) &&
      (!extra.canStep || extra.canStep({ x: fromX, y: fromY }, { x, y, routeId: point.routeId })),
    movementStepCost: (_state, x, y) => extra.stepCost?.(x, y) ?? 1,
    monsterFiringPosition: (actor, target, range, movement, options) => planFiringPosition(state, actor, target, {
      movement, ...options, canStep: (fx, fy, x, y, point) => context.monsterCanPlanStep(actor, fx, fy, x, y, point),
      canAttackFrom: (x, y, point) => sameRoute(state, point, target) && distance({ x, y }, target) <= range,
      stepCost: (x, y) => context.movementStepCost(state, x, y) }),
    isIncorporeal: actor => !!actor.conditions?.incorporeal, canPhase: () => false,
    isSleeping: actor => !!actor.conditions?.sleeping, isProne: actor => !!actor.conditions?.prone,
    isRestrainedByWeb: (_state, actor) => !!actor.web, isTied: actor => !!actor.tied,
    escapeWeb: () => ({ message: 'Escapes web.' }), escapeRope: () => ({ escaped: false, check: { total: 1 }, dc: 12 }), pitActionOptions: () => ({}),
    circleBlocksHostileAction: (_state, _actor, target) => !!target.protected,
    circleBlocksMentalControl: () => false, blocksMindControl: () => false,
    transformationMovementRules: () => ({}), hasWizardEffect: () => false, silenceBlocksAction: () => false,
    isDoppelganger: actor => !!actor.doppelganger, shouldRepositionAfterDarkGuess: () => false,
    resolveDetectThoughtsResistance: () => [], tierTwoOptions: () => ({}), pushDiceHistory() {},
    getTileAt: () => ({ type: 'floor' }), getDoorBetween: () => null, getDoorAt: () => null,
    processIllusionContact: (_state, actor) => moves.push({ x: actor.x, y: actor.y }), checkSinkholeFall() {},
    canMoveBetweenTiles: () => ({ ok: true }), render() {}, updatePanels() {},
    isTileIlluminated: (_state, x, y, point) => extra.illuminated?.({ x, y, ...point }) ?? true,
    delay: async () => {
      if (extra.rebind) {
        state.entities = state.entities.map(actor => structuredClone(actor));
        state.characters = state.characters.map(actor => structuredClone(actor));
      }
    },
    applyMonsterAttack: (actor, target, attack) => {
      assert.equal(actor, state.entities.find(candidate => candidate.id === actor.id));
      assert.equal(target, state.characters.find(candidate => candidate.id === target.id));
      assert.ok(target.hp > 0);
      attacks.push({ targetId: target.id, name: attack.name, x: actor.x, y: actor.y, moves: moves.length });
      target.hp = Math.max(0, target.hp - (extra.damage ?? 2));
      return `${attack.name} hits ${target.id}.`;
    },
    ...extra.context
  });
  vm.runInContext(parser + helpers + turnSource, context);
  return { state, context, moves, attacks, run: () => context.runMonsterTurn(state.entities[0]) };
}

test('two claws kill, spend remaining movement, and attack a new conscious target after animated rebinding', async () => {
  const game = runtime([hero('first', 3, 1), hero('second', 6, 20)], { rebind: true });
  await game.run();
  assert.deepEqual(game.attacks.map(attack => attack.targetId), ['first', 'second']);
  assert.ok(game.attacks[0].moves > 0);
  assert.ok(game.attacks[1].moves > game.attacks[0].moves);
  assert.ok(game.moves.length <= 6);
  assert.equal(game.state.characters[0].hp, 0);
});

test('no movement between claws while any adjacent conscious target survives, including after a miss', async () => {
  for (const damage of [0, 2]) {
    const game = runtime([hero('adjacent', 1, 20), hero('far', 5, 1)], { damage });
    await game.run();
    assert.deepEqual(game.attacks.map(attack => attack.targetId), ['adjacent', 'adjacent']);
    assert.equal(game.moves.length, 0);
  }
});

test('each claw independently samples conscious eligible targets and excludes zero HP, sleeping and blocked targets', async () => {
  let draw = 0;
  const game = runtime([hero('a', 1, 20), hero('b', 1, 20, { y: 2 }), hero('down', 1, 0),
    hero('asleep', 1, 10, { conditions: { sleeping: {} } }), hero('protected', 1, 10, { protected: true })],
  { random: () => draw++ % 2 ? .99 : 0 });
  await game.run();
  assert.deepEqual(game.attacks.map(attack => attack.targetId), ['b', 'a']);
  assert.equal(game.moves.length, 0);
});

test('a sole eligible target does not consume redundant random draws before the actual attack dice', async () => {
  let draws = 0;
  const game = runtime([hero('hero', 1, 20)], { random: () => { draws++; return .5; } });
  await game.run();
  assert.equal(game.attacks.length, 2);
  assert.equal(draws, 1, 'only the initial legacy target selection samples randomness');
});

test('healthy sleepers remain attackable at every Intelligence threshold without moving between strikes', async () => {
  for (const I of [-2, -1, 0, 1, 2, 3]) {
    const game = runtime([hero('asleep', 1, 20, { conditions: { sleeping: {} } }), hero('dying', 1, 0, { y: 2 })], { monster: { I } });
    await game.run();
    assert.deepEqual(game.attacks.map(attack => attack.targetId), ['asleep', 'asleep']);
    assert.equal(game.moves.length, 0);
  }
});

test('sleeper fallback is based on attack eligibility, not unrelated awake party members', async () => {
  for (const awake of [hero('unreachable', 14), hero('protected', 1, 20, { protected: true })]) {
    const game = runtime([awake, hero('asleep', 1, 20, { y: 2, conditions: { sleeping: {} } })], { monster: { movement: '1' } });
    await game.run();
    assert.deepEqual(game.attacks.map(attack => attack.targetId), ['asleep', 'asleep']);
    assert.equal(game.moves.length, 0);
  }
});

test('after dropping the final awake target, the next strike can hit an adjacent sleeper without movement', async () => {
  const game = runtime([hero('awake', 1, 1), hero('asleep', 1, 20, { y: 2, conditions: { sleeping: {} } })]);
  await game.run();
  assert.deepEqual(game.attacks.map(attack => attack.targetId), ['awake', 'asleep']);
  assert.equal(game.moves.length, 0);
});

test('blind remembered-square fallback can hit a sleeper but does not track an awake target elsewhere', async () => {
  const game = runtime([hero('asleep', 1, 20, { conditions: { sleeping: {} } }), hero('elsewhere', 4, 20)], {
    monster: { conditions: { blind: {} }, blindTargetMemory: [{ x: 1, y: 1 }] }
  });
  await game.run();
  assert.deepEqual(game.attacks.map(attack => attack.targetId), ['asleep', 'asleep']);
  assert.equal(game.moves.length, 0);
});

test('actual attacks against Sleep and rest sleepers preserve condition advantage and ranged disadvantage', async () => {
  const attackSource = source.slice(source.indexOf('function applyMonsterAttack(monster,'), source.indexOf('async function runMonsterTurn('));
  for (const rest of [false, true]) for (const ranged of [false, true]) for (const hit of [false, true]) {
    const sleeper = hero('sleeper', ranged ? 3 : 1, 20, rest ? {} : { conditions: { sleeping: {} } });
    const game = runtime([sleeper, hero('dying', 2, 0)], {
      monster: { attack: ranged ? '2 bow (near) +4 (1d8)' : '2 claws +4 (1d8)' },
      state: rest ? { rest: { phase: 'sleeping', participantIds: ['sleeper'], watchOrderIds: ['absent-watcher'], hours: 0 } } : {},
      context: { isSleeping }
    });
    const { state, context } = game, modes = [], positions = [];
    Object.assign(context, {
      isGaseousForm: () => false, isStealthed: () => false, isInvisible: () => false,
      canCharacterSeeMonster: () => true, protectionDisadvantage: () => false,
      transformationAttackDisadvantage: () => false, conditionAttackMode,
      rollCheck: (_bonus, mode) => { modes.push(mode); positions.push(`${state.entities[0].x},${state.entities[0].y}`); return { roll: hit ? 19 : 2, total: hit ? 23 : 2 }; },
      revealAfterOffense() {}, detectThoughtsModifiers: () => ({ armorClass: 0 }),
      luckActorRef: actor => ({ collection: state.characters.includes(actor) ? 'characters' : 'entities', id: actor.id }),
      beginLuckEvent: (world, options) => beginLuckEvent(world, structuredClone(options)), finishLuckEvent,
      captureLuckActor: (event, actor) => captureRuntimeLuckActor(state, event, actor),
      attackRollSegments: () => [{ text: hit ? 'Hit.' : 'Miss.' }],
      interceptMirrorImageHit: () => null, rollDamageExpression: () => ({ total: 4, multiplier: 1 }),
      attackDamageMultiplier: () => 1, elementalDamage: (_actor, total) => ({ total }),
      setCharacterHp: (actor, hp) => { actor.hp = Math.max(0, hp); wakeCreature(actor, state); },
      clearMagicLightIfIncapacitated() {}, syncCharacterDyingRaw() {}, applyDamageResultToPanel() {}
    });
    vm.runInContext(attackSource, context);
    await game.run();
    assert.equal(modes.length, 2);
    assert.ok(modes.every(mode => mode.doubleRoll === !ranged && mode.disadvantage === ranged));
    assert.equal(new Set(positions).size, 1, 'sleeping survivors must not cause repositioning between strikes');
    if (!ranged) assert.equal(game.moves.length, 0);
    assert.equal(state.characters[0].hp, hit ? 12 : 20);
    assert.equal(state.characters[1].hp, 0);
  }
});

test('retargeting never refreshes the whole-turn budget, including standing and water costs', async () => {
  for (const extra of [{ monster: { movement: '3' } }, { monster: { movement: 'near', conditions: { prone: {} } } },
    { monster: { movement: 'near' }, stepCost: () => 2 }]) {
    const game = runtime([hero('first', 3, 1), hero('second', 9, 20)], extra);
    await game.run();
    const budget = extra.monster.movement === '3' || extra.monster.conditions ? 3 : 6;
    assert.ok(game.moves.length * (extra.stepCost ? 2 : 1) <= budget);
    assert.equal(game.attacks.length, 1);
  }
});

test('and routines execute all counts, or alternatives do not leak into the routine', async () => {
  const game = runtime([hero('hero', 1, 30)], { monster: { attack: '2 claws +4 (1d8) and 1 bite +4 (1d10) or 4 dagger +4 (1d4)' } });
  await game.run();
  assert.deepEqual(game.attacks.map(attack => attack.name), ['claws', 'claws', 'bite']);
});

test('INT 1/2 choose low HP reachable this turn with strongest attack; INT 3 prioritizes reachable wizard and feasible damage', async () => {
  for (const I of [1, 2, 3]) {
    const game = runtime([hero('weak', 2, 3), hero('wizard', 7, 20, { className: 'Wizard' }), hero('unreachable', 14, 1)],
      { monster: { I, movement: '1', attack: '1 claws +4 (1d10) or 1 bow (near) +4 (1d4)' } });
    await game.run();
    assert.equal(game.attacks[0].targetId, I > 2 ? 'wizard' : 'weak');
    assert.equal(game.attacks[0].name, I > 2 ? 'bow' : 'claws');
    assert.ok(game.moves.length <= 1);
  }
});

test('INT below -1 pursues nearest with random ties, while -1/0 retain stored ranged preference', async () => {
  for (const I of [-2, -1, 0]) {
    const game = runtime([hero('nearest', 1, 20), hero('stored', 5, 1)],
      { monster: { I, combatTargetId: 'stored', attack: '1 claws +4 (1d4) or 1 bow (near) +4 (1d10)' } });
    assert.equal(game.context.pickMonsterTarget(game.state.entities[0]).id, I < -1 ? 'nearest' : 'stored');
    if (I < -1) { await game.run(); assert.equal(game.moves.length, 0); }
  }
});

test('INT above 2 uses only leftover movement for darkness, party LoS cover, or progress towards future cover', async () => {
  for (const kind of ['dark', 'los', 'future']) {
    const game = runtime([hero('hero', 2, 30)], { monster: { I: 3, movement: '3' }, rebind: true,
      illuminated: point => kind !== 'dark' || point.x < 3,
      sight: (observer, target) => observer.id !== 'hero' || target.x < (kind === 'future' ? 9 : 3) });
    await game.run();
    assert.equal(game.attacks.length, 2);
    assert.equal(game.attacks[0].moves, game.attacks[1].moves);
    assert.ok(game.moves.length <= 3);
    assert.equal(game.moves.length, 3);
    assert.ok(game.state.entities[0].x >= 3);
  }
});

test('no targets, no path, zero HP party and incapacitated monsters finish without attacks or hangs', async () => {
  for (const game of [runtime([]), runtime([hero('down', 2, 0)]), runtime([hero('hero', 5)], { canStep: () => false }),
    runtime([hero('hero', 1)], { monster: { conditions: { paralyzed: {} } } }),
    runtime([hero('hero', 1)], { monster: { conditions: { sleeping: {} } } }),
    runtime([hero('hero', 1)], { monster: { web: true } })]) {
    await game.run(); assert.equal(game.attacks.length, 0); assert.equal(game.moves.length, 0);
  }
});

test('blinded counted attacks use remembered squares without movement and empty squares still roll misses', async () => {
  for (const occupied of [true, false]) {
    let rolls = 0, selections = 0;
    const game = runtime(occupied ? [hero('hero', 1, 20)] : [],
      { monster: { conditions: { blind: {} }, blindTargetMemory: [{ x: 1, y: 1 }] },
        random: () => { selections++; return .5; },
        context: { rollCheck: (_bonus, mode) => { assert.equal(mode.disadvantage, true); rolls++; return { total: 2 }; } } });
    await game.run();
    assert.equal(occupied ? game.attacks.length : rolls, 2);
    assert.equal(game.moves.length, 0);
    assert.equal(selections, 0, 'singleton memory/occupancy must not consume the attack dice draws');
  }
});

test('turned undead and morale flight stay ranged-only when cornered, without cover or movement refresh', async () => {
  for (const flight of ['turnedUndead', 'moraleFlight']) {
    const game = runtime([hero('caster', 1, 20)], {
      monster: { I: 3, [flight]: { rounds: 2, casterId: 'caster' }, attack: '2 claws +4 (1d4) and 2 bow (near) +4 (1d8)' },
      context: { chooseUndeadFleeStep: () => null } });
    await game.run();
    assert.deepEqual(game.attacks.map(attack => attack.name), ['bow', 'bow']);
    assert.equal(game.moves.length, 0);
  }
});

test('canal sentries and disguise attacks keep their special targeting and movement behavior', async () => {
  const sentry = runtime([hero('hero', 1, 20)], { monster: { I: 3, canalSentry: true, attack: '2 claws +4 (1d4) and 2 bow (near) +4 (1d8)' } });
  await sentry.run(); assert.equal(sentry.attacks.length, 2); assert.equal(sentry.moves.length, 0);
  const disguised = runtime([hero('emulated', 1, 20), hero('wizard', 1, 1, { y: 2, className: 'Wizard' })],
    { monster: { I: 3, doppelganger: true, emulatedId: 'emulated', impersonationStarted: true, attack: '2 dagger +4 (1d4)' } });
  await disguised.run(); assert.deepEqual(disguised.attacks.map(attack => attack.targetId), ['emulated', 'emulated']);
});

test('underpass crossing coordinates never make another route an adjacent or attack-eligible target', async () => {
  const underpasses = [makeUnderpass('below', Array.from({ length: 8 }, (_, x) => ({ x: x + 2, y: 1 })),
    { x: 4, y: 1 }, [{ x: 1, y: 1 }, { x: 10, y: 1 }])];
  const game = runtime([hero('upper', 4, 20, { routeId: '' })],
    { monster: { x: 4, I: 2, routeId: 'below', movement: '1' }, state: { underpasses } });
  await game.run(); assert.equal(game.attacks.length, 0);
  assert.ok(game.moves.length <= 1); assert.equal(game.state.entities[0].routeId, 'below');
});

test('a concealed party observer still prevents false line-of-sight cover', async () => {
  const game = runtime([hero('hero', 1, 30), hero('hidden-observer', 12, 30, { stealthed: true })], {
    monster: { I: 3, movement: '3' }, illuminated: () => true,
    sight: (observer, target) => observer.id === 'hidden-observer' || observer.id !== 'hero' || target.x < 2
  });
  await game.run(); assert.equal(game.attacks.length, 2); assert.equal(game.moves.length, 0);
});

test('actual two-claw hit and miss turns preserve Luck actor identity and advance initiative after animated replacement', async () => {
  const attackSource = source.slice(source.indexOf('function applyMonsterAttack(monster,'), source.indexOf('async function runMonsterTurn('));
  const autoSource = source.slice(source.indexOf('async function runAutoMonsterTurns('), source.indexOf('function handleCombatMovement('));
  for (const hit of [true, false]) {
    let rolls = 0, logged = 0, advanced = false;
    const game = runtime([hero('first', 3, hit ? 1 : 20), hero('second', 6, 20)], { rebind: true });
    const { state, context } = game;
    Object.assign(state.combat, { active: true, turnIndex: 0,
      turnOrder: [{ id: 'foe', type: 'monster' }, { id: 'first', type: 'character' }] });
    Object.assign(context, {
      isGaseousForm: () => false, isStealthed: () => false, isInvisible: () => false,
      canCharacterSeeMonster: () => true, protectionDisadvantage: () => false,
      transformationAttackDisadvantage: () => false, conditionAttackMode: () => ({}),
      rollCheck: () => { rolls++; return { roll: hit ? 19 : 2, total: hit ? 23 : 6 }; },
      revealAfterOffense() {}, detectThoughtsModifiers: () => ({ armorClass: 2 }),
      luckActorRef: actor => ({ collection: state.characters.includes(actor) ? 'characters' : 'entities', id: actor.id }),
      beginLuckEvent: (world, options) => beginLuckEvent(world, structuredClone(options)), finishLuckEvent,
      captureLuckActor: (event, actor) => captureRuntimeLuckActor(state, event, actor),
      attackRollSegments: options => { assert.equal(options.targetAC, 12); return [{ text: 'Attack resolved.' }]; },
      pushDiceHistory: () => { logged++; },
      interceptMirrorImageHit: () => null, rollDamageExpression: () => ({ total: 4, multiplier: 1 }),
      attackDamageMultiplier: () => 1, elementalDamage: (_actor, total) => ({ total }),
      setCharacterHp: (actor, hp) => { assert.ok(state.characters.includes(actor)); actor.hp = Math.max(0, hp); },
      clearMagicLightIfIncapacitated() {}, syncCharacterDyingRaw() {}, applyDamageResultToPanel() {},
      SERVER_RUNTIME: false, isSharedRoom: () => false, ensureCombatState: () => state.combat,
      isCombatActive: () => state.combat.active, getCurrentCombatEntry: () => state.combat.turnOrder[state.combat.turnIndex],
      announceCurrentTurn: async () => {}, pushCombatLog() {}, checkCombatEnd: () => false,
      detectAdditionalCombatMonsters() {}, startCurrentCombatTurn: () => { advanced = true; }, setStatus() {}
    });
    vm.runInContext(attackSource + autoSource, context);
    await context.runAutoMonsterTurns();
    assert.equal(rolls, 2); assert.equal(logged, 2);
    assert.equal(state.characters[0].hp, hit ? 0 : 20);
    assert.equal(state.characters[1].hp, hit ? 16 : 20);
    assert.equal(state.combat.turnIndex, 1); assert.equal(state.combat.autoRunning, false); assert.equal(advanced, true);
    assert.equal(state.luckJournal.events.length, hit ? 2 : 0);
    if (hit) assert.ok(state.luckJournal.events.every(event => event.target.collection === 'characters'));
  }
});
