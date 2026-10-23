import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)), { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene(background) {
  return { seed: 1, level: 1, map: { width: 5, height: 5 }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: 25 }, (_, index) => ({ x: index % 5, y: Math.floor(index / 5), type: 'floor', roomId: 'room' })),
    rooms: [{ id: 'room', x: 0, y: 0, width: 5, height: 5 }], entities: [], visibility: {},
    player: { x: 2, y: 2, roomId: 'room' }, combat: { active: false }, activeCharacterId: 'hero',
    characters: [{ id: 'hero', lineageId: 'original-hero', name: 'Dor', background, ancestry: 'Half-Orc', className: 'Priest',
      level: 1, hp: 5, maxHitPoints: 5, stats: { STR: 10, WIS: 12 }, x: 2, y: 2, roomId: 'room',
      gear: [{ name: 'war hammer', type: 'weapon', equipped: true }], equipmentInitialized: true, spellsKnown: 'Cure Wounds, Light' }] };
}

for (const background of ['Noble', 'Orphaned', 'Minstrel']) test(`${background} background is initialized authoritatively and survives repeated commands`, async () => {
  let result = await executeGameCommand(scene(background), { type: 'normalize' });
  const original = structuredClone(result.state_json.characters[0]);
  for (let index = 0; index < 3; index++) result = await executeGameCommand(result.state_json, { type: 'normalize' });
  const character = result.state_json.characters[0];
  assert.equal(character.name, original.name);
  assert.deepEqual(character.backgroundDetails, original.backgroundDetails);
  assert.equal(character.hp, 5); assert.equal(character.stats.STR, 10);
  assert.match(character.attacks[1], /^Warhammer: \+1, 1d10\+1$/);
  assert.equal(character.spellsKnown, 'Cure Wounds, Light');
  if (background === 'Noble') {
    assert.ok(character.backgroundDetails.nobility.culture);
    assert.notEqual(character.name, 'Dor');
    assert.equal(character.raw.name, character.name);
    const edited = await executeGameCommand(result.state_json, { type: 'edit_character', character_id: 'hero', character_json: { name: 'Erd' } });
    assert.match(edited.state_json.characters[0].name, /\bErd\b/);
    assert.equal(edited.state_json.characters[0].backgroundDetails.nobility.text, character.backgroundDetails.nobility.text);
  } else if (background === 'Orphaned') {
    assert.ok(character.backgroundDetails.guardian.name);
    assert.ok(character.backgroundDetails.guardian.intelligence >= 0);
  } else assert.equal(character.background, 'Entertainer');
});
