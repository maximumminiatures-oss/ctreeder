import test from 'node:test';
import assert from 'node:assert/strict';
import { GASEOUS_FORM_ASSET, tintedGaseousImage, drawGaseousToken } from '../../S3_content/src/render-gaseous.js';

function canvas(width, height) {
  const calls = [], ctx = { globalCompositeOperation: 'source-over', fillStyle: '',
    drawImage(...args) { calls.push({ kind: 'image', mode: this.globalCompositeOperation, args }); },
    fillRect(...args) { calls.push({ kind: 'fill', mode: this.globalCompositeOperation, color: this.fillStyle, args }); } };
  return { width, height, calls, getContext: () => ctx };
}

test('cloud artwork is a cached alpha mask tinted by current character color without darkening it', () => {
  assert.equal(GASEOUS_FORM_ASSET, './assets/gaseous_form.png');
  const image = { width: 54, height: 54 };
  const tinted = tintedGaseousImage(image, '#22aacc', canvas);
  assert.deepEqual(tinted.calls.map(call => call.mode), ['source-over','source-in']);
  assert.equal(tinted.calls[1].color, '#22aacc');
  assert.equal(tintedGaseousImage(image, '#22aacc', canvas), tinted);
  assert.notEqual(tintedGaseousImage(image, '#ff0000', canvas), tinted);
});

test('gas token draws at animated position, fills exactly one tile, and keeps parent opacity and selection', () => {
  const actor = { x: 3, y: 3, visualX: 3.25, visualY: 3.5, colorValue: '#22aacc',
    transformationEffects: [{ spell: 'gaseous form', rounds: 10 }] };
  const calls = [], ctx = { globalAlpha: .5, save() {}, restore() {},
    drawImage(...args) { calls.push(args); }, beginPath() {}, arc() {}, stroke() {} };
  const state = { map: { width: 8, height: 8 }, tiles: [] };
  assert.equal(drawGaseousToken(state, ctx, actor, { image: { width: 54, height: 54 }, createCanvas: canvas, isActive: true }), true);
  assert.deepEqual(calls[0].slice(1), [3.25 * 54, 3.5 * 54, 54, 54]);
  assert.equal(ctx.globalAlpha, .5);
  actor.transformationEffects[0].rounds = 0;
  assert.equal(drawGaseousToken({}, ctx, actor, { image: {}, createCanvas: canvas }), false);
  assert.equal(calls.length, 1);
});
