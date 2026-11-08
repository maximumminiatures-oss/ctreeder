import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { drawSpellTemplateArtwork, drawAreaSpellOverlays, renderDungeon, preloadRendererAssets } from '../../S3_content/src/render.js';
import { SPELL_TEMPLATE_ART, spellTemplateFits, ongoingSpellTemplates } from '../../S3_content/src/spell-template-art.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';

const loaded = [];
before(async () => {
  const originalImage = globalThis.Image, originalFetch = globalThis.fetch;
  globalThis.Image = class { width = 162; height = 162; set src(value) { this.path = value; loaded.push(value); queueMicrotask(() => this.onload?.()); } get src() { return this.path; } };
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try { await preloadRendererAssets(); } finally { globalThis.Image = originalImage; globalThis.fetch = originalFetch; }
});
function scene() {
  const state = createEmptyDungeonState(4);
  state.map = { width: 20, height: 20 };
  state.tiles = Array.from({ length: 400 }, (_, i) => ({ x: i % 20, y: Math.floor(i / 20), type: 'floor', meta: {} }));
  state.characters = [{ id: 'caster', name: 'Wizard', hp: 20, x: 8, y: 8, lightRadius: 20, gear: [], colorValue: '#11aabb',
    focusSpell: { spell: 'silence', areaId: 'silence' } }];
  state.player = { x: 8, y: 8, lightRadius: 20, torchLit: true }; state.activeCharacterId = 'caster';
  state.areaSpells = [{ id: 'web', spell: 'web', casterId: 'caster', x: 2, y: 2, width: 6, height: 6, routeId: '', rounds: 5 },
    { id: 'silence', spell: 'silence', casterId: 'caster', x: 10, y: 2, width: 6, height: 6, routeId: '' }];
  recomputeVisibility(state);
  return state;
}
function context(layer = 'objects', events = []) {
  const stack = [];
  const target = { globalAlpha: 1, globalCompositeOperation: 'source-over', fillStyle: '', strokeStyle: '', path: [], clips: [], canvas: { width: 1080, height: 1080 },
    save() { stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, clips: structuredClone(this.clips) }); },
    restore() { Object.assign(this, stack.pop()); }, beginPath() { this.path = []; }, rect(...args) { this.path.push(args); }, arc(...args) { this.path.push(args); },
    clip() { this.clips.push(structuredClone(this.path)); },
    drawImage(image, ...args) { events.push({ layer, type: 'image', image, args, alpha: this.globalAlpha, clips: structuredClone(this.clips) }); },
    clearRect() { events.push({ layer, type: 'clear' }); },
    fill() { events.push({ layer, type: 'fill', color: this.fillStyle }); } };
  return { ctx: new Proxy(target, { get: (object, key) => key in object ? object[key] : () => {} }), events, stack };
}

test('all four supplied PNGs are optional renderer assets, preserving the existing Magic Circle filename', () => {
  for (const { path } of Object.values(SPELL_TEMPLATE_ART)) assert.ok(loaded.includes(path));
  assert.equal(SPELL_TEMPLATE_ART['magic circle'].path, './assets/mqgic-circle.png');
});

test('only standard footprints use art; enlarged critical areas retain their geometric fallback', () => {
  assert.ok(spellTemplateFits('web', { width: 6, height: 6 }));
  assert.ok(spellTemplateFits('fireball', { width: 7, height: 7 }));
  assert.equal(spellTemplateFits('web', { width: 12, height: 12 }), false);
  assert.equal(spellTemplateFits('fireball', { width: 13, height: 13 }), false);
  assert.equal(spellTemplateFits('lightning bolt', { width: 1, height: 12 }), false);
});

test('Web and Silence art follows their real rectangles without altering effects or state', () => {
  const state = scene(), before = structuredClone(state), { ctx, events, stack } = context();
  drawSpellTemplateArtwork(state, ctx);
  assert.deepEqual(events.map(event => event.image.src), ['./assets/web.png', './assets/silence.png']);
  assert.deepEqual(events.map(event => event.args), [[108, 108, 324, 324], [540, 108, 324, 324]]);
  assert.deepEqual(state, before); assert.equal(stack.length, 0); assert.equal(ctx.globalAlpha, 1);
});

test('Magic Circle artwork can render a live source-owned area record without granting protection or casting mechanics', () => {
  const state = scene(); state.areaSpells = [];
  state.spellEffects = [{ id: 'circle', spell: 'Magic Circle', kind: 'area', x: 3, y: 4, width: 7, height: 7 }];
  const { ctx, events } = context(); drawSpellTemplateArtwork(state, ctx);
  assert.equal(events[0].image.src, './assets/mqgic-circle.png');
  assert.equal(state.characters[0].focusSpell.spell, 'silence');
  state.spellEffects[0].ended = true; assert.deepEqual(ongoingSpellTemplates(state), []);
});

test('ending Focus or expiring a Web removes its template, while a burning Web fades with the existing timer', () => {
  const state = scene(); state.characters[0].focusSpell = null;
  assert.deepEqual(ongoingSpellTemplates(state).map(effect => effect.spell), ['web']);
  state.areaSpells[0].rounds = 0; assert.equal(ongoingSpellTemplates(state).length, 0);
  Object.assign(state.areaSpells[0], { burnedAt: 1000, burnFadeMs: 1500 });
  assert.equal(ongoingSpellTemplates(state, { now: 1750 })[0].opacity, .5);
  assert.equal(ongoingSpellTemplates(state, { now: 2501 }).length, 0);
});

test('ongoing art clips walls, unknown cells and other currently visible routes', () => {
  const state = scene(); state.areaSpells = [state.areaSpells[0]];
  state.visibility.exploredEver = new Set(['2,2', '3,2', '4,2']); state.visibility.routeExplored = { '': state.visibility.exploredEver };
  state.tiles[2 * 20 + 3].type = 'wall';
  const { ctx, events } = context(); drawSpellTemplateArtwork(state, ctx);
  assert.deepEqual(events[0].clips[0], [[108, 108, 54, 54], [216, 108, 54, 54]]);
  state.visibility.routeVisible = { lower: new Set(['2,2']), '': new Set() }; events.length = 0;
  drawSpellTemplateArtwork(state, ctx);
  assert.deepEqual(events[0].clips[0], [[216, 108, 54, 54]]);
});

test('Fireball art uses its original centered bounds, clips to affected known cells, and never persists after the preview', () => {
  const state = scene(), { ctx, events, stack } = context('fog'); state.areaSpells = [];
  const preview = { spell: 'fireball', rect: { x: 4, y: 4, width: 7, height: 7 }, cells: [{ x: 4, y: 4 }, { x: 5, y: 4 }] };
  drawAreaSpellOverlays(state, ctx, { areaPreview: preview });
  const image = events.find(event => event.type === 'image');
  assert.equal(image.image.src, './assets/fireball.png'); assert.deepEqual(image.args, [216, 216, 378, 378]);
  assert.equal(image.alpha, .4); assert.deepEqual(image.clips[0], [[216, 216, 54, 54], [270, 216, 54, 54]]); assert.equal(stack.length, 0);
  events.length = 0; drawAreaSpellOverlays(state, ctx); assert.equal(events.some(event => event.type === 'image'), false);
  events.length = 0; preview.rect.width = preview.rect.height = 13;
  drawAreaSpellOverlays(state, ctx, { areaPreview: preview }); assert.equal(events.some(event => event.type === 'image'), false);
});

test('ongoing art is under monster tokens and fog; motion frames refresh it when exploration or effect state changes', () => {
  const state = scene(); state.entities = [{ id: 'foe', type: 'monster', name: 'Bandit', hp: 10, x: 4, y: 4, visible: true }];
  const events = [], objects = context('objects', events), fog = context('fog', events), layers = { objectsCtx: objects.ctx, fogCtx: fog.ctx };
  const frame = () => renderDungeon(state, layers, { motionOnly: true });
  frame();
  const art = events.findIndex(event => event.type === 'image' && event.image.src === './assets/web.png');
  const monster = events.findIndex(event => event.type === 'fill' && event.color === '#df9696');
  const fogStart = events.findIndex(event => event.layer === 'fog'); assert.ok(art >= 0 && art < monster && monster < fogStart);
  const clears = () => events.filter(event => event.layer === 'objects' && event.type === 'clear').length;
  const first = clears(); frame(); assert.equal(clears(), first);
  state.visibility.routeExplored[''].delete('2,2'); frame(); assert.equal(clears(), first + 1);
  state.areaSpells = []; frame(); assert.equal(clears(), first + 2);
});
