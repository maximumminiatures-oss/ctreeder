import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)),
  { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene() {
  const width = 16, height = 12;
  return {
    seed: 456, level: 3, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }], entities: [],
    visibility: { exploredEver: ['2,6'] },
    characters: [{ id: 'wizard', name: 'Badzog', className: 'Wizard', ancestry: 'Half-Orc', level: 5,
      stats: { STR: 10, DEX: 10, CON: 10, INT: 18, WIS: 18, CHA: 10 }, hp: 80, maxHitPoints: 80,
      x: 2, y: 6, roomId: 'room', spellsKnown: 'Protection From Energy, Fireball, Sending', gear: [], luckToken: true }],
    activeCharacterId: 'wizard', player: { x: 2, y: 6, roomId: 'room', torchLit: false },
    wanderingMonsters: { numerator: 0, denominator: 6 }, combat: { active: false }
  };
}
async function command(state, values, random = .5) {
  const previous = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state, { character_id: 'wizard', ...values }); }
  finally { Math.random = previous; }
}

test('Protection From Energy resolves through authoritative commands and prevents typed blast damage', async () => {
  let result = await command(scene(), { type: 'spell', spell_name: 'Protection From Energy' });
  result = await command(result.state_json, { type: 'resolve_spell', option: 'fire' });
  result = await command(result.state_json, { type: 'resolve_spell', target_id: 'wizard' });
  const focusId = result.state_json.characters[0].focusSpell.id;
  assert.equal(result.state_json.characters[0].spellEffects[0].focusId, focusId);
  result = await command(result.state_json, { type: 'spell', spell_name: 'Fireball' });
  result = await command(result.state_json, { type: 'resolve_spell', x: 3, y: 6, confirmed: true });
  assert.equal(result.state_json.characters[0].hp, 80);
  assert.equal(result.state_json.characters[0].focusSpell.id, focusId);
});

test('unfinished spells cannot run through the generic successful-cast fallback', async () => {
  await assert.rejects(() => command(scene(), { type: 'spell', spell_name: 'Sending' }), /unfinished/);
});

test('Luck restores both Focus and target immunity after a failed energy maintenance check', async () => {
  let result = await command(scene(), { type: 'spell', spell_name: 'Protection From Energy' });
  result = await command(result.state_json, { type: 'resolve_spell', option: 'fire' });
  result = await command(result.state_json, { type: 'resolve_spell', target_id: 'wizard' });
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 }, .1);
  assert.equal(result.state_json.characters[0].focusSpell, null);
  assert.equal(result.state_json.characters[0].spellEffects.length, 0);
  result = await command(result.state_json, { type: 'luck' }, .8);
  assert.equal(result.state_json.characters[0].focusSpell.spell, 'protection from energy');
  assert.deepEqual(result.state_json.characters[0].spellEffects[0].energyTypes, ['fire']);
});
