import test from 'node:test';
import assert from 'node:assert/strict';
import { drawMirrorImages, drawAreaSpellOverlays, renderDungeon } from '../../S3_content/src/render.js';

function scene() {
  const caster = { id: 'wizard', name: 'Wizard', hp: 10, x: 3, y: 3, routeId: '', colorValue: '#22aacc', gear: [],
    transformationEffects: [{ spell: 'mirror image', rounds: 5, offsets: [{ dx: .3, dy: 0 }, { dx: 0, dy: -.3 }] }] };
  return { map: { width: 8, height: 8 }, tiles: Array.from({ length: 64 }, (_, i) => ({ x: i % 8, y: Math.floor(i / 8), type: 'floor', meta: {} })),
    rooms: [], entities: [], characters: [caster], player: { x: 3, y: 3, torchLit: false }, activeCharacterId: caster.id, decor: {},
    visibility: { exploredEver: new Set(['1,2', '2,2', '3,2']), visibleNow: new Set() } };
}

function context() {
  const calls = [], stack = [];
  const ctx = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, path: [], clips: [], canvas: { width: 432, height: 432 },
    save() { stack.push({ globalAlpha: this.globalAlpha, fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, clips: [...this.clips] }); },
    restore() { Object.assign(this, stack.pop()); }, beginPath() { this.path = []; },
    rect(...args) { this.path.push(args); }, clip() { this.clips.push([...this.path]); },
    arc(...args) { this.path.push(args); },
    fill() { calls.push({ method: 'fill', alpha: this.globalAlpha, color: this.fillStyle, path: [...this.path] }); },
    stroke() { calls.push({ method: 'stroke', alpha: this.globalAlpha, color: this.strokeStyle, path: [...this.path] }); },
    fillRect(...args) { calls.push({ method: 'fillRect', alpha: this.globalAlpha, color: this.fillStyle, args, clips: structuredClone(this.clips) }); },
    strokeRect(...args) { calls.push({ method: 'strokeRect', alpha: this.globalAlpha, color: this.strokeStyle, width: this.lineWidth, args, clips: structuredClone(this.clips) }); },
    clearRect() {}, moveTo() {}, lineTo() {}, closePath() {}, setLineDash() {} };
  return { ctx, calls, stack };
}

test('mirror renderer paints translucent same-color tokens at current visual offsets with no selected ring', () => {
  const state = scene(), caster = state.characters[0], { ctx, calls, stack } = context();
  caster.visualX = 3.25; caster.visualY = 3.1;
  drawMirrorImages(state, ctx, caster);
  const dots = calls.filter(call => call.method === 'fill');
  assert.equal(dots.length, 2); assert.ok(dots.every(call => call.alpha === .5 && call.color === caster.colorValue));
  assert.ok(Math.abs(dots[0].path[0][0] - (3.25 + .3 + .5) * 54) < 1e-6);
  assert.equal(calls.some(call => call.method === 'stroke'), false); assert.equal(stack.length, 0); assert.equal(ctx.globalAlpha, 1);
  caster.colorValue = '#ff2222'; caster.routeId = 'lower'; calls.length = 0;
  drawMirrorImages(state, ctx, caster);
  assert.ok(calls.every(call => call.alpha === .25 && call.color === '#ff2222'));
});

test('area preview shows its thin outline over unknown cells but clips tint to explored floor cells', () => {
  const state = scene(), { ctx, calls, stack } = context(); state.tiles[2 * 8 + 2].type = 'wall';
  drawAreaSpellOverlays(state, ctx, { areaPreview: { x: 1, y: 1, width: 4, height: 3, color: '#22aacc', routeId: '', spell: 'web' } });
  const fill = calls.find(call => call.method === 'fillRect'), outline = calls.find(call => call.method === 'strokeRect');
  assert.equal(fill.alpha, .1); assert.equal(fill.color, '#ffffff');
  assert.deepEqual(fill.args, [54, 54, 216, 162]);
  assert.deepEqual(fill.clips.at(-1), [[54, 108, 54, 54], [162, 108, 54, 54]]);
  assert.equal(outline.color, '#22aacc'); assert.equal(outline.width, 1); assert.deepEqual(outline.clips, []);
  assert.equal(stack.length, 0); assert.equal(ctx.globalAlpha, 1);
});

test('area clipping keeps upper/lower route exploration separate at a shared crossing', () => {
  const state = scene(), { ctx, calls } = context();
  state.underpasses = [{ id: 'lower', lowerCells: [{ x: 2, y: 2 }, { x: 3, y: 2 }], upperCrossings: [{ x: 3, y: 2 }], portals: [] }];
  state.visibility.routeExplored = { '': new Set(['1,2','2,2','3,2']), lower: new Set(['2,2']) };
  drawAreaSpellOverlays(state, ctx, { areaPreview: { x: 1, y: 2, width: 3, height: 1, color: '#22aacc', routeId: 'lower' } });
  assert.deepEqual(calls[0].clips.at(-1), [[108, 108, 54, 54]]);
  calls.length = 0;
  drawAreaSpellOverlays(state, ctx, { areaPreview: { x: 1, y: 2, width: 3, height: 1, color: '#22aacc', routeId: '' } });
  assert.deepEqual(calls[0].clips.at(-1), [[54, 108, 54, 54], [162, 108, 54, 54]]);
});

test('active webs use areaSpellVisuals and burning webs fade red until their fade ends', () => {
  const state = scene(), { ctx, calls } = context();
  state.areaSpells = [{ id: 'web', spell: 'web', casterId: 'wizard', x: 1, y: 2, width: 3, height: 1, routeId: '', rounds: 5, color: '#22aacc' }];
  drawAreaSpellOverlays(state, ctx, { now: 1000 });
  assert.equal(calls[0].color, '#ffffff'); assert.equal(calls[0].alpha, .1);
  Object.assign(state.areaSpells[0], { burnedAt: 1000, burnFadeMs: 1500, rounds: 0 }); calls.length = 0;
  drawAreaSpellOverlays(state, ctx, { now: 1750 });
  assert.equal(calls[0].color, '#ff0000'); assert.equal(calls[0].alpha, .2);
  assert.equal(calls[1].alpha, .5); assert.equal(calls[1].color, '#22aacc');
  calls.length = 0; drawAreaSpellOverlays(state, ctx, { now: 2500 }); assert.equal(calls.length, 0);
});

test('motion-only dungeon frames include areaPreview and mirror images without rebuilding terrain', () => {
  const state = scene(), { ctx, calls } = context();
  renderDungeon(state, { fogCtx: ctx }, { motionOnly: true,
    areaPreview: { x: 1, y: 2, width: 3, height: 1, color: '#22aacc', routeId: '' } });
  assert.ok(calls.some(call => call.method === 'strokeRect' && call.color === '#22aacc'));
  assert.equal(calls.filter(call => call.method === 'fill' && call.alpha === .5 && call.color === '#22aacc').length, 2);
});

test('movement overlays retain full water radius for Gills and Levitate', () => {
  for (const effect of [null, { spell: 'alter self', rounds: 5, features: ['gills'] }, { spell: 'levitate', casterId: 'wizard' }]) {
    const state = scene(), { ctx, calls } = context(), actor = state.characters[0];
    actor.transformationEffects = effect ? [effect] : [];
    actor.lightRadius = 6;
    state.tiles[2 * 8 + 2].meta.slowWater = true;
    state.visibility.visibleNow = new Set(state.tiles.map(tile => `${tile.x},${tile.y}`));
    state.combat = { active: true, turnIndex: 0, turnOrder: [{ type: 'character', id: actor.id }], movementRemaining: 6 };
    renderDungeon(state, { fogCtx: ctx }, { motionOnly: true });
    const circles = calls.filter(call => call.method === 'fill' && call.alpha === .2 && call.color === actor.colorValue);
    assert.deepEqual(circles.map(call => call.path[0][2]), [6 * 54, (effect ? 6 : 3) * 54]);
  }
});
