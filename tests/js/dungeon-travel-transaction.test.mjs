import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const travel = source.slice(source.indexOf('async function travelDungeon('), source.indexOf('async function requestDungeonDescent('));

for (const failure of ['normalize', 'visibility', 'render']) test(`failed ${failure} rolls travel back without replacing party, clocks, history or rules`, async () => {
  const original = { level: 1, seed: 123, characters: [{ id: 'hero', hp: 4 }], timers: { torchElapsedMs: 1234 }, rollHistory: [] };
  const before = structuredClone(original);
  const next = { level: 2, seed: 456, characters: [{ id: 'hero', hp: 4 }], timers: { torchElapsedMs: 1234 }, rollHistory: [] };
  let failed = false;
  const fail = stage => { if (!failed && failure === stage) { failed = true; throw new Error(`${stage} failed`); } };
  const oldTable = [{ name: 'Old' }], oldRules = { old: true };
  const context = vm.createContext({ state: original, shadowdarkContent: oldRules, rulesData: oldRules, monsterTable: oldTable,
    bossMonsterTable: oldTable, trapTable: oldTable, diceHistory: original.rollHistory, viewport: { panX: 10, scale: 2 },
    SERVER_RUNTIME: false, ui: { levelInput: { value: 1 }, seedInput: { value: 123 } },
    loadShadowdarkContent: async () => ({}), loadRulesData: async () => ({}), loadOrganicAssets: async () => [],
    loadInnerWallAssets: async () => [], loadTrapTable: async () => [], loadMonsterTableForLevel: async () => [],
    loadBossMonsterTableForLevel: async () => [], ensureSpellLibraryLoaded: async () => ({ spells: [] }),
    createRandomDungeonSeed: () => 456, buildNextLevelState: () => next, checkFloorArrivalEncounters() {},
    normalizeCharacterState: () => fail('normalize'), ensureCombatState() {}, syncAllCharacterEquipmentDerivedStats() {},
    syncPlayerToActiveCharacter() {}, recomputeVisibility: () => fail('visibility'), markRunDirty() {}, resetFloorUi() {},
    setupCanvasLayers() {}, updatePanels() {}, render: () => fail('render'), setStatus() {}, processMonsterVisibilityChange() {}, commitViewportTransform() {} });
  vm.runInContext(travel, context);
  await assert.rejects(() => context.travelDungeon('down'), new RegExp(`${failure} failed`));
  assert.equal(context.state, original); assert.deepEqual(original, before);
  assert.equal(context.monsterTable, oldTable); assert.equal(context.rulesData, oldRules);
  assert.equal(context.diceHistory, original.rollHistory);
  assert.equal(context.ui.levelInput.value, 1); assert.equal(context.ui.seedInput.value, 123);
});
