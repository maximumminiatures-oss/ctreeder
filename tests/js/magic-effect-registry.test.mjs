import test from 'node:test';
import assert from 'node:assert/strict';
import { listMagicEffects, endMagicEffect } from '../../S3_content/src/magic-effect-registry.js';
import { isMagicSuppressed } from '../../S3_content/src/magic-suppression.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { syncAreaSpellConditions } from '../../S3_content/src/area-spells.js';
import { cleanupWizardTierTwoFocus } from '../../S3_content/src/wizard-tier-two-focus.js';

const actor = (id, extra = {}) => ({ id, name: id, x: 2, y: 2, routeId: '', hp: 20,
  maxHitPoints: 20, stats: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 }, gear: [], conditions: {}, raw: {}, ...extra });
function scene() {
  const state = createEmptyDungeonState(3);
  state.map = { width: 12, height: 12 };
  state.tiles = Array.from({ length: 144 }, (_, index) => ({ x: index % 12, y: Math.floor(index / 12), type: 'floor', meta: {} }));
  const caster = actor('caster'), ally = actor('ally'), foe = actor('foe', { type: 'monster' });
  state.characters = [caster, ally]; state.entities = [foe]; state.activeCharacterId = caster.id;
  return { state, caster, ally, foe };
}
const find = (state, spell, targetId, predicate = () => true) => listMagicEffects(state).find(effect =>
  effect.spell === spell && (targetId == null || effect.targetId === targetId) && predicate(effect));
function end(state, spell, targetId, options, predicate) {
  const effect = find(state, spell, targetId, predicate);
  assert.ok(effect, `Missing ${spell} on ${targetId}`);
  return endMagicEffect(state, effect.id, options);
}
function held(target, sources, base = null) {
  target.conditions = { prone: true, holdPersonSources: { ...sources }, holdPersonBaseParalyzed: base,
    paralyzed: { source: 'hold person', focusId: Object.keys(sources)[0], sources: { ...sources } } };
  target.raw.conditions = structuredClone(target.conditions);
}

test('listing is read-only, plain, deterministic across JSON, and never accepts property paths', () => {
  const { state, caster } = scene();
  caster.wizardEffects = [{ type: 'mage-armor', rounds: 5, armorClass: 14 }];
  caster.gear = [{ name: 'Dagger', instanceId: 'dagger', holyWeapon: { rounds: 5, casterId: 'caster' } }];
  const before = JSON.stringify(state), effects = listMagicEffects(state);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(listMagicEffects(JSON.parse(before)), effects);
  assert.deepEqual(JSON.parse(JSON.stringify(effects)), effects);
  assert.equal(new Set(effects.map(effect => effect.id)).size, effects.length);
  for (const bad of ['characters.0.wizardEffects', '__proto__', { id: effects[0].id }, null])
    assert.throws(() => endMagicEffect(state, bad), /no longer active/);
  assert.equal(JSON.stringify(state), before);
});

test('overlapping creature and gear effects are independently selectable with holder target IDs', () => {
  const { state, caster } = scene();
  caster.wizardEffects = [{ type: 'mage-armor', rounds: 10 }];
  caster.faithEffects = [{ spell: 'shield of faith', rounds: 5, bonus: 2 }];
  caster.gear = [{ name: '+1 Longsword', instanceId: 'sword', magic: { kind: 'weapon', bonus: 1 },
    holyWeapon: { casterId: 'caster', rounds: 5 }, cleansingWeapon: { rounds: 5, diceCount: 1 }, lightSpellLit: true }];
  caster.raw.gear = structuredClone(caster.gear);
  const effects = listMagicEffects(state).filter(effect => effect.targetId === caster.id);
  assert.equal(effects.length, 6);
  assert.ok(effects.some(effect => effect.name === '+1 Longsword magic' && effect.itemIndex === 0));
  assert.ok(effects.some(effect => effect.name === 'Holy Weapon (+1 Longsword)'));
  end(state, 'holy weapon', caster.id);
  assert.equal(caster.gear[0].holyWeapon, undefined);
  assert.equal(caster.raw.gear[0].holyWeapon, undefined);
  assert.equal(listMagicEffects(state).length, 5);
  assert.ok(caster.gear[0].cleansingWeapon);
  assert.equal(caster.faithEffects.length, 1);
  assert.equal(caster.wizardEffects.length, 1);
});

test('Sleep removes only the selected explicit spell sleep, retaining prone and rest sleep', () => {
  const { state, caster, ally, foe } = scene();
  for (const target of [caster, ally]) target.conditions = { sleeping: { source: 'sleep', casterId: 'foe' }, prone: true, poisoned: true };
  foe.conditions.sleeping = { source: 'rest' };
  caster.raw.conditions = structuredClone(caster.conditions);
  state.rest = { phase: 'sleeping', participantIds: ['foe'] };
  assert.equal(listMagicEffects(state).filter(effect => effect.spell === 'sleep').length, 2);
  end(state, 'sleep', caster.id);
  assert.deepEqual(caster.conditions, { prone: true, poisoned: true });
  assert.deepEqual(caster.raw.conditions, caster.conditions);
  assert.ok(ally.conditions.sleeping);
  assert.ok(foe.conditions.sleeping);
});

test('ancestry invisibility and mundane conditions are excluded; spell and potion invisibility are removable', () => {
  const { state, caster, ally, foe } = scene();
  caster.invisibility = { source: 'halfling', rounds: 3 };
  caster.conditions = { blind: true, paralyzed: { source: 'venom' }, prone: true };
  ally.invisibility = { source: 'spell', rounds: 5 };
  foe.invisibility = { source: 'potion', rounds: 10 };
  assert.equal(listMagicEffects(state).length, 2);
  end(state, 'invisibility', ally.id);
  assert.ok(caster.invisibility);
  assert.ok(foe.invisibility);
  assert.deepEqual(caster.conditions, { blind: true, paralyzed: { source: 'venom' }, prone: true });
});

test('Hold Person prunes one target and one source, preserves sibling and base paralysis, and mirrors raw', () => {
  const { state, caster, ally, foe } = scene();
  const other = actor('other'); state.characters.push(other);
  caster.focusSpell = { id: 'focus-a', spell: 'hold person', tier: 2, targetIds: ['ally', 'foe'] };
  other.focusSpell = { id: 'focus-b', spell: 'hold person', tier: 2, targetIds: ['ally'] };
  held(ally, { 'focus-a': 'caster', 'focus-b': 'other' }, { source: 'venom' });
  held(foe, { 'focus-a': 'caster' });
  end(state, 'hold person', ally.id, {}, effect => effect.casterId === caster.id);
  assert.deepEqual(caster.focusSpell.targetIds, ['foe']);
  assert.deepEqual(caster.raw.focusSpell.targetIds, ['foe']);
  assert.deepEqual(ally.conditions.holdPersonSources, { 'focus-b': 'other' });
  assert.deepEqual(ally.raw.conditions, ally.conditions);
  assert.ok(foe.conditions.paralyzed);
  let callback;
  end(state, 'hold person', ally.id, { onFocusEnd: (...args) => { callback = args; } });
  assert.deepEqual(ally.conditions.paralyzed, { source: 'venom' });
  assert.equal(other.focusSpell, null);
  assert.equal(callback[1], other); assert.equal(callback[2].id, 'focus-b'); assert.equal(callback[3], 'dispelled');
  assert.deepEqual(caster.focusSpell.targetIds, ['foe']);
});

test('Blind/Deafen uses source cleanup without removing other sources, base senses, or other targets', () => {
  const { state, caster, ally, foe } = scene();
  const other = actor('other'); state.characters.push(other);
  caster.focusSpell = { id: 'a', spell: 'blind deafen', tier: 2, targetIds: ['ally', 'foe'] };
  other.focusSpell = { id: 'b', spell: 'blind deafen', tier: 2, targetIds: ['ally'] };
  const senses = sources => ({ priestTierTwoSenses: { blind: { base: { source: 'injury' }, sources },
    deafened: { base: null, sources: { ...sources } } }, blind: { source: 'blind deafen' }, deafened: { source: 'blind deafen' } });
  ally.conditions = senses({ a: 'caster', b: 'other' }); foe.conditions = senses({ a: 'caster' });
  end(state, 'blind deafen', 'ally', {}, effect => effect.casterId === 'caster');
  assert.deepEqual(ally.conditions.priestTierTwoSenses.blind.sources, { b: 'other' });
  assert.deepEqual(caster.focusSpell.targetIds, ['foe']);
  assert.ok(foe.conditions.deafened);
  end(state, 'blind deafen', 'ally');
  assert.deepEqual(ally.conditions.blind, { source: 'injury' });
  assert.equal(ally.conditions.deafened, undefined);
  assert.deepEqual(ally.raw.conditions, ally.conditions);
});

test('Acid Arrow and Detect Thoughts remove only a target; last target invokes focus callback once', () => {
  for (const spell of ['acid arrow', 'detect thoughts', 'zone of truth']) {
    const { state, caster } = scene(); let ended = 0;
    caster.focusSpell = { id: 'focus', spell, tier: 2, targetIds: ['ally', 'foe'] };
    end(state, spell, 'ally', { onFocusEnd: () => ended++ });
    assert.deepEqual(caster.focusSpell.targetIds, ['foe']); assert.equal(ended, 0);
    end(state, spell, 'foe', { onFocusEnd: () => ended++ });
    assert.equal(caster.focusSpell, null); assert.equal(ended, 1);
  }
});

test('caster auras end whole Focus, not buffs or another caster aura', () => {
  const { state, caster, ally } = scene();
  caster.focusSpell = { spell: 'protection from evil', radius: 2 };
  caster.pendingSpell = { spell: 'fireball', phase: 'targeting' };
  ally.focusSpell = { spell: 'detect magic', radius: 6 };
  caster.faithEffects = [{ spell: 'shield of faith', rounds: 5 }];
  end(state, 'protection from evil', 'caster');
  assert.equal(caster.focusSpell, null); assert.ok(ally.focusSpell); assert.equal(caster.faithEffects.length, 1);
  assert.deepEqual(caster.pendingSpell, { spell: 'fireball', phase: 'targeting' });
  end(state, 'detect magic', 'ally'); assert.equal(ally.focusSpell, null);
});

test('Web and Silence expose whole rectangles on their route and remove one zone and its derived conditions', () => {
  const { state, caster, ally } = scene();
  caster.focusSpell = { spell: 'silence', tier: 2, areaId: 'quiet' };
  state.areaSpells = [{ id: 'web-a', spell: 'web', x: 1, y: 1, width: 6, height: 6, routeId: '', rounds: 10, casterId: 'caster' },
    { id: 'web-b', spell: 'web', x: 1, y: 1, width: 6, height: 6, routeId: '', rounds: 5, casterId: 'ally' },
    { id: 'quiet', spell: 'silence', x: 1, y: 1, width: 6, height: 6, routeId: '', casterId: 'caster' }];
  syncAreaSpellConditions(state);
  const descriptor = find(state, 'web', 'web-a');
  assert.deepEqual([descriptor.x, descriptor.y, descriptor.width, descriptor.height, descriptor.routeId], [1, 1, 6, 6, '']);
  const atCell = listMagicEffects(state).filter(effect => effect.kind === 'area' && 5 >= effect.x && 5 < effect.x + effect.width && 6 >= effect.y && 6 < effect.y + effect.height);
  assert.equal(atCell.length, 3);
  endMagicEffect(state, descriptor.id);
  assert.deepEqual(ally.conditions.webs, ['web-b']); assert.deepEqual(ally.conditions.silenceAreas, ['quiet']);
  end(state, 'silence', 'quiet');
  assert.equal(caster.focusSpell, null); assert.equal(ally.conditions.silenceAreas, undefined);
  assert.deepEqual(ally.conditions.webs, ['web-b']);
  assert.deepEqual(ally.raw.conditions, ally.conditions);
});

test('Fixed Object restores original movement and Hold Portal does not unlock a mundane door', () => {
  const { state } = scene();
  const door = { id: 'door', type: 'feature', subtype: 'door', x: 3, y: 3, locked: true, doorState: 'closed', holdPortal: { rounds: 10 } };
  const object = { id: 'object', type: 'treasure', x: 4, y: 3, blocksMovement: true,
    fixedObject: { rounds: 5, hadBlocksMovement: true, originalBlocksMovement: false }, raw: {} };
  state.entities.push(door, object);
  end(state, 'hold portal', 'door');
  assert.equal(door.locked, true); assert.equal(door.doorState, 'closed'); assert.equal(door.holdPortal, undefined);
  end(state, 'fixed object', 'object');
  assert.equal(object.blocksMovement, false); assert.equal(object.raw.blocksMovement, false);
});

test('Light supports token, carried item, dropped item and square while preserving mundane torch light', () => {
  const { state, caster, ally } = scene();
  caster.lightSpellLit = true;
  caster.gear = [{ name: 'Torch', type: 'light', equipped: true, lit: true }, { name: 'Dagger', lightSpellLit: true }];
  ally.lightSpellLit = true;
  const drop = { id: 'drop', type: 'treasure', x: 3, y: 2, gearItem: { name: 'Rock', lightSpellLit: true } };
  const square = { id: 'square', type: 'feature', subtype: 'spell-light', x: 4, y: 2, lightSpellLit: true, lightSource: 'light-spell', lightRadius: 6 };
  state.entities.push(drop, square);
  assert.equal(listMagicEffects(state).filter(effect => effect.spell === 'light').length, 5);
  end(state, 'light', 'caster', {}, effect => effect.itemIndex == null);
  assert.equal(caster.lightSource, 'torch'); assert.equal(caster.lightRadius, 6); assert.equal(state.player.torchLit, true);
  assert.ok(caster.gear[1].lightSpellLit); assert.ok(ally.lightSpellLit);
  end(state, 'light', 'drop'); assert.equal(drop.gearItem.lightSpellLit, undefined);
  end(state, 'light', 'square'); assert.ok(!state.entities.includes(square));
  state.timers.torchElapsedMs = 3600000;
  assert.equal(listMagicEffects(state).filter(effect => effect.spell === 'light').length, 0);
});

test('Alter Self restores ancestry and gill invisibility without deleting Mirror Image or mundane traits', () => {
  const { state, caster } = scene();
  caster.ancestry = 'Bandit'; caster.raw.ancestry = 'Bandit'; caster.talents = ['Stealthy'];
  caster.transformationEffects = [{ spell: 'alter self', rounds: 5, originalAncestry: 'Halfling', features: ['gills', 'foe-form'] },
    { spell: 'mirror image', rounds: 5, offsets: [{ dx: .3, dy: 0 }] }];
  caster.invisibility = { source: 'alter-self-gills', rounds: 5 };
  const mirrorId = find(state, 'mirror image', 'caster').id;
  end(state, 'alter self', 'caster');
  assert.equal(caster.ancestry, 'Halfling'); assert.equal(caster.raw.ancestry, 'Halfling');
  assert.equal(caster.invisibility, undefined); assert.deepEqual(caster.talents, ['Stealthy']);
  assert.deepEqual(caster.transformationEffects.map(effect => effect.spell), ['mirror image']);
  assert.equal(find(state, 'mirror image', 'caster').id, mirrorId);
  end(state, 'mirror image', 'caster'); assert.deepEqual(caster.raw.transformationEffects, []);
});

test('critical multi-effect selection retains IDs across removal of different array spell types and sources', () => {
  const { state, caster } = scene();
  caster.faithEffects = [{ spell: 'shield of faith', rounds: 5, casterId: 'caster' },
    { spell: 'other blessing', rounds: 5, casterId: 'caster' },
    { spell: 'shield of faith', rounds: 5, casterId: 'ally' }];
  const before = listMagicEffects(state), used = new Set();
  used.add(endMagicEffect(state, before[0].id).effect.id);
  const remaining = listMagicEffects(state).filter(effect => !used.has(effect.id));
  assert.deepEqual(remaining.map(effect => effect.id), before.slice(1).map(effect => effect.id));
  endMagicEffect(state, before[1].id);
  assert.deepEqual(listMagicEffects(state).map(effect => effect.id), [before[2].id]);
});

test('permanent lock flags are catalogued without tags or read-time mutation', () => {
  const { state } = scene();
  state.entities.push({ id: 'lock-a', type: 'feature', subtype: 'door', name: 'Door', magicalLock: true, locked: true, x: 2, y: 3 },
    { id: 'lock-b', type: 'feature', subtype: 'door', name: 'Door', magicallyLocked: true, x: 3, y: 3 },
    { id: 'lock-c', type: 'feature', subtype: 'door', name: 'Door', magicLock: true, locked: true, x: 4, y: 3 },
    { id: 'ordinary', type: 'feature', subtype: 'door', name: 'Door', locked: true, x: 5, y: 3 });
  const before = JSON.stringify(state);
  const effects = listMagicEffects(state).filter(effect => effect.kind === 'suppression');
  assert.deepEqual(effects.map(effect => effect.targetId), ['lock-a', 'lock-b', 'lock-c']);
  assert.equal(JSON.stringify(state), before);
  for (const effect of effects) endMagicEffect(state, effect.id);
  for (const door of state.entities.filter(entity => entity.id.startsWith('lock-'))) assert.equal(isMagicSuppressed(door), true);
  assert.equal(state.entities.find(entity => entity.id === 'lock-a').locked, true);
});

test('Levitate removes one target transformation and leaves caster and other targets levitating', () => {
  const { state, caster, ally } = scene();
  caster.focusSpell = { spell: 'levitate', tier: 2, targetIds: ['caster', 'ally'] };
  for (const target of [caster, ally]) target.transformationEffects = [{ spell: 'levitate', casterId: 'caster' }];
  assert.equal(listMagicEffects(state).filter(effect => effect.spell === 'levitate').length, 2);
  end(state, 'levitate', 'ally');
  assert.deepEqual(caster.focusSpell.targetIds, ['caster']); assert.equal(caster.transformationEffects.length, 1);
  assert.deepEqual(ally.transformationEffects, []);
});

test('charm removes only selected target and calls companion callback before erasing its metadata', () => {
  const { state, caster, ally, foe } = scene(); let callback = 0;
  ally.companion = { kind: 'charmed', charm: { casterId: caster.id, remainingMs: 1000 }, source: { charm: { casterId: caster.id } } };
  ally.raw.companion = structuredClone(ally.companion);
  foe.charm = { casterId: caster.id, remainingMs: 1000 };
  end(state, 'charm person', 'ally', { onCharmEnd: (s, target, charm) => {
    assert.equal(s, state); assert.equal(target, ally); assert.equal(charm.casterId, caster.id);
    assert.ok(target.companion.charm); callback++;
  } });
  assert.equal(callback, 1); assert.equal(ally.companion.charm, undefined); assert.equal(ally.raw.companion.charm, undefined);
  assert.ok(foe.charm);
  end(state, 'charm person', 'foe'); assert.equal(foe.charm, undefined); assert.equal(foe.attitude, 'suspicious');
});

test('ongoing potion effects restore STR, while permanent potion vitality and other buffs stay unchanged', () => {
  const { state, caster } = scene();
  caster.stats.STR = 18; caster.potionEffects = [{ type: 'giant-strength', rounds: 10, originalStrength: 11 }];
  caster.vitalityPotionsDrunk = 1; caster.maxHitPoints = 24; caster.raw.stats = structuredClone(caster.stats);
  end(state, 'giant strength', 'caster');
  assert.equal(caster.stats.STR, 11); assert.equal(caster.raw.stats.STR, 11);
  assert.deepEqual(caster.raw.potionEffects, []); assert.equal(caster.maxHitPoints, 24); assert.equal(caster.vitalityPotionsDrunk, 1);
});

test('Floating Disc returns cargo handoff, expires exactly one disc, and never destroys cargo', () => {
  const { state } = scene();
  const disc = actor('disc', { hp: 0, gear: [{ name: 'Treasure' }], summon: { kind: 'floating-disc', casterId: 'caster', remainingMs: 5000 } });
  const sibling = actor('disc-2', { hp: 0, summon: { kind: 'floating-disc', casterId: 'caster', remainingMs: 5000 } });
  state.characters.push(disc, sibling);
  const result = end(state, 'floating disc', disc.id);
  assert.equal(result.removedDisc, disc); assert.equal(disc.summon.remainingMs, 0); assert.equal(disc.raw.summon.remainingMs, 0);
  assert.deepEqual(disc.gear, [{ name: 'Treasure' }]); assert.equal(sibling.summon.remainingMs, 5000);
  assert.ok(state.characters.includes(disc)); assert.equal(find(state, 'floating disc', disc.id), undefined);
});

test('summon dismissal removes only chosen summon without death, loot or corpse creation', () => {
  const { state } = scene();
  const summoned = actor('summon-a', { type: 'monster', summon: { spell: 'summon monster', casterId: 'caster', kind: 'monster' }, gear: [{ name: 'Sword' }] });
  const sibling = actor('summon-b', { type: 'monster', summon: { spell: 'summon monster', casterId: 'caster', kind: 'monster' } });
  const corpse = actor('dead-summon', { type: 'monster', hp: 0, defeated: true, summon: { spell: 'summon monster' } });
  state.entities.push(summoned, sibling, corpse);
  state.combat = { active: true, monsterIds: ['summon-a', 'summon-b'], turnOrder: [{ id: 'summon-a' }, { id: 'summon-b' }], turnIndex: 1 };
  assert.equal(find(state, 'summon monster', corpse.id), undefined);
  end(state, 'summon monster', summoned.id);
  assert.ok(!state.entities.includes(summoned)); assert.ok(state.entities.includes(sibling)); assert.ok(state.entities.includes(corpse));
  assert.equal(summoned.hp, 20); assert.equal(summoned.defeated, undefined);
  assert.deepEqual(state.combat.monsterIds, ['summon-b']); assert.equal(state.combat.turnIndex, 0);
  assert.equal(state.entities.filter(entity => entity.type === 'treasure').length, 0);
});

test('permanent gear, potion, wand, trap and lock magic suppress for ten rounds; scrolls are immune', () => {
  const { state, caster } = scene();
  caster.gear = [{ name: '+1 Sword', magic: { kind: 'weapon', bonus: 1 } },
    { name: 'Potion', magic: { kind: 'potion', potion: 'invisibility' } },
    { name: 'Wand', magic: { kind: 'wand' } }, { name: 'Scroll', magic: { kind: 'scroll', spellName: 'Sleep' } }];
  caster.raw.gear = structuredClone(caster.gear);
  const trap = { id: 'trap', type: 'trap', name: 'Magical rune trap', magical: true, x: 3, y: 3 };
  const door = { id: 'door', type: 'feature', subtype: 'door', name: 'Magic lock', magical: true, locked: true, x: 4, y: 3 };
  const drop = { id: 'drop', type: 'treasure', name: '+1 Dagger', x: 5, y: 3, gearItem: { name: '+1 Dagger', magic: { kind: 'weapon', bonus: 1 } } };
  state.entities.push(trap, door, drop);
  const effects = listMagicEffects(state).filter(effect => effect.kind === 'suppression');
  assert.equal(effects.length, 6);
  for (const effect of effects) endMagicEffect(state, effect.id);
  for (const item of caster.gear.slice(0, 3)) { assert.equal(isMagicSuppressed(item), true); assert.equal(item.magicSuppression.rounds, 10); }
  assert.equal(isMagicSuppressed(caster.gear[3]), false); assert.equal(caster.gear[3].name, 'Scroll');
  assert.equal(caster.raw.gear[0].magicSuppression.rounds, 10);
  assert.equal(isMagicSuppressed(trap), true); assert.equal(isMagicSuppressed(door), true); assert.equal(door.locked, true);
  assert.equal(isMagicSuppressed(drop.gearItem), true); assert.equal(drop.name, drop.gearItem.name);
  assert.equal(listMagicEffects(state).length, 0);
});

test('Bless requires active luck provenance and clears only its token plus raw provenance', () => {
  const { state, caster, ally } = scene();
  caster.blessEffect = { id: 'bless-1', spell: 'bless', casterId: 'ally' }; caster.luckTokens = 1; caster.luckToken = true;
  caster.raw.blessEffect = structuredClone(caster.blessEffect); caster.raw.luckTokens = 1; caster.raw.luckToken = true;
  ally.luckTokens = 1;
  assert.equal(listMagicEffects(state).filter(effect => effect.spell === 'bless').length, 1);
  end(state, 'bless', 'caster');
  assert.equal(caster.luckToken, false); assert.equal(caster.luckTokens, 0); assert.equal(caster.raw.luckToken, false);
  assert.equal(caster.raw.luckTokens, 0); assert.equal(caster.raw.blessEffect, undefined); assert.equal(ally.luckTokens, 1);
  caster.blessEffect = { spell: 'bless' };
  assert.equal(find(state, 'bless', 'caster'), undefined);
});

test('generic Whispers areas, Omens self, and future summon records are passive and support callback cleanup', () => {
  const { state, caster, foe } = scene();
  foe.spellEffects = [{ id: 'omens', spell: 'Omens', casterId: 'foe', targetId: 'foe', kind: 'self', rounds: 3, sourceType: 'monster' }];
  state.spellEffects = [{ id: 'whispers', spell: 'Whispers', casterId: 'foe', kind: 'area', x: 1, y: 1, width: 4, height: 4, routeId: 'lower', rounds: 5, sourceType: 'monster' },
    { id: 'future-summon', spell: 'Conjuration', casterId: 'foe', targetId: 'ally', kind: 'summon' }];
  const before = JSON.stringify(state), descriptors = listMagicEffects(state);
  assert.equal(JSON.stringify(state), before); assert.equal(descriptors.length, 3);
  const whispers = find(state, 'whispers', 'whispers');
  assert.deepEqual([whispers.routeId, whispers.width, whispers.height, whispers.sourceType], ['lower', 4, 4, 'monster']);
  let callback;
  end(state, 'omens', 'foe', { onEffectEnd: (s, effect) => { assert.equal(s, state); callback = effect; } });
  assert.equal(callback.spell, 'omens'); assert.deepEqual(foe.spellEffects, []);
  assert.equal(state.spellEffects.length, 2); assert.equal(caster.focusSpell, undefined);
  end(state, 'conjuration', 'ally');
  assert.equal(state.characters.some(target => target.id === 'ally'), false);
  assert.deepEqual(state.spellEffects.map(effect => effect.id), ['whispers']);
});

test('target removals remain removed after normalize, serialization and hydration', () => {
  const { state, caster, ally } = scene();
  caster.wizardEffects = [{ type: 'mage-armor', rounds: 5 }];
  caster.transformationEffects = [{ spell: 'mirror image', rounds: 5 }];
  caster.invisibility = { source: 'spell', rounds: 5 };
  caster.gear = [{ name: 'Dagger', holyWeapon: { rounds: 5 } }];
  caster.conditions.sleeping = { source: 'sleep' };
  caster.raw = structuredClone({ ...caster, raw: undefined });
  ally.focusSpell = { id: 'hold', spell: 'hold person', tier: 2, targetIds: ['caster'] };
  held(caster, { hold: 'ally' });
  for (const spell of ['mage armor', 'mirror image', 'invisibility', 'holy weapon', 'hold person']) end(state, spell, 'caster');
  const normalized = normalizeCharacterState({ characters: [structuredClone(caster.raw)] }).characters[0];
  assert.deepEqual(normalized.wizardEffects, []); assert.deepEqual(normalized.transformationEffects, []);
  assert.ok(normalized.invisibility == null); assert.equal(normalized.gear[0].holyWeapon, undefined);
  assert.equal(normalized.conditions.paralyzed, undefined);
  const saved = serializeDungeonState(state), loaded = hydrateDungeonState(saved);
  cleanupWizardTierTwoFocus(loaded);
  assert.equal(listMagicEffects(loaded).length, 0);
  assert.equal(loaded.characters.find(target => target.id === 'caster').conditions.paralyzed, undefined);
});

test('source cleanup does not sweep unrelated incapacitated Focus or unrelated source conditions', () => {
  const { state, caster, ally, foe } = scene();
  const staleCaster = actor('stale', { hp: 0, focusSpell: { id: 'stale-focus', spell: 'hold person', tier: 2, targetIds: ['foe'] } });
  state.characters.push(staleCaster);
  caster.focusSpell = { id: 'focus', spell: 'hold person', tier: 2, targetIds: ['ally'] };
  held(ally, { focus: 'caster' }); held(foe, { 'stale-focus': 'stale' });
  const beforeCaster = structuredClone(staleCaster), beforeFoe = structuredClone(foe);
  end(state, 'hold person', 'ally');
  assert.equal(ally.conditions.paralyzed, undefined);
  assert.deepEqual(staleCaster, beforeCaster); assert.deepEqual(foe, beforeFoe);
});

test('monster gear uses holder ID, aliases only once, labels identical items, and keeps instance IDs on reorder', () => {
  const { state, foe } = scene();
  foe.gear = [{ name: 'Dagger', instanceId: 'one', holyWeapon: { rounds: 5 } },
    { name: 'Dagger', instanceId: 'two', holyWeapon: { rounds: 5 } }];
  foe.carriedGear = structuredClone(foe.gear);
  const before = listMagicEffects(state);
  assert.equal(before.length, 2); assert.ok(before.every(effect => effect.targetId === 'foe'));
  assert.deepEqual(before.map(effect => effect.name), ['Holy Weapon (Dagger #1)', 'Holy Weapon (Dagger #2)']);
  foe.gear.reverse();
  assert.deepEqual(listMagicEffects(state).map(effect => effect.id), before.map(effect => effect.id).reverse());
  endMagicEffect(state, before[0].id);
  assert.equal(foe.gear[1].holyWeapon, undefined); assert.ok(foe.gear[0].holyWeapon);
  assert.equal(foe.carriedGear, foe.gear);
});

test('save/load cannot restore dispelled Sleep, charm, areas, summons, or disc duration and retains item suppression', () => {
  const { state, caster, ally, foe } = scene();
  caster.conditions.sleeping = { source: 'sleep', casterId: 'foe' };
  caster.raw.conditions = structuredClone(caster.conditions);
  foe.charm = { casterId: 'caster', remainingMs: 5000 }; foe.raw.charm = structuredClone(foe.charm);
  state.areaSpells = [{ id: 'web', spell: 'web', x: 1, y: 1, width: 4, height: 4, rounds: 5 }];
  caster.gear = [{ name: '+1 Sword', magic: { kind: 'weapon', bonus: 1 } }];
  const disc = actor('disc', { hp: 0, summon: { kind: 'floating-disc', casterId: 'caster', remainingMs: 5000 }, gear: [{ name: 'Cargo' }] });
  const summon = actor('summon', { type: 'monster', summon: { spell: 'summon monster', casterId: 'caster' } });
  state.characters.push(disc); state.entities.push(summon);
  ally.spellEffects = [{ id: 'summon-record', kind: 'summon', spell: 'summon monster', casterId: 'caster', targetId: 'summon' }];
  ally.raw.spellEffects = structuredClone(ally.spellEffects);
  end(state, 'sleep', 'caster'); end(state, 'charm person', 'foe'); end(state, 'web', 'web');
  end(state, 'magic', 'caster'); end(state, 'floating disc', 'disc'); end(state, 'summon monster', 'summon');
  assert.deepEqual(ally.raw.spellEffects, []);
  const loaded = hydrateDungeonState(serializeDungeonState(state));
  assert.deepEqual(listMagicEffects(loaded), []);
  assert.equal(loaded.entities.some(entity => entity.id === 'summon'), false);
  const loadedDisc = loaded.characters.find(target => target.id === 'disc');
  assert.equal(loadedDisc.summon.remainingMs, 0); assert.equal(loadedDisc.gear[0].name, 'Cargo');
  const loadedCaster = loaded.characters.find(target => target.id === 'caster');
  assert.equal(isMagicSuppressed(loadedCaster.gear[0]), true);
  assert.equal(loadedCaster.conditions.sleeping, undefined); assert.deepEqual(loaded.areaSpells, []);
});
