import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { enchantedEquipment, magicPotion, magicScroll } from '../../S3_content/src/magic-items.js';
import { listMagicEffects } from '../../S3_content/src/magic-effect-registry.js';
import { createFloatingDiscs } from '../../S3_content/src/floating-disc.js';

const root = new URL('../../S3_content/', import.meta.url);
const dom = new JSDOM(await readFile(new URL('index.html', root), 'utf8'), { url: 'http://localhost/site/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.Image = dom.window.Image;
globalThis.__SD_SERVER_RUNTIME__ = true;
globalThis.fetch = async input => new Response(await readFile(new URL(String(input).replace(/^\.\//, ''), root)), { headers: { 'Content-Type': 'application/json' } });
const { executeGameCommand } = await import('../../S3_content/src/main.js');
test.after(() => dom.window.close());

function scene() {
  const width = 20, height = 15;
  return { seed: 3, level: 3, map: { width, height }, generation: { entranceRoomId: 'room' },
    tiles: Array.from({ length: width * height }, (_, i) => ({ x: i % width, y: Math.floor(i / width), type: 'floor', roomId: 'room', meta: {} })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }], entities: [],
    characters: [{ id: 'wizard', name: 'Badzog', className: 'Wizard', ancestry: 'Half-Orc', level: 5,
      x: 4, y: 6, roomId: 'room', hp: 50, maxHitPoints: 50, stats: { INT: 18, STR: 10, DEX: 10, CON: 10, WIS: 10, CHA: 10 },
      spellsKnown: 'Dispel Magic, Detect Magic', lightSpellLit: true, lightRadius: 6, lightSource: 'light-spell', gear: [] },
      { id: 'fighter', name: 'Ad', className: 'Fighter', ancestry: 'Human', level: 1, x: 4, y: 7, roomId: 'room', hp: 20, maxHitPoints: 20,
        stats: { STR: 10, DEX: 10, CON: 10 }, gear: [], equipmentInitialized: true }],
    activeCharacterId: 'wizard', player: { x: 4, y: 6, roomId: 'room', torchLit: true },
    timers: { lightEverLit: true, torchElapsedMs: 0, torchDurationMs: 3600000 },
    visibility: { exploredEver: ['4,6', '4,7'] }, combat: { active: false }, wanderingMonsters: { numerator: 0, denominator: 6 } };
}
async function command(state, value, random = .5) {
  const previous = Math.random; Math.random = () => random;
  try { return await executeGameCommand(state, { character_id: 'wizard', ...value }); }
  finally { Math.random = previous; }
}
async function dispel(state, targetId, predicate) {
  let result = await command(state, { type: 'spell', spell_name: 'Dispel Magic' });
  result = await command(result.state_json, { type: 'resolve_spell', target_id: targetId });
  const effect = listMagicEffects(result.state_json).find(effect => effect.targetId === targetId && predicate(effect));
  assert.ok(effect, 'test target must expose the selected magical effect');
  return command(result.state_json, { type: 'resolve_spell', option: effect.id });
}

test('authoritative item suppression removes only intrinsic weapon magic and restores it exactly after ten rounds', async () => {
  const state = scene(), sword = enchantedEquipment({ name: 'Longsword', costGp: 9, slots: 1 }, 'weapon', 1);
  sword.magic.identified = true; sword.name = '+1 Longsword'; sword.equipped = true;
  state.characters[1].gear.push(sword);
  let result = await dispel(state, 'fighter', effect => effect.kind === 'suppression');
  let fighter = result.state_json.characters[1];
  assert.match(fighter.gear[0].name, /^non-magical Longsword$/);
  assert.match(fighter.attacks[0], /\+0, 1d8$/);
  assert.equal(fighter.gear[0].magic.bonus, 1);
  for (let round = 0; round < 9; round++) result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  assert.equal(result.state_json.characters[1].gear[0].magicSuppression.rounds, 1);
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 10000 });
  fighter = result.state_json.characters[1];
  assert.equal(fighter.gear[0].name, '+1 Longsword');
  assert.match(fighter.attacks[0], /\+1, 1d8\+1$/);
});

test('authoritative suppressed potions can be wasted with no benefit and do not reappear at expiry', async () => {
  const state = scene(); state.characters[0].hp = 1; state.characters[0].gear.push(magicPotion('healing-1'));
  let result = await dispel(state, 'wizard', effect => effect.kind === 'suppression');
  assert.equal(result.state_json.characters[0].gear[0].name, 'Potion of No Effect');
  result = await command(result.state_json, { type: 'drink_potion', gear_index: 0 });
  assert.match(result.message, /Nothing happens\./); assert.equal(result.state_json.characters[0].hp, 1);
  result = await command(result.state_json, { type: 'tick', elapsed_ms: 100000 });
  assert.equal(result.state_json.characters[0].gear[0].name, 'Empty flask');
});

test('authoritative suppressed wands cannot cast, while scroll items remain immune', async () => {
  const state = scene();
  state.characters[0].gear.push({ name: 'Wand of Mage Armor', type: 'wand', slots: 1, magic: { kind: 'wand', spellName: 'Mage Armor', tier: 1, classes: ['wizard'], identified: true } },
    magicScroll({ name: 'Mage Armor', tier: 1, classes: ['wizard'] }));
  let result = await dispel(state, 'wizard', effect => effect.kind === 'suppression');
  assert.equal(result.state_json.characters[0].gear[0].name, 'non-magical wand');
  await assert.rejects(() => command(result.state_json, { type: 'read_wand', gear_index: 0 }), /non-magical/);
  assert.ok(!listMagicEffects(result.state_json).some(effect => effect.itemName === 'Magic Scroll'));
  result = await command(result.state_json, { type: 'read_scroll', gear_index: 1 });
  assert.ok(result.state_json.characters[0].wizardEffects.some(effect => effect.type === 'mage-armor'));
  result = await dispel(result.state_json, 'wizard', effect => effect.spell === 'mage armor');
  assert.equal(result.state_json.characters[0].wizardEffects.length, 0);
});

test('dispelled Floating Disc drops its cargo exactly once through normal expiration', async () => {
  const state = scene(); const [disc] = createFloatingDiscs(state, state.characters[0]);
  disc.gear.push({ name: 'Pole', slots: 1, quantity: 1, totalUnits: 1 });
  const result = await dispel(state, disc.id, effect => effect.spell === 'floating disc');
  assert.equal(result.state_json.characters.some(member => member.id === disc.id), false);
  assert.equal(result.state_json.entities.filter(entity => entity.gearItem?.name === 'Pole').length, 1);
});

test('Detect Magic reports recorded spell effects on creatures, not just carried magic items', async () => {
  const state = scene(); state.characters[1].wizardEffects = [{ type: 'mage-armor', armorClass: 14, rounds: 10 }];
  const result = await command(state, { type: 'spell', spell_name: 'Detect Magic' });
  const wizard = result.state_json.characters[0];
  assert.ok(wizard.magicDetectedEffects.some(effect => effect.targetId === 'fighter' && effect.name === 'Mage Armor'));
  assert.ok(wizard.magicDetectedIds.includes('fighter'));
});

test('an externally applied Light persists on a fighter who does not know Light until specifically dispelled', async () => {
  const state = scene(); state.characters[0].spellsKnown += ', Light';
  let result = await command(state, { type: 'spell', spell_name: 'Light' });
  result = await command(result.state_json, { type: 'resolve_spell', target_id: 'fighter' });
  assert.equal(result.state_json.characters[1].lightSpellLit, true);
  result = await command(result.state_json, { type: 'normalize' });
  assert.equal(result.state_json.characters[1].lightSpellLit, true);
  result = await dispel(result.state_json, 'fighter', effect => effect.spell === 'light');
  assert.equal(result.state_json.characters[1].lightSpellLit, false);
});
