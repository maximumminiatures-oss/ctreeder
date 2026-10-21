import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { TIER_TWO_CHOICES, castTierTwoSpell, resolveTierTwoSpell, tierTwoPresentation } from '../../S3_content/src/tier-two-spells.js';
import { maintainTierTwoFocus } from '../../S3_content/src/wizard-tier-two-focus.js';
import { activeAreaSpells, isSilenced, syncAreaSpellConditions } from '../../S3_content/src/area-spells.js';

const check = roll => modifier => ({ roll, modifier, total: roll + modifier });
function scene() {
  const state = createEmptyDungeonState(7);
  state.map = { width: 30, height: 20 };
  state.tiles = Array.from({ length: 600 }, (_, i) => ({ x: i % 30, y: Math.floor(i / 30), type: 'floor', roomId: 'room', meta: {} }));
  state.rooms = [{ id: 'room', x: 0, y: 0, width: 30, height: 20 }];
  state.characters = [{ id: 'wizard', name: 'Wizard', className: 'Wizard', hp: 30, maxHitPoints: 30,
    stats: { INT: 14 }, x: 3, y: 10, roomId: 'room', routeId: '', raw: {}, gear: [], spellsKnown: 'Silence' },
    { id: 'ally', name: 'Ally', hp: 10, maxHitPoints: 10, x: 6, y: 10, roomId: 'room', routeId: '', raw: {}, gear: [] }];
  state.activeCharacterId = 'wizard';
  Object.assign(state.player, { x: 3, y: 10, roomId: 'room', routeId: '', torchLit: false });
  return state;
}

// Match the parent bridge contract: focus owns the choice; the area module owns its geometry.
function bridgeOptions(onChoice = () => {}) {
  return {
    criticalChoices: TIER_TWO_CHOICES,
    onCriticalChoice: (state, caster, focus, choice) => {
      assert.equal(focus.spell, 'silence');
      assert.equal(choice, 'area');
      const zone = state.areaSpells.find(area => area.id === focus.areaId);
      zone.x -= 3; zone.y -= 3; zone.width = zone.height = 12;
      onChoice(state, caster, focus);
      syncAreaSpellConditions(state);
    },
    onFocusEnd: state => syncAreaSpellConditions(state)
  };
}

function placeSilence(state, roll = 12) {
  const caster = state.characters[0];
  assert.equal(castTierTwoSpell(state, caster, 'silence', { checkRoll: check(roll) }).succeeded, true);
  if (roll === 20) resolveTierTwoSpell(state, caster, { choice: 'area' });
  return resolveTierTwoSpell(state, caster, { x: 11, y: 10, confirmed: true }).zone;
}

test('Silence Focus twenties keep the original area without offering a critical, including after save/load', () => {
  let state = scene();
  let caster = state.characters[0];
  const zone = placeSilence(state);
  assert.equal(zone.width, 6);
  assert.equal(isSilenced(state, state.characters[1]), false);
  const maintenance = maintainTierTwoFocus(state, caster, { checkRoll: check(20), ...bridgeOptions() });
  assert.equal(maintenance.succeeded, true);
  assert.equal(maintenance.awaitingCritical, undefined);
  assert.equal(caster.pendingSpell, null);
  assert.equal(caster.focusSpell.critical, false);
  assert.equal(tierTwoPresentation(state, caster), null);

  state = hydrateDungeonState(serializeDungeonState(state)); caster = state.characters[0];
  let applications = 0;
  const options = bridgeOptions(() => applications++);
  maintainTierTwoFocus(state, caster, { checkRoll: check(20), ...options });
  assert.equal(applications, 0);assert.equal(caster.pendingSpell, null);
  assert.equal(caster.focusSpell.focusedRounds, 2);
  assert.equal(caster.focusSpell.criticalChoice, null);
  assert.equal(state.areaSpells.length, 1);
  assert.deepEqual(state.areaSpells[0].anchor, { x: 11, y: 10 });
  assert.deepEqual([state.areaSpells[0].x, state.areaSpells[0].y, state.areaSpells[0].width, state.areaSpells[0].height], [8, 7, 6, 6]);
  assert.equal(isSilenced(state, state.characters[1]), false);
  maintainTierTwoFocus(state, caster, { checkRoll: check(20), ...options });
  assert.equal(caster.pendingSpell, null, 'later natural twenties do not offer the critical again');
  assert.equal(applications, 0);
  assert.equal(state.areaSpells[0].x, 8, 'Focus cannot expand or relocate the selected area');
});

test('initial Silence critical stays on the area resolver and ordinary Focus failure ends the enlarged zone without spell loss', () => {
  const state = scene(), caster = state.characters[0];
  castTierTwoSpell(state, caster, 'silence', { checkRoll: check(20) });
  assert.equal(caster.pendingSpell.focusId, undefined);
  resolveTierTwoSpell(state, caster, { choice: 'area' });
  assert.equal(caster.pendingSpell.phase, 'placement');
  resolveTierTwoSpell(state, caster, { x: 11, y: 10, confirmed: true });
  assert.equal(state.areaSpells[0].width, 12);
  assert.equal(isSilenced(state, state.characters[1]), true);
  let applications = 0;
  const options = bridgeOptions(() => applications++);
  maintainTierTwoFocus(state, caster, { checkRoll: check(20), ...options });
  assert.equal(caster.pendingSpell, null);
  assert.equal(applications, 0, 'an initial critical already fixed the effect');
  const failure = maintainTierTwoFocus(state, caster, { checkRoll: check(2), ...options });
  assert.equal(failure.succeeded, false);
  assert.equal(caster.focusSpell, null);
  assert.equal(activeAreaSpells(state).length, 0);
  assert.equal(isSilenced(state, state.characters[1]), false);
  assert.equal(state.characters[1].conditions?.silenceAreas, undefined);
  assert.equal(caster.failedSpellKeys?.includes('silence') || false, false);
});

test('a damage-triggered Silence Focus twenty preserves another ready spell and does not advance or expand the area', () => {
  const state = scene(), caster = state.characters[0];
  placeSilence(state);
  const ready = { spell: 'magic missile', phase: 'targeting', remaining: 1 };
  caster.pendingSpell = ready;
  maintainTierTwoFocus(state, caster, { reason: 'damage', checkRoll: check(20), ...bridgeOptions() });
  assert.equal(caster.pendingSpell, ready);
  assert.equal(caster.focusSpell.focusedRounds, 0);
  assert.equal(state.areaSpells[0].width, 6);
});

test('Tier 2 visible descriptions match their paragraphs and preserve the existing spell metadata', async () => {
  const records = JSON.parse(await readFile(new URL('../../S3_content/spells/tier-2.json', import.meta.url), 'utf8'));
  assert.equal(records.length, 18);
  for (const record of records) {
    assert.equal(record.description, record.paragraphs.join('\n\n'), record.name);
    assert.equal(record.tier, 2);
    assert.ok(record.duration && record.range && record.rangeBand);
  }
  const byName = Object.fromEntries(records.map(record => [record.name, record]));
  assert.match(byName['Acid Arrow'].description, /12 squares/);
  assert.match(byName['Acid Arrow'].description, /2d6/);
  assert.match(byName['Detect Thoughts'].description, /You peer into the mind of a \[monster_name\] and learn some interesting stuff\./);
  assert.match(byName['Detect Thoughts'].description, /You learn how this \[monster_name\] fights\./);
  assert.match(byName['Detect Thoughts'].description, /You really get this \[monster_name\]\./);
  assert.match(byName['Detect Thoughts'].description, /one luck token per casting/i);
  assert.match(byName['Hold Person'].description, /level 8/);
  assert.match(byName.Silence.description, /12-by-12/);
  assert.match(byName.Invisibility.description, /two distinct creatures/i);
});
