import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene(distance = 6) {
  const width = 15, height = 15;
  return {
    seed: 123, level: 1, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }],
    visibility: { exploredEver: Array.from({ length: width * height }, (_, i) => `${i % width},${Math.floor(i / width)}`) },
    entities: [{ id: 'stairs', type: 'stairs', subtype: 'up', x: 3, y: 7, roomId: 'room' },
      { id: 'watcher', type: 'monster', name: 'Runtime Watcher', hp: 100, maxHp: 100, ac: 12, x: 3 + distance, y: 7, roomId: 'room',
        attitude: 'neutral', attitudeChecked: true, hostile: false, visible: true, languages: 'Common',
        stealthState: { attempted: true, revealed: true }, attack: '1 claw +0 (1d4)' }],
    characters: [{ id: 'thief', name: 'Shrigark', className: 'Thief', ancestry: 'Goblin', level: 1,
      stats: { STR: 10, DEX: 16, CON: 10, INT: 10, WIS: 10, CHA: 10 }, hp: 50, maxHitPoints: 50, x: 3, y: 7, roomId: 'room',
      gear: [{ name: 'Torch', lit: true, equipped: true }], lightSource: 'torch', lightRadius: 6, equipmentInitialized: true }],
    player: { x: 3, y: 7, roomId: 'room', torchLit: true, lightSource: 'torch', lightRadius: 6 }, activeCharacterId: 'thief',
    combat: { active: false, round: 1, turnIndex: 0, movementRemaining: 6, actionUsed: false,
      turnOrder: [{ type: 'character', id: 'thief' }, { type: 'monster', id: 'watcher' }], playerOrderIds: ['thief'], monsterIds: ['watcher'] }
  };
}
async function command(state, values, random = .8) {
  const original = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state.state_json || state, { character_id: 'thief', ...values }); }
  finally { Math.random = original; }
}
const actor = result => result.state_json.characters[0];

test('authoritative stealth entry is rejected at six-square clear LOS both in and out of combat', async () => {
  for (const inCombat of [false, true]) {
    const state = scene(); state.combat.active = inCombat;
    const result = await command(state, { type: 'stealth' });
    assert.equal(actor(result).stealthed, false);
    assert.match(result.message, /cannot hide.*six squares/i);
    if (inCombat) assert.equal(result.state_json.combat.actionUsed, false);
  }
});

test('authoritative stealth entry respects solid geometry and the circular six-square boundary', async () => {
  const wall = scene(); wall.tiles[7 * 15 + 5].type = 'wall';
  const hidden = await command(wall, { type: 'stealth' });
  assert.equal(actor(hidden).stealthed, true);
  const diagonal = scene(); diagonal.entities.find(entity => entity.id === 'watcher').y = 8;
  const outsideCircle = await command(diagonal, { type: 'stealth' });
  assert.equal(actor(outsideCircle).stealthed, true);
});

test('authoritative movement breaks ordinary stealth at three squares and persists that result after hydration', async () => {
  const state = scene(4); state.characters[0].stealthed = true;
  let result = await command(state, { type: 'normalize' });
  assert.equal(actor(result).stealthed, true);
  result = await command(result, { type: 'move', dx: 1, dy: 0 });
  assert.equal(actor(result).x, 4);
  assert.equal(actor(result).stealthed, false);
  assert.equal(actor(result).raw.stealthed, false);
  result = await command(result, { type: 'normalize' });
  assert.equal(actor(result).stealthed, false);
});

test('authoritative stealth auto-succeeds against deaf-only observers even with a natural-one random source', async () => {
  for (const deafFlag of ['deaf', 'deafened']) {
    const state = scene(3);
    state.entities.find(entity => entity.id === 'watcher').conditions = { [deafFlag]: true };
    const result = await command(state, { type: 'stealth' }, .001);
    assert.equal(actor(result).stealthed, true, deafFlag);
    assert.match(result.message, /stealthed/i);
  }
});

test('authoritative proximity removes ordinary stealth without ending the separate invisibility effect', async () => {
  const state = scene(4);
  Object.assign(state.characters[0], { stealthed: true, invisibility: { rounds: 3, source: 'spell', breakOnOffense: true } });
  const result = await command(state, { type: 'move', dx: 1, dy: 0 });
  assert.equal(actor(result).stealthed, false);
  assert.equal(actor(result).invisibility.rounds, 3);
  assert.equal(actor(result).invisibility.source, 'spell');
});
