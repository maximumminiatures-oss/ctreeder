import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import { canTargetAtRange } from '../../S3_content/src/targeting.js';
import { parseMonsterAttack } from '../../S3_content/src/monster-attacks.js';

const source = await readFile(new URL('../../S3_content/src/main.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../../S3_content/styles.css', import.meta.url), 'utf8');

function load(context, ...names) {
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, name);
    const next = source.slice(start + 1).search(/\n(?:async )?function /);
    vm.runInContext(source.slice(start, next < 0 ? undefined : start + 1 + next), context);
  }
}

function sandbox(t, html = '') {
  const dom = new JSDOM(html, { url: 'http://localhost/site/' });
  t.after(() => dom.window.close());
  const context = vm.createContext({ window: dom.window, document: dom.window.document });
  return { dom, context, document: dom.window.document };
}

test('panel and turn minis share name-only headers and read-only HP/max, AC and Attack text', t => {
  const { context, document } = sandbox(t, '<section id="monsters"></section>');
  const monster = { id: 'claws', name: 'Ghoul', hp: 4, maxHp: 11, ac: 12, level: 2,
    attack: '2 claws +3 (1d6)', abilities: { Paralysis: 'DC 12 CON' }, type: 'monster' };
  let opened = 0;
  Object.assign(context, {
    state: { entities: [monster] }, ui: { monsterPanel: document.querySelector('#monsters') }, parseMonsterAttack,
    prettifyAttackName: value => value.replace(/\b[a-z]/g, letter => letter.toUpperCase()),
    displayMonsterName: value => value.name, isSleeping: () => false,
    isMonsterCurrentlyVisible: () => true, concealedMimic: () => false,
    concealedAnimatedArmor: () => false, isDoppelganger: () => false,
    getCurrentCombatEntry: () => null, isCombatActive: () => false,
    openMonsterSheet: () => opened++
  });
  load(context, 'hasUiTextSelection', 'parseMonsterAttackSegment', 'appendMonsterAttackSegment',
    'createMonsterAttackContent', 'createMonsterMiniStats', 'renderMonsterMini', 'updateMonsterPanel');
  context.updateMonsterPanel();
  const panelCard = document.querySelector('.monster-card');
  const turnCard = context.renderMonsterMini(monster);
  for (const card of [panelCard, turnCard]) {
    assert.equal(card.querySelector('h3').textContent, 'Ghoul');
    assert.deepEqual([...card.querySelector('.monster-mini-stats').children].map(node => node.textContent),
      ['HP 4/11', 'AC 12', 'Attack: 2 Claws, +3 (1d6)']);
    assert.equal(card.querySelector('button, input, .damage-token, .attack-roll-button'), null);
    card.querySelector('.monster-mini-attack').click();
    assert.equal(monster.hp, 4);
    assert.match(card.title, /Paralysis: DC 12 CON/);
  }
  const title = panelCard.querySelector('h3');
  document.defaultView.getSelection().selectAllChildren(title);
  title.click();
  assert.equal(opened, 0, 'selecting a name must not open its sheet');
  document.defaultView.getSelection().removeAllRanges();
  title.click();
  assert.equal(opened, 1);
  monster.hp = 0;
  assert.equal(context.createMonsterMiniStats(monster).firstChild.textContent, 'HP 0/11');
  monster.attack = '<img src=x> breath (2d6)';
  const fallback = context.createMonsterAttackContent(monster);
  assert.equal(fallback.textContent, monster.attack);
  assert.equal(fallback.querySelector('*'), null);
  assert.doesNotMatch(source, /function (?:applyMonsterAttackRoll|createMonsterAttackButton)\(/);
});

test('dying labels remain ordinary text rather than full-sheet buttons or overlays', t => {
  const { context, document } = sandbox(t);
  load(context, 'createDyingBanner');
  assert.equal(context.createDyingBanner({}), null);
  const label = context.createDyingBanner({ name: 'Ad', dyingRounds: 2 });
  assert.equal(label.tagName, 'DIV');
  assert.equal(label.textContent, 'Ad will perish in 2 rounds!');
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  for (const className of ['character-card', 'character-sheet character-sheet--popout']) {
    const sheet = document.createElement('article'); sheet.className = className;
    sheet.append(label); document.body.append(sheet);
    const computed = document.defaultView.getComputedStyle(label);
    assert.equal(computed.position, 'static');
    assert.equal(computed.height, 'auto');
    assert.equal(computed.fontSize, '16px');
    assert.equal(computed.pointerEvents, 'none');
  }
  assert.equal(context.createDyingBanner({ dead: true }).textContent, 'DEAD');
});

test('field selection does not capture sheet/turn-card drags; blank-space dragging stays available', t => {
  const { context, document, dom } = sandbox(t,
    '<div id="layer"><article id="sheet" class="character-sheet"><section class="sd-sheet-field"><div class="sd-sheet-value">Ad</div></section><div id="blank"></div></article></div>');
  const sheet = document.querySelector('#sheet'), layer = document.querySelector('#layer');
  let captures = 0;
  Object.assign(context, { getCharacterSheetCard: () => sheet, characterSheetDrag: null });
  sheet.setPointerCapture = layer.setPointerCapture = () => captures++;
  load(context, 'isSelectableUiText', 'hasUiTextSelection', 'startCharacterSheetDrag', 'makeTurnCardDraggable');
  const value = document.querySelector('.sd-sheet-value');
  const event = target => ({ target, button: 0, pointerId: 1, clientX: 5, clientY: 8,
    preventDefault() { this.prevented = true; } });
  const selecting = event(value);
  context.startCharacterSheetDrag(selecting);
  assert.equal(selecting.prevented, undefined);
  assert.equal(context.characterSheetDrag, null);
  assert.equal(captures, 0);
  const dragging = event(document.querySelector('#blank'));
  context.startCharacterSheetDrag(dragging);
  assert.equal(dragging.prevented, true);
  assert.equal(captures, 1);
  context.makeTurnCardDraggable(layer);
  const pointer = target => target.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0 }));
  pointer(value);
  assert.equal(captures, 1);
  pointer(document.querySelector('#blank'));
  assert.equal(captures, 2);
  dom.window.getSelection().selectAllChildren(value);
  assert.equal(context.hasUiTextSelection(sheet), true);
  dom.window.getSelection().removeAllRanges();
  assert.equal(context.hasUiTextSelection(sheet), false);
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  assert.equal(dom.window.getComputedStyle(value.closest('section')).userSelect, 'text');
  assert.equal(dom.window.getComputedStyle(value.closest('section')).cursor, 'pointer');
});

test('native copy/select shortcuts bypass modal and game key guards without preventing defaults', t => {
  const { context, document, dom } = sandbox(t, '<div class="sd-sheet-value" tabindex="0">Copy this field</div>');
  const errors = [];
  dom.window.addEventListener('error', event => errors.push(event.error));
  Object.assign(context, { state: {} });
  load(context, 'isNativeTextShortcut');
  const start = source.indexOf('  document.addEventListener("keydown", (event) => {', source.indexOf('function hookInputEvents('));
  const end = source.indexOf('  ui.generateBtn.addEventListener', start);
  vm.runInContext(source.slice(start, end), context);
  const field = document.querySelector('div');
  for (const modifiers of [{ ctrlKey: true }, { metaKey: true }]) {
    for (const key of ['a', 'c', 'x', 'v', 'C', 'Insert']) {
      const event = new dom.window.KeyboardEvent('keydown', { key, ...modifiers, bubbles: true, cancelable: true });
      field.dispatchEvent(event);
      assert.equal(event.defaultPrevented, false, key);
    }
  }
  assert.equal(context.isNativeTextShortcut({ key: 's', ctrlKey: false }), false);
  assert.equal(context.isNativeTextShortcut({ key: 'ArrowLeft', ctrlKey: false }), false);
  assert.deepEqual(errors, []);
});

test('nearby selected thief highlights Open Lock; other actors highlight Smash inside the black border', t => {
  const { context, document } = sandbox(t,
    '<div class="party-selected-row"><span id="selected-character-swatch"></span><span id="selected-character-name"></span><span id="locked-door-actions"><button id="pick-lock-btn"></button><button id="break-door-btn"></button></span></div>');
  const actor = { id: 'actor', name: 'Shrigark', className: 'Thief', x: 1, y: 1, hp: 10 };
  const door = { id: 'door', subtype: 'door', x: 2, y: 1, doorState: 'locked' };
  const state = { activeCharacterId: actor.id, characters: [actor], entities: [door], combat: {}, map: { width: 5, height: 5 },
    tiles: Array.from({ length: 25 }, (_, i) => ({ x: i % 5, y: Math.floor(i / 5), type: 'floor' })) };
  const pick = document.querySelector('#pick-lock-btn'), smash = document.querySelector('#break-door-btn');
  Object.assign(context, {
    state, ui: { lockedDoorActions: document.querySelector('#locked-door-actions'), pickLockBtn: pick, breakDoorBtn: smash },
    getPendingLockedDoorAction: () => door.doorState === 'locked' ? { doorId: door.id, pickDc: 12, breakDc: 15 } : null,
    canControlCharacter: () => !actor.blocked, isCharacterAbleToAct: () => actor.hp > 0,
    isFloatingDisc: () => false, isAnimatedDead: value => Boolean(value.undead),
    isThief: value => value.className === 'Thief', isMagicallyLocked: value => value.magical,
    isCombatActive: () => Boolean(state.combat.active), isCurrentCharacterTurn: () => true,
    getCharacterColorValue: () => '#c02070', mixTokenColor: () => '#f4d3df', canTargetAtRange
  });
  load(context, 'getExplicitActiveCharacter', 'updateLockedDoorUi', 'updateSelectedPartyControls', 'applyRoomInteractionPermissions');
  const highlighted = () => [pick, smash].map(button => button.classList.contains('is-door-action-ready'));
  context.updateSelectedPartyControls();
  assert.deepEqual(highlighted(), [true, false]);
  assert.equal(document.querySelector('.party-selected-row').style.getPropertyValue('--selected-character-color'), '#c02070');
  actor.className = 'Fighter'; context.updateSelectedPartyControls();
  assert.deepEqual(highlighted(), [false, true]);
  actor.className = 'Thief'; actor.undead = true;
  Object.assign(context, { animatedDeadForm: () => 'skeleton', restInProgress: () => false });
  context.updateSelectedPartyControls(); context.applyRoomInteractionPermissions();
  assert.deepEqual(highlighted(), [false, true]);
  assert.equal(pick.disabled, true, 'undead cannot pick locks');
  assert.equal(smash.disabled, false);
  for (const change of [() => actor.x = 4, () => { actor.x = 1; actor.routeId = 'lower';
    state.underpasses = [{ id: 'lower', lowerCells: [{ x: 1, y: 1 }], upperCrossings: [{ x: 1, y: 1 }], portals: [] }]; },
    () => { actor.routeId = ''; state.underpasses = []; actor.blocked = true; }, () => { actor.blocked = false; state.combat.active = true; state.combat.actionUsed = true; },
    () => { state.combat.active = false; actor.hp = 0; }, () => { actor.hp = 10; door.doorState = 'open'; }]) {
    change(); context.updateSelectedPartyControls(); assert.deepEqual(highlighted(), [false, false]);
  }
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  smash.classList.add('is-door-action-ready');
  const computed = document.defaultView.getComputedStyle(smash);
  assert.equal(computed.borderTopColor, 'rgb(0, 0, 0)');
  assert.match(computed.boxShadow, /^inset 0 0 0 3px/);
});

test('discovery buttons identify traps, pulse in the finder color, and clear when resolved', t => {
  const { context, document } = sandbox(t, '<div id="search-discoveries" hidden></div>');
  const panel = document.querySelector('#search-discoveries');
  const actor = { id: 'thief' };
  const discovery = id => ({ id, characterId: actor.id, color: '#000' });
  const secret = { id: 'door', subtype: 'door', secret: true, doorState: 'closed', searchDiscovery: discovery('door') };
  const trap = { id: 'trap', type: 'trap', name: 'Flame', effect: 'DEX DC 11 or 2d6', searchDiscovery: discovery('trap') };
  const state = { seed: 1, level: 1, characters: [actor], player: actor, entities: [secret, trap] };
  Object.assign(context, { state, acknowledgedDiscoveries: new Set(), discoveryPulse: null,
    sameRoute: () => true, getCharacterColorValue: () => '#f04', render: () => {} });
  load(context, 'updateSearchDiscoveries');
  context.updateSearchDiscoveries();
  assert.deepEqual([...panel.children].map(button => button.textContent),
    ['Found: Secret Door', 'Found Trap: Flame (DEX DC 11 or 2d6)']);
  panel.lastElementChild.click();
  assert.equal(context.discoveryPulse.entity, trap);
  assert.equal(context.discoveryPulse.color, '#f04');
  context.updateSearchDiscoveries();
  assert.equal(panel.childElementCount, 1);
  secret.everOpened = true;
  context.updateSearchDiscoveries();
  assert.equal(panel.hidden, true);
  trap.searchDiscovery = discovery('another-trap');
  trap.triggered = true;
  context.updateSearchDiscoveries();
  assert.equal(panel.hidden, true);
});
