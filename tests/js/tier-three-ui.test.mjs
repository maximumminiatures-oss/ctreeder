import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTierTwoUi } from '../../S3_content/src/tier-two-ui.js';
import { drawAreaSpellOverlays } from '../../S3_content/src/render.js';

test('blast placement previews a clicked square and requires confirmation; invalid placement cannot be confirmed', async () => {
  const dom = new JSDOM('<main><div id="map"></div></main>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  let view = { id: 'cast-1', title: 'Fireball', area: { size: 7 } }, selection = null;
  const controller = createTierTwoUi({ getPresentation: () => view,
    resolve: value => { selection = value; view = null; }, preview: value => value?.x !== 20,
    mapHost: document.getElementById('map'), status() {} });
  try {
    controller.sync();
    const confirm = () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Confirm');
    assert.equal(confirm().disabled, true);
    controller.click(8, 9); assert.equal(confirm().disabled, false); assert.equal(selection, null);
    controller.click(20, 9); assert.equal(confirm().disabled, true);
    controller.click(6, 7); confirm().click(); await Promise.resolve();
    assert.deepEqual(selection, { x: 6, y: 7, confirmed: true });
    assert.equal(document.querySelector('.tier-two-target-panel'), null);
  } finally { controller.close(); globalThis.document = previous; dom.window.close(); }
});

test('busy shared placement cannot submit twice and moving the caster revalidates the selected preview', () => {
  const dom = new JSDOM('<main><div id="map"></div></main>');
  const previous = globalThis.document; globalThis.document = dom.window.document;
  let valid = true, calls = 0;
  const view = { id: 'cast-2', title: 'Lightning Bolt', area: {}, origin: { x: 2, y: 9 } };
  const controller = createTierTwoUi({ getPresentation: () => view, resolve: () => calls++,
    preview: () => valid, mapHost: document.getElementById('map'), status() {} });
  try {
    controller.sync(); controller.click(3, 9);
    valid = false; view.origin.x = 3; controller.sync();
    assert.equal(document.querySelector('button').disabled, true);
    view.busy = true; valid = true; controller.sync(); controller.click(4, 9);
    assert.ok([...document.querySelectorAll('button')].every(button => button.disabled));
    assert.equal(calls, 0);
  } finally { controller.close(); globalThis.document = previous; dom.window.close(); }
});

test('affected-cell previews draw only explored cells on the matching route without changing exploration', () => {
  const state = { characters: [], areaSpells: [], visibility: { exploredEver: new Set(['2,3']) } };
  const fills = [], outlines = [];
  const ctx = { globalAlpha: 1, save() {}, restore() {},
    fillRect: (...values) => fills.push(values), strokeRect: (...values) => outlines.push(values) };
  drawAreaSpellOverlays(state, ctx, { areaPreview: { color: '#336699', cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }] } });
  assert.equal(fills.length, 1); assert.equal(outlines.length, 1);
  assert.deepEqual([...state.visibility.exploredEver], ['2,3']);
  state.underpasses = [{}]; state.visibility.routeExplored = { lower: new Set(['3,3']) };
  fills.length = 0; outlines.length = 0;
  drawAreaSpellOverlays(state, ctx, { areaPreview: { cells: [{ x: 2, y: 3, routeId: 'lower' }, { x: 3, y: 3, routeId: 'lower' }] } });
  assert.equal(fills.length, 1); assert.equal(outlines.length, 1);
});
