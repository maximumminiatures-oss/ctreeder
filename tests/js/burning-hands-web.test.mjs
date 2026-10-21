import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBurningHands } from '../../S3_content/src/burning-hands.js';

function scene() {
  const wizard = { id: 'wizard', name: 'Wizard', hp: 20, maxHitPoints: 20, x: 3, y: 4, stats: { CON: 10 }, gear: [] };
  return { map: { width: 12, height: 9 }, tiles: Array.from({ length: 108 }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12), type: 'floor' })),
    player: { x: 3, y: 4 }, characters: [wizard], entities: [],
    areaSpells: [{ id: 'web', spell: 'web', x: 4, y: 4, width: 6, height: 1, rounds: 5, escapedIds: [] }] };
}
const monster = (id, x, hp = 20) => ({ id, type: 'monster', name: id, x, y: 4, hp });

test('Burning Hands touching an empty Web square burns its entire area and individually damages distant creatures', () => {
  const state = scene();
  state.entities.push(monster('far-one', 8), monster('far-two', 9, 2));
  const rolls = [.5, 0, .99];
  const result = applyBurningHands(state, state.characters[0], { random: () => rolls.shift() ?? .5, now: 100 });
  assert.deepEqual(result.webIgnitions, ['web']);
  assert.deepEqual(result.webHits.map(hit => hit.roll), [1, 6]);
  assert.equal(state.entities[0].hp, 19);
  assert.equal(state.entities[1].hp, 0);
  assert.equal(result.hits.find(hit => hit.id === 'far-two').defeated, true);
  assert.equal(result.hits.find(hit => hit.id === 'far-two').type, 'monster');
  assert.equal(state.areaSpells[0].burnedAt, 100);
  assert.equal(state.areaSpells[0].rounds, 0);
  assert.match(result.message, /Web burns/);
});

test('each Web burns only once, and direct plus Web damage merge into one parent hit', () => {
  const state = scene();
  state.entities.push(monster('near', 4));
  const result = applyBurningHands(state, state.characters[0], { random: () => .5 });
  assert.equal(result.hits.filter(hit => hit.id === 'near').length, 1);
  assert.equal(result.hits[0].damage, 8);
  assert.equal(result.hits[0].webDamage, 4);
  assert.equal(state.entities[0].hp, 12);
  assert.equal(applyBurningHands(state, state.characters[0], { random: () => 0 }).webHits.length, 0);
});

test('a closed door/wall prevents ignition when no Web square is reachable', () => {
  const state = scene();
  state.areaSpells[0].x = 5;
  state.areaSpells[0].width = 4;
  state.tiles[4 * 12 + 4].type = 'wall';
  const result = applyBurningHands(state, state.characters[0], { radius: 2, random: () => .5 });
  assert.equal(result.webIgnitions.length, 0);
  assert.equal(state.areaSpells[0].burnedAt, undefined);
});

test('overlapping Webs ignite independently while upper and lower routes remain separate', () => {
  const state = scene();
  state.areaSpells.push({ ...structuredClone(state.areaSpells[0]), id: 'overlap' },
    { ...structuredClone(state.areaSpells[0]), id: 'lower', routeId: 'under' });
  state.underpasses = [{ id: 'under', lowerCells: [{ x: 4, y: 4 }, { x: 8, y: 4 }], upperCrossings: [{ x: 4, y: 4 }, { x: 8, y: 4 }], portals: [] }];
  state.entities.push(monster('upper', 8), { ...monster('lower-monster', 8), routeId: 'under' });
  const result = applyBurningHands(state, state.characters[0], { random: () => .5 });
  assert.deepEqual(result.webIgnitions, ['web', 'overlap']);
  assert.equal(result.webHits.length, 2);
  assert.equal(state.entities[0].hp, 12);
  assert.equal(state.entities[1].hp, 20);
  assert.equal(state.areaSpells[2].burnedAt, undefined);
});

test('Web fire can burn the caster and allies, unlike the original caster-safe flames; discs remain immune', () => {
  const state = scene();
  state.areaSpells[0].x = 3;
  state.characters.push({ id: 'ally', name: 'Ally', hp: 20, maxHitPoints: 20, x: 7, y: 4, stats: { CON: 10 } },
    { id: 'disc', name: 'Floating Disc', x: 8, y: 4, summon: { kind: 'floating-disc' } });
  const result = applyBurningHands(state, state.characters[0], { random: () => .5 });
  assert.equal(state.characters[0].hp, 16);
  assert.equal(state.characters[1].hp, 16);
  assert.equal(result.webHits.length, 2);
  assert.equal(result.hits.some(hit => hit.id === 'disc'), false);
});
