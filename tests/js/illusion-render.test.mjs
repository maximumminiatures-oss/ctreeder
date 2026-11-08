import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { drawIllusionArtwork, preloadRendererAssets, renderDungeon, visibleDungeonEntities } from '../../S3_content/src/render.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';
import { pitIsOpen } from '../../S3_content/src/pits.js';

const size = 54;
const images = { creature: { src: 'illusion1' }, floor: { src: 'illusion2' }, pit: { src: 'illusion3' } };
const loadedPaths = [];

async function withFakeAssets(run, failedPath = null) {
  const originalImage = globalThis.Image, originalFetch = globalThis.fetch;
  globalThis.Image = class {
    width = 162; height = 162;
    set src(value) {
      this.path = value; loadedPaths.push(value);
      queueMicrotask(() => value === failedPath ? this.onerror?.() : this.onload?.());
    }
    get src() { return this.path; }
  };
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try { return await run(); }
  finally { globalThis.Image = originalImage; globalThis.fetch = originalFetch; }
}

before(async () => withFakeAssets(() => preloadRendererAssets()));

function scene() {
  const state = createEmptyDungeonState(41);
  state.map = { width: 12, height: 12 };
  state.tiles = Array.from({ length: 144 }, (_, i) => ({ x: i % 12, y: Math.floor(i / 12), type: 'floor', meta: {} }));
  const caster = { id: 'caster', name: 'Wizard', hp: 20, x: 5, y: 5, routeId: '', colorValue: '#22aacc',
    lightRadius: 20, lightSource: 'light-spell', gear: [] };
  state.characters = [caster]; state.activeCharacterId = caster.id;
  state.player = { x: 5, y: 5, routeId: '', torchLit: true, lightRadius: 20, lightSource: 'light-spell' };
  recomputeVisibility(state);
  return state;
}

const area = (kind = 'floor', extra = {}) => ({ id: `${kind}-illusion`, type: 'feature', subtype: 'illusion',
  x: 3, y: 3, width: 3, height: 3, routeId: '',
  illusion: { id: `${kind}-effect`, casterId: 'caster', kind }, ...extra });
const creature = (form = 'horrible behemoth', extra = {}) => ({ id: `illusion-${form}`, name: form, hp: 1,
  x: 4, y: 4, routeId: '', colorValue: '#22aacc', gear: [],
  illusion: { id: `${form}-effect`, casterId: 'caster', kind: 'creature', form, footprint: form === 'horrible behemoth' ? 3 : 1 }, ...extra });

function context(layer = 'objects', events = []) {
  const stack = [];
  const target = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '',
    lineWidth: 1, path: [], clips: [], canvas: { width: 648, height: 648 },
    save() { stack.push({ globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation,
      fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, clips: structuredClone(this.clips) }); },
    restore() { Object.assign(this, stack.pop()); },
    beginPath() { this.path = []; }, rect(...args) { this.path.push(args); }, arc(...args) { this.path.push(args); },
    clip() { this.clips.push(structuredClone(this.path)); },
    drawImage(image, ...args) { record('image', this, { image, args }); },
    fillRect(...args) { record('rect', this, { args }); },
    clearRect(...args) { record('clear', this, { args }); },
    fill() { record('fill', this); }, stroke() { record('stroke', this); } };
  function record(method, ctx, extra = {}) {
    events.push({ layer, method, alpha: ctx.globalAlpha, color: ctx.fillStyle,
      path: structuredClone(ctx.path), clips: structuredClone(ctx.clips), ...extra });
  }
  const ctx = new Proxy(target, { get: (object, property) => property in object ? object[property] : () => {} });
  return { ctx, events, stack };
}

test('Illusion assets use the optional normal preload groups and a missing image does not block the renderer', async () => {
  for (const name of ['illusion1', 'illusion2', 'illusion3']) assert.ok(loadedPaths.includes(`./assets/${name}.png`));
  const isolated = await import('../../S3_content/src/render.js?illusion-optional-missing');
  await withFakeAssets(() => isolated.preloadRendererAssets(), './assets/illusion3.png');
  const state = scene(); state.entities = [area('pit')];
  const { ctx, events } = context();
  assert.doesNotThrow(() => isolated.drawIllusionArtwork(state, ctx));
  assert.equal(events.filter(event => event.method === 'image').length, 0);
  state.entities = [area('floor')];
  isolated.drawIllusionArtwork(state, ctx);
  assert.equal(events.find(event => event.method === 'image').image.src, './assets/illusion2.png');
});

test('behemoth art covers a centered 3x3 footprint and tracks visual motion without changing metadata', () => {
  const state = scene(), summon = creature(); state.characters.push(summon);
  const { ctx, events, stack } = context(), before = structuredClone(state);
  drawIllusionArtwork(state, ctx, { images });
  assert.deepEqual(events[0].args, [3 * size, 3 * size, 3 * size, 3 * size]);
  assert.equal(events[0].image, images.creature); assert.equal(events[0].clips[0].length, 9);
  assert.deepEqual(state, before); assert.equal(stack.length, 0); assert.equal(ctx.globalAlpha, 1);
  events.length = 0; summon.visualX = 4.25; summon.visualY = 4.5;
  drawIllusionArtwork(state, ctx, { images });
  assert.deepEqual(events[0].args, [3.25 * size, 3.5 * size, 3 * size, 3 * size]);
});

test('floor and pit art use top-left 3x3 bounds and never become real pits or alter underlying water/features', () => {
  const state = scene();
  state.entities = [area('floor'), area('pit', { x: 7, y: 6 })];
  state.tiles[3 * 12 + 3].meta.slowWater = true;
  const { ctx, events } = context(), before = structuredClone(state);
  drawIllusionArtwork(state, ctx, { images });
  assert.deepEqual(events.map(event => event.image), [images.floor, images.pit]);
  assert.deepEqual(events.map(event => event.args), [[3 * size, 3 * size, 162, 162], [7 * size, 6 * size, 162, 162]]);
  assert.ok(state.entities.every(entity => !pitIsOpen(entity)));
  assert.deepEqual(state, before);
  assert.equal(visibleDungeonEntities(state).some(entity => entity.subtype === 'illusion'), false);
});

test('partial visibility clips each footprint cell and does not require the top-left anchor to be visible', () => {
  const state = scene(); state.entities = [area()];
  state.visibility.visibleNow = new Set(['4,4', '5,4', '5,5']);
  state.visibility.exploredEver = new Set(['4,4', '5,4']);
  state.visibility.routeExplored = { '': new Set(['4,4', '5,4']) };
  state.visibility.routeDarkvision = {};
  const { ctx, events } = context();
  drawIllusionArtwork(state, ctx, { images });
  assert.deepEqual(events[0].clips, [[[4 * size, 4 * size, size, size], [5 * size, 4 * size, size, size]]]);
  state.visibility.visibleNow.clear(); events.length = 0;
  drawIllusionArtwork(state, ctx, { images }); assert.equal(events.length, 0);
});

test('walls, unexplored, hidden and collected artwork stay hidden; blackout requires current light or darkvision', () => {
  const state = scene(); state.entities = [area()];
  state.tiles[3 * 12 + 3].type = 'wall';
  const { ctx, events } = context(); drawIllusionArtwork(state, ctx, { images });
  assert.ok(!events[0].clips[0].some(rect => rect[0] === 3 * size && rect[1] === 3 * size));
  for (const flag of ['hidden', 'collected']) {
    state.entities[0][flag] = true; events.length = 0;
    drawIllusionArtwork(state, ctx, { images }); assert.equal(events.length, 0); delete state.entities[0][flag];
  }
  state.characters[0].lightRadius = 0; state.player.torchLit = false; state.player.lightRadius = 0;
  events.length = 0; drawIllusionArtwork(state, ctx, { images, darkness: true });
  assert.equal(events.length, 0);
  state.characters[0].ancestry = 'Dwarf';
  recomputeVisibility(state); events.length = 0;
  drawIllusionArtwork(state, ctx, { images, darkness: true });
  // Ordinary humans/dwarves do not gain monster darkvision from an illusion.
  assert.equal(events.length, 0);
  state.characters[0].transformationEffects = [{ spell: 'alter self', rounds: 5, features: ['cat-eyes'] }];
  recomputeVisibility(state); events.length = 0;
  drawIllusionArtwork(state, ctx, { images, darkness: true });
  assert.ok(events.some(event => event.method === 'image'));
});

test('route-specific cells prevent lower art leaking onto an upper crossing and lower terrain disguises stay opaque', () => {
  const state = scene(), cells = Array.from({ length: 9 }, (_, i) => ({ x: 3 + i % 3, y: 3 + Math.floor(i / 3) }));
  state.underpasses = [{ id: 'lower', lowerCells: cells, upperCrossings: cells, portals: [] }];
  state.entities = [area('floor', { routeId: 'lower' })];
  state.visibility.routeExplored = { '': new Set(['4,4']), lower: new Set(['4,4']) };
  state.visibility.routeVisible = { '': new Set(['4,4']), lower: new Set() };
  state.visibility.routeDarkvision = {};
  const { ctx, events } = context(); drawIllusionArtwork(state, ctx, { images }); assert.equal(events.length, 0);
  state.characters[0].routeId = 'lower'; state.player.routeId = 'lower';
  state.visibility.routeVisible = { '': new Set(), lower: new Set(['4,4']) };
  drawIllusionArtwork(state, ctx, { images });
  assert.deepEqual(events[0].clips[0], [[4 * size, 4 * size, size, size]]); assert.equal(events[0].alpha, 1);
  events.length = 0; state.entities = []; state.characters.push(creature('horrible behemoth', { routeId: 'lower' }));
  drawIllusionArtwork(state, ctx, { images }); assert.equal(events[0].alpha, .5);
});

test('board artwork is above real pits and features, below monsters, party markers and fog in motion frames', () => {
  const state = scene();
  state.entities = [{ id: 'monster', type: 'monster', name: 'Bandit', hp: 10, x: 4, y: 4, visible: true },
    { id: 'chest', type: 'treasure', x: 4, y: 4 },
    { id: 'pit', type: 'feature', subtype: 'pit', x: 3, y: 3, width: 3, height: 3, open: true }, area()];
  const events = [], objects = context('objects', events), fog = context('fog', events);
  renderDungeon(state, { objectsCtx: objects.ctx, fogCtx: fog.ctx }, { motionOnly: true });
  const art = events.findIndex(event => event.method === 'image' && event.image.src === './assets/illusion2.png');
  const treasure = events.findIndex(event => event.method === 'fill' && event.color === '#e0bc2f');
  const monster = events.findIndex(event => event.method === 'fill' && event.color === '#df9696');
  const fogStart = events.findIndex(event => event.layer === 'fog');
  const marker = events.findIndex(event => event.layer === 'fog' && event.method === 'fill' && event.color === '#22aacc');
  const pit = events.findIndex(event => event.method === 'image' && /\/pit-/.test(event.image.src));
  assert.ok(pit >= 0 && pit < art);
  assert.ok(art >= 0 && treasure < art && art < monster && monster < fogStart && fogStart < marker);
  assert.equal(objects.stack.length, 0); assert.equal(fog.stack.length, 0);
});

test('forced blackout hides illusion markers without changing ordinary party token behavior', () => {
  const state = scene(); state.characters.push(creature('skeleton'));
  state.characters[0].lightRadius = 0; state.player.torchLit = false; state.player.lightRadius = 0;
  const { ctx, events } = context('fog');
  renderDungeon(state, { fogCtx: ctx }, { motionOnly: true, forceBlackout: true });
  assert.equal(events.filter(event => event.method === 'fill' && event.color === '#22aacc').length, 1);
});

test('small creature forms remain ordinary caster-colored 1x1 tokens and hidden illusion tokens do not leak through fog', () => {
  for (const form of ['skeleton', 'marilith', 'vampire', 'tyrannosaurus']) {
    const state = scene(), summon = creature(form); state.characters.push(summon);
    const events = [], objects = context('objects', events), fog = context('fog', events);
    renderDungeon(state, { objectsCtx: objects.ctx, fogCtx: fog.ctx }, { motionOnly: true });
    assert.equal(events.some(event => event.method === 'image' && /illusion[123]/.test(event.image.src)), false);
    const tokens = events.filter(event => event.layer === 'fog' && event.method === 'fill' && event.color === '#22aacc');
    assert.equal(tokens.length, 2); assert.equal(tokens[1].path[0][2], size * .27);
    state.visibility.visibleNow.clear(); state.visibility.routeDarkvision = {}; events.length = 0;
    renderDungeon(state, { objectsCtx: objects.ctx, fogCtx: fog.ctx }, { motionOnly: true });
    assert.equal(events.filter(event => event.layer === 'fog' && event.method === 'fill' && event.color === '#22aacc').length, 1);
  }
});

test('motion-only object cache invalidates for behemoth movement, partial visibility, and effect removal', () => {
  const state = scene(), summon = creature(); state.characters.push(summon);
  const events = [], objects = context('objects', events), fog = context('fog', events), layers = { objectsCtx: objects.ctx, fogCtx: fog.ctx };
  const frame = () => renderDungeon(state, layers, { motionOnly: true });
  const clears = () => events.filter(event => event.layer === 'objects' && event.method === 'clear').length;
  frame(); const first = clears(); frame(); assert.equal(clears(), first);
  summon.visualX = 4.2; frame(); assert.equal(clears(), first + 1);
  state.visibility.visibleNow.delete('3,3'); frame(); assert.equal(clears(), first + 2);
  delete summon.illusion; frame(); assert.equal(clears(), first + 3);
  const lastClear = events.findLastIndex(event => event.layer === 'objects' && event.method === 'clear');
  assert.equal(events.slice(lastClear).some(event => event.method === 'image' && /illusion1/.test(event.image.src)), false);
});
