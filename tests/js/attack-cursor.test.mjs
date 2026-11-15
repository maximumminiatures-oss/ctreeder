import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function attackCursorType(');
const end = source.indexOf('\nfunction applyLocalMovement(', start);
const cursorFunction = source.slice(start, end).replace('import.meta.url', 'moduleUrl');

function runtime(options = {}) {
  const panel = { style: {} }, draws = [], paint = [];
  const canvasContext = {
    globalCompositeOperation: 'source-over',
    globalAlpha: 1,
    drawImage(...args) {
      draws.push(args);
      paint.push(['image', this.globalCompositeOperation, this.globalAlpha]);
    },
    fillRect() { paint.push(['color', this.globalCompositeOperation, this.fillStyle]); }
  };
  const context = vm.createContext({
    SERVER_RUNTIME: false, ui: { mapHost: { parentElement: panel } },
    state: {}, dragState: null, mapHoverPointer: null, shiftAttackHeld: false, targetingMode: null,
    getActiveCharacter: () => ({ id: 'actor' }), ownsCharacter: () => true,
    getCharacterColorValue: () => '#bb0000', attackCursorCache: new Map(), attackCursorImages: new Map(),
    healingTargetCasterId: null, currentTargetingOverlay: () => null, getFirstCombatAttack: () => null,
    attackCursorImage: { naturalWidth: 54, naturalHeight: 54, src: 'http://localhost/site/assets/attack-alpha.png' },
    document: { createElement: () => ({ getContext: () => canvasContext,
      toDataURL: () => 'data:image/png;base64,sword' }) },
    URL, moduleUrl: 'http://localhost/site/src/main.js', ...options
  });
  vm.runInContext(cursorFunction, context);
  return { context, panel, draws, paint };
}

test('Shift shows the sword before the first map pointer move and while the mouse is pressed', () => {
  const { context, panel, draws } = runtime({ shiftAttackHeld: true });
  context.updateMonsterHoverCursor();
  assert.match(panel.style.cursor, /^url\("data:image\/png;base64,sword"\) 1 1/);
  assert.equal(draws.length, 1);
  context.dragState = { attackIntent: true };
  context.updateMonsterHoverCursor();
  assert.match(panel.style.cursor, /sword/);
  assert.equal(draws.length, 1, 'the tinted cursor is reused');
});

test('Shift uses the original alpha PNG while its tinted version is unavailable, even without a character', () => {
  const { context, panel } = runtime({ shiftAttackHeld: true, getActiveCharacter: () => null,
    attackCursorImage: { naturalWidth: 0, src: 'http://localhost/site/assets/attack-alpha.png' } });
  context.updateMonsterHoverCursor();
  assert.equal(panel.style.cursor, 'url("http://localhost/site/assets/attack-alpha.png") 1 1, crosshair');
});

test('releasing Shift restores the arrow unless a weapon is still selected', () => {
  const { context, panel } = runtime({ shiftAttackHeld: true });
  context.updateMonsterHoverCursor();
  context.shiftAttackHeld = false;
  context.updateMonsterHoverCursor();
  assert.equal(panel.style.cursor, 'default');
  context.dragState = {};
  context.updateMonsterHoverCursor();
  assert.equal(panel.style.cursor, 'grabbing');
  context.targetingMode = { kind: 'weapon' };
  context.updateMonsterHoverCursor();
  assert.match(panel.style.cursor, /sword/);
});

test('Steal masks the thief color to the bag and composites the PNG detail over it', () => {
  const thief = { id: 'thief', pendingSteal: { phase: 'targeting', turnKey: 'turn' } };
  const bag = { naturalWidth: 72, naturalHeight: 72, src: 'http://localhost/site/assets/bag-alpha.png' };
  const { context, draws, paint } = runtime({
    state: { characters: [thief] }, canControlCharacter: () => true, targetingTurnKey: () => 'turn',
    getCharacterColorValue: actor => actor.id === thief.id ? '#2277cc' : '#bb0000', stealCursorImage: bag
  });
  context.updateMonsterHoverCursor();
  context.updateMonsterHoverCursor();
  assert.deepEqual(draws.map(([image]) => image), [bag, bag]);
  assert.deepEqual(paint, [
    ['image', 'source-over', 1],
    ['color', 'source-in', '#2277cc'],
    ['image', 'source-atop', 0.45]
  ]);
});

test('weapon and targeted-spell cursors use their matching image', () => {
  const { context, draws } = runtime();
  const icons = { spear: { naturalWidth: 54 }, magic: { naturalWidth: 54 }, bow: { naturalWidth: 54 } };
  for (const [key, image] of Object.entries(icons)) context.attackCursorImages.set(key, image);
  context.targetingMode = { kind: 'weapon', attack: { name: 'Javelin' } };
  context.updateMonsterHoverCursor();
  context.targetingMode = null;
  context.currentTargetingOverlay = () => ({ kind: 'spell' });
  context.getActiveCharacter = () => ({ id: 'actor', pendingSpell: { spell: 'acid arrow' } });
  context.updateMonsterHoverCursor();
  context.getActiveCharacter = () => ({ id: 'actor', pendingSpell: { spell: 'light' } });
  context.updateMonsterHoverCursor();
  assert.deepEqual(draws.map(([image]) => image), [icons.spear, icons.bow, icons.magic]);
});
