import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const start = source.indexOf('function updateMonsterHoverCursor(');
const end = source.indexOf('\nfunction applyLocalMovement(', start);
const cursorFunction = source.slice(start, end).replace('import.meta.url', 'moduleUrl');

function runtime(options = {}) {
  const panel = { style: {} }, draws = [];
  const context = vm.createContext({
    SERVER_RUNTIME: false, ui: { mapHost: { parentElement: panel } },
    state: {}, dragState: null, mapHoverPointer: null, shiftAttackHeld: false, targetingMode: null,
    getActiveCharacter: () => ({ id: 'actor' }), ownsCharacter: () => true,
    getCharacterColorValue: () => '#bb0000', attackCursorCache: new Map(),
    attackCursorImage: { naturalWidth: 54, naturalHeight: 54, src: 'http://localhost/site/assets/attack-alpha.png' },
    document: { createElement: () => ({ getContext: () => ({ drawImage: (...args) => draws.push(args), fillRect() {} }),
      toDataURL: () => 'data:image/png;base64,sword' }) },
    URL, moduleUrl: 'http://localhost/site/src/main.js', ...options
  });
  vm.runInContext(cursorFunction, context);
  return { context, panel, draws };
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

test('releasing Shift restores the hand unless a weapon is still selected', () => {
  const { context, panel } = runtime({ shiftAttackHeld: true });
  context.updateMonsterHoverCursor();
  context.shiftAttackHeld = false;
  context.updateMonsterHoverCursor();
  assert.equal(panel.style.cursor, 'grab');
  context.dragState = {};
  context.updateMonsterHoverCursor();
  assert.equal(panel.style.cursor, 'grabbing');
  context.targetingMode = { kind: 'weapon' };
  context.updateMonsterHoverCursor();
  assert.match(panel.style.cursor, /sword/);
});
