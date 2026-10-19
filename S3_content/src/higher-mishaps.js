import { abilityScoreModifier, setCharacterHp } from './characters.js';
import { rollCheck, canMoveBetweenTiles } from './interactions.js';
import { castingBonus } from './spell-effects.js';
import { isFloatingDisc } from './floating-disc.js';
import { wakeCreature } from './conditions.js';
import { isMagicItem } from './magic-items.js';
import { forgottenSpells } from './arcane-effects.js';
import { applyFireToTreasure } from './fire-damage.js';
import { pitIsOpen, pitContains, resolvePitSave, openPit, pitCells } from './pits.js';
import { sameRoute, routeOf } from './underpasses.js';

export const HIGHER_MISHAPS = {
  3: ['', 'Devastation', 'Blast radius', 'Duplicate refraction', 'You flubbed the incantation', 'Ethereal bandersnatch',
    'Arcano-mutagenesis', 'Boom', 'Petrification', 'Stupefaction', 'It cannot be unseen', 'Radioactive energies', 'Uncontained channeling'],
  5: ['', 'Devastation', 'Pyroclastic extrusion', 'Astral incision', 'The grimlow', 'Dark plasma aura', 'Gate',
    'Runaway arcana loop', 'Arcane obstruction', 'What lurks beyond the veil', "Ord's balance", 'Unmitigated chain reaction', 'Shred']
};
const die = (sides, random) => Math.floor(random() * sides) + 1;
const pick = (items, random) => items.length ? items[die(items.length, random) - 1] : null;
const spellKey = name => String(name || '').trim().toLowerCase();
const distance = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
const living = creature => !isFloatingDisc(creature) && !creature.dead && !creature.slain && !creature.defeated && !creature.leftPeacefully && Number(creature.hp) > 0;
export const dungeonCreatures = state => [...(state.characters || []), ...(state.entities || []).filter(entity => entity.type === 'monster')].filter(living);

export function addArcaneEffect(caster, effect) {
  caster.wizardEffects ||= [];
  caster.wizardEffects.push(effect);
  return effect;
}

export function forgetSpell(caster, name) {
  const key = spellKey(name);
  caster.spellsKnown = String(caster.spellsKnown || '').split(/,\s*/).filter(spell => spellKey(spell) !== key).join(', ');
  caster.learnedScrollSpells = (caster.learnedScrollSpells || []).filter(spell => spellKey(spell) !== key);
  caster.bonuses = (caster.bonuses || []).filter(bonus => !(String(bonus.name).startsWith('Spell:') && spellKey(bonus.bonusName) === key));
  if (!forgottenSpells(caster).has(key)) addArcaneEffect(caster, { type: 'forgotten-spell', spell: key });
  caster.raw ||= {};
  for (const field of ['spellsKnown', 'learnedScrollSpells', 'bonuses', 'wizardEffects']) caster.raw[field] = structuredClone(caster[field]);
  return `${caster.name} permanently forgets ${name}.`;
}

function removeGear(caster, count, random) {
  const removed = [];
  for (let index = 0; index < count; index++) {
    const item = pick((caster.gear || []).filter(item => Number(item.totalUnits ?? item.quantity ?? 1) > 0), random);
    if (!item) break;
    removed.push(item.name);
    const units = Number(item.totalUnits ?? item.quantity ?? 1);
    if (units > 1) { item.quantity = item.totalUnits = units - 1; item.lit = false; item.equipped = false; }
    else caster.gear.splice(caster.gear.indexOf(item), 1);
  }
  return removed;
}

function damageCreature(state, target, damage, caster, source = null) {
  state.lastDamageSourceId = caster.id;
  if ((state.characters || []).includes(target)) setCharacterHp(target, Number(target.hp) - damage, { sourceId: caster.id, damageSource: source });
  else { target.hp = Math.max(0, Number(target.hp) - damage); wakeCreature(target, state); }
}

function createPhenomenon(state, caster, subtype, fields) {
  const entity = { id: `${subtype}-${Date.now()}-${state.entities.length}`, type: 'feature', subtype,
    x: Number(caster.x), y: Number(caster.y), routeId: routeOf(state, caster), roomId: caster.roomId, casterId: caster.id, revealed: true, visible: true, ...fields };
  state.entities.push(entity);
  return entity;
}

export function checkSinkholeFall(state, creature, { random = Math.random, queueFall } = {}) {
  const pit = (state.entities || []).find(entity => pitIsOpen(entity) && sameRoute(state, entity, creature) && pitContains(entity, creature.x, creature.y) && creature.conditions?.pitLedge !== entity.id);
  if (!pit) return null;
  return resolvePitSave(state, pit, creature, { random, queueFall, check: rollCheck,
    canStep: (x, y, nx, ny) => canMoveBetweenTiles(state, x, y, nx, ny, { ignorePits: true }).ok });
}

export function queueForcedSpell(state, caster, spell, targets, context = {}) {
  const event = { id: `forced-spell-${Date.now()}-${(state.arcaneSpellEvents || []).length}`, casterId: caster.id,
    spell, targetIds: targets.map(target => target.id), forced: true, resolved: false };
  const resolution = context.resolveForcedSpell?.(caster, spell, targets);
  if (resolution) { event.resolved = true; event.detail = resolution; }
  state.arcaneSpellEvents ||= []; state.arcaneSpellEvents.push(event);
  state.arcaneSpellEvents = state.arcaneSpellEvents.slice(-50);
  return event.detail || `${spell} targets ${targets.map(target => target.name).join(', ') || 'no creatures'}; this spell's effect is not implemented yet.`;
}

export function applyHigherMishap(state, caster, spell, number, context = {}) {
  const { random = Math.random, tier = 3, knownSpells = [], spellTier = () => 1, canSee = () => true } = context;
  const table = tier >= 5 ? 5 : 3;
  const result = { roll: number, tier, name: HIGHER_MISHAPS[table][number] };
  const near = () => dungeonCreatures(state).filter(creature => distance(caster, creature) <= 6 && (context.lineOfEffect || canSee)(caster, creature));
  const check = (stat, dc) => {
    const roll = rollCheck(abilityScoreModifier(caster.stats?.[stat]));
    result.check = { ...roll, stat, dc }; return roll.total >= dc;
  };
  if (table === 3) switch (number) {
    case 2: {
      result.rolls = [die(6, random), die(6, random)]; result.damage = result.rolls.reduce((a, b) => a + b, 0);
      result.hits = near().map(target => { damageCreature(state, target, result.damage, caster); return { id: target.id, type: target.type || 'character', defeated: target.hp <= 0 }; });
      result.detail = `All nearby creatures take ${result.damage} damage (2d6).`; break;
    }
    case 3: {
      const ally = (state.characters || []).filter(target => target.id !== caster.id && living(target)).sort((a, b) => distance(caster, a) - distance(caster, b))[0];
      result.detail = [caster, ...(ally ? [ally] : [])].map(target => queueForcedSpell(state, caster, spell, [target], context)).join(' '); break;
    }
    case 4: {
      const replacement = pick(knownSpells, random);
      result.detail = replacement ? queueForcedSpell(state, caster, replacement, context.targets?.length ? context.targets : [caster], context) : 'No known spell can be substituted.'; break;
    }
    case 5:
      result.removed = removeGear(caster, 2, random); result.detail = `${result.removed.join(' and ') || 'No gear'} disappears.`; break;
    case 6:
      if (!check('CON', 12)) {
        const stat = pick(['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'], random);
        const previous = caster.wizardEffects?.find(effect => effect.type === 'stat-collapse' && effect.stat === stat);
        if (!previous) addArcaneEffect(caster, { type: 'stat-collapse', stat, original: caster.stats[stat], untilRest: true });
        else previous.original += caster.stats[stat] - 3;
        caster.stats[stat] = 3; caster.raw ||= {}; caster.raw.stats = structuredClone(caster.stats);
        result.detail = `${stat} drops to 3 (-4) until a successful rest.`;
      } else result.detail = 'CON DC 12 passed; no stat is lost.';
      break;
    case 7: {
      const pit = createPhenomenon(state, caster, 'arcane-sinkhole', { name: 'Sinkhole', radius: 6, depthFeet: 30 });
      pit.cells = pitCells(state, pit).filter(cell => (context.lineOfEffect || canSee)(caster, cell));
      result.falls = openPit(state, pit, { random, queueFall: context.queueFall, check: rollCheck,
        canStep: (x, y, nx, ny) => canMoveBetweenTiles(state, x, y, nx, ny, { ignorePits: true }).ok }).filter(fall => !fall.passed);
      result.hits = result.falls.map(fall => {
        const monster = state.entities.find(entity => entity.id === fall.id && entity.type === 'monster');
        return { id: fall.id, type: monster ? 'monster' : 'character', defeated: Boolean(monster && monster.hp <= 0) };
      });
      result.detail = `A 30-foot sinkhole opens. ${result.falls.length} creatures fall; DC 15 STR and an action are required to climb out.`; break;
    }
    case 8: {
      const limbs = ['left arm', 'right arm', 'left leg', 'right leg'], count = die(4, random), selected = [];
      for (let index = 0; index < count; index++) selected.push(limbs.splice(die(limbs.length, random) - 1, 1)[0]);
      addArcaneEffect(caster, { type: 'petrified-limbs', limbs: selected, remainingMs: 86400000 });
      result.detail = `Petrified for 24 hours: ${selected.join(', ')}.`; break;
    }
    case 9:
      addArcaneEffect(caster, { type: 'spell-tier-ban', tier, untilRest: true }); result.detail = `Tier ${tier} spells are unavailable until a successful rest.`; break;
    case 10:
      if (!check('WIS', 12)) { const rounds = die(10, random); addArcaneEffect(caster, { type: 'raving', rounds }); caster.focusSpell = null; result.detail = `Mad raving for ${rounds} rounds; no movement, actions or Focus.`; }
      else result.detail = 'WIS DC 12 passed; no raving.'; break;
    case 11:
      addArcaneEffect(caster, { type: 'radioactive', rounds: die(4, random) }); result.detail = 'Visible enemies turn their hostility and attacks toward the caster.'; break;
    case 12:
      addArcaneEffect(caster, { type: 'unstable', rounds: 10, maxTier: tier }); result.detail = `Disadvantage on tier ${tier} and lower spells for 10 rounds.`; break;
  }
  else switch (number) {
    case 2: {
      result.rolls = [die(8, random), die(8, random), die(8, random)]; result.damage = result.rolls.reduce((a, b) => a + b, 0);
      result.hits = near().map(target => { damageCreature(state, target, result.damage, caster, 'fire'); return { id: target.id, type: target.type || 'character', defeated: target.hp <= 0 }; });
      result.damagedTreasure = (state.entities || []).filter(entity => distance(caster, entity) <= 6 && (context.lineOfEffect || canSee)(caster, entity)).map(applyFireToTreasure).filter(Boolean);
      result.detail = `All nearby creatures take ${result.damage} fire damage (3d8), before resistance.${result.damagedTreasure.length ? ' ' + result.damagedTreasure.join(' ') : ''}`; break;
    }
    case 3: {
      const lost = pick(knownSpells, random); result.detail = lost ? forgetSpell(caster, lost) : 'There is no known spell to forget.'; break;
    }
    case 4:
      result.rounds = die(4, random) + die(4, random);
      result.detail = context.summon?.(caster, { name: 'Grimlow', rounds: result.rounds }) || 'No free nearby floor can hold the Grimlow.'; break;
    case 5:
      result.rounds = die(6, random) + die(6, random); addArcaneEffect(caster, { type: 'dark-plasma', rounds: result.rounds });
      result.detail = `Attacks deal double damage to the caster for ${result.rounds} rounds.`; break;
    case 6: {
      const gate = createPhenomenon(state, caster, 'arcane-gate', { name: 'Gate', rounds: die(4, random) });
      result.detail = `A Gate opens; a dungeon-level-8+ monster arrives in ${gate.rounds} rounds unless the caster closes it with a DC 18 INT action.`; break;
    }
    case 7: {
      const target = pick(dungeonCreatures(state).filter(target => canSee(caster, target)), random);
      result.detail = target ? queueForcedSpell(state, caster, spell, [target], context) : 'No creature can be seen by the runaway spell.';
      addArcaneEffect(caster, { type: 'arcana-loop', spell, tier, lastTurnKey: context.turnKey }); break;
    }
    case 8:
      result.blockedTier = die(5, random); addArcaneEffect(caster, { type: 'spell-tier-ban', tier: result.blockedTier, untilRest: true });
      result.detail = `Tier ${result.blockedTier} spells are unavailable until a successful rest.`; break;
    case 9:
      if (!check('WIS', 15)) { const hours = die(4, random); addArcaneEffect(caster, { type: 'raving', remainingMs: hours * 3600000 }); caster.focusSpell = null; result.detail = `Mad raving for ${hours} game hours.`; }
      else result.detail = 'WIS DC 15 passed; no raving.'; break;
    case 10:
      addArcaneEffect(caster, { type: 'ord-balance', pending: true }); result.detail = 'Choose a magic item or known tier-3+ spell to sacrifice permanently; if none qualify, sacrifice a highest-tier known spell.'; break;
    case 11:
      addArcaneEffect(caster, { type: 'unstable', rounds: 10, maxTier: 5 }); result.detail = 'Disadvantage on all spellcasting for 10 rounds.'; break;
    case 12:
      createPhenomenon(state, caster, 'arcane-shred', { name: 'Shred', radius: .27 });
      result.detail = 'A black Shred opens beneath the caster and grows one square in radius each round. Only party tokens remain visible inside it.'; break;
  }
  return result;
}

export function ordBalanceOptions(caster, spellTier) {
  const items = (caster.gear || []).flatMap((item, index) => isMagicItem(item) ? [{ kind: 'item', index, name: item.name }] : []);
  const spells = String(caster.spellsKnown || '').split(/,\s*/).filter(name => name && !/^none$/i.test(name));
  const high = spells.filter(name => spellTier(name) >= 3);
  const eligible = items.length || high.length ? high : spells.filter(name => spellTier(name) === Math.max(0, ...spells.map(spellTier)));
  return [...items, ...eligible.map(name => ({ kind: 'spell', name }))];
}

export function resolveOrdBalance(caster, choice, spellTier) {
  const effect = caster.wizardEffects?.find(effect => effect.type === 'ord-balance' && effect.pending);
  const option = ordBalanceOptions(caster, spellTier).find(option => option.kind === choice.kind && option.name === choice.name && (option.kind !== 'item' || option.index === choice.index));
  if (!effect || !option) throw new Error('Choose an available magic item or spell to sacrifice.');
  let message;
  if (option.kind === 'spell') message = forgetSpell(caster, option.name);
  else {
    const item = caster.gear[option.index], count = Math.max(1, Number(item.totalUnits ?? item.quantity) || 1);
    if (count > 1) item.quantity = item.totalUnits = count - 1;
    else caster.gear.splice(option.index, 1);
    message = `${caster.name} permanently sacrifices ${option.name}.`;
  }
  effect.pending = false;
  return message;
}

export function processArcanaLoop(state, caster, context = {}) {
  const { random = Math.random, canSee = () => true } = context;
  const messages = [];
  for (const effect of [...(caster.wizardEffects || [])].filter(effect => effect.type === 'arcana-loop')) {
    if (context.turnKey && effect.lastTurnKey === context.turnKey) continue;
    effect.lastTurnKey = context.turnKey;
    const check = rollCheck(abilityScoreModifier(caster.stats?.INT) + castingBonus(caster, 'wizard'), context.castingMode?.(effect.tier) || {});
    if (check.roll !== 1 && (check.roll === 20 || check.total >= 10 + effect.tier)) {
      caster.wizardEffects.splice(caster.wizardEffects.indexOf(effect), 1); messages.push(`Runaway arcana check ${check.total}: loop ends.`);
    } else {
      const target = pick(dungeonCreatures(state).filter(target => canSee(caster, target)), random);
      messages.push(`Runaway arcana check ${check.total}: ${target ? queueForcedSpell(state, caster, effect.spell, [target], context) : 'no visible target'}`);
    }
  }
  return messages.join(' ');
}

export function advanceArcanePhenomena(state, rounds, context = {}) {
  let changed = false;
  for (const entity of [...(state.entities || [])]) {
    if (entity.subtype === 'arcane-shred') {
      const radius = Math.min(Math.hypot(state.map.width, state.map.height) + 1, entity.radius + rounds);
      changed ||= radius !== entity.radius; entity.radius = radius;
    }
    if (entity.subtype === 'arcane-gate' && !entity.closed && entity.rounds > 0) {
      entity.rounds = Math.max(0, entity.rounds - rounds); changed ||= rounds > 0;
      if (entity.rounds === 0) {
        entity.message = context.summon?.(entity, { minimumLevel: 8 }) || 'No free nearby floor can hold the Gate creature.';
        // A crowded arrival retries when a floor square becomes available.
        if (entity.message.startsWith('No free')) entity.rounds = 1;
        else entity.closed = true;
      }
    }
    if (entity.arcaneSummonRounds > 0) {
      entity.arcaneSummonRounds -= rounds; changed ||= rounds > 0;
      if (entity.arcaneSummonRounds <= 0 && state.entities.includes(entity)) state.entities.splice(state.entities.indexOf(entity), 1);
    }
  }
  return changed;
}
