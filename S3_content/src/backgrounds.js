import { SeededRng } from './rng.js';
import { buildGuardianPool, indefiniteArticle } from './creature-names.js';

export function backgroundKey(value) {
  const key = String(value || '').trim().toLowerCase();
  return key === 'minstrel' ? 'entertainer' : key === 'orphaned' ? 'orphan' : key;
}

export function canonicalBackground(value) {
  return backgroundKey(value) === 'entertainer' ? 'Entertainer' : String(value || '');
}

export function weightedBackgroundChoice(entries, random = Math.random) {
  const choices = entries.filter(entry => Number.isFinite(Number(entry.weight)) && Number(entry.weight) > 0);
  const total = choices.reduce((sum, entry) => sum + Number(entry.weight), 0);
  if (!total) return null;
  let roll = Math.min(1 - Number.EPSILON, Math.max(0, random())) * total;
  for (const entry of choices) {
    roll -= Number(entry.weight);
    if (roll < 0) return entry;
  }
  return choices.at(-1);
}

export function nobleName(baseName, title) {
  const name = String(baseName || '').trim();
  return title?.position === 'suffix' ? [name, title.joiner, title.text].filter(Boolean).join(' ')
    : [title?.text, name].filter(Boolean).join(' ');
}

function characterBackgroundRandom(character, purpose) {
  const identity = `${character.lineageId || character.id || character.name}|${purpose}`;
  let seed = 2166136261;
  for (const symbol of identity) seed = Math.imul(seed ^ symbol.codePointAt(0), 16777619) >>> 0;
  const rng = new SeededRng(seed);
  return () => rng.nextFloat();
}

function stripNobleTitle(name, title) {
  const decoration = title.position === 'suffix' ? [title.joiner, title.text].filter(Boolean).join(' ') : title.text;
  if (title.position === 'suffix' && name.endsWith(` ${decoration}`)) return name.slice(0, -decoration.length - 1);
  if (title.position === 'prefix' && name.startsWith(`${decoration} `)) return name.slice(decoration.length + 1);
  return name;
}

/** Assign once and persist; rendering and normalization never reroll a character's history. */
export function initializeCharacterBackground(character, { guardians = [], cultures = [], random } = {}) {
  if (!character || character.companion || character.summon || character.impersonation) return character;
  character.background = canonicalBackground(character.background);
  const key = backgroundKey(character.background);
  if (key === 'orphan' || key === 'noble') {
    character.backgroundDetails ||= { version: 1 };
    const details = character.backgroundDetails;
    if (key === 'orphan' && !details.guardian && guardians.length) {
      const roll = random || characterBackgroundRandom(character, 'guardian');
      const guardian = guardians[Math.min(guardians.length - 1, Math.floor(Math.max(0, roll()) * guardians.length))];
      details.guardian = { name: guardian.name, sourceName: guardian.sourceName, intelligence: guardian.intelligence };
    }
    if (key === 'noble' && !details.nobility && cultures.length) {
      const roll = random || characterBackgroundRandom(character, 'nobility');
      const culture = weightedBackgroundChoice(cultures, roll);
      const title = culture && weightedBackgroundChoice(culture.titles, roll);
      if (title) details.nobility = { culture: culture.name, ...title, baseName: character.name };
    }
    const title = details.nobility;
    if (key === 'noble' && title && character.name !== title.appliedName) {
      title.baseName = stripNobleTitle(String(character.name || title.baseName || '').trim(), title);
      character.name = nobleName(title.baseName, title);
      title.appliedName = character.name;
    }
  }
  character.raw ||= {};
  character.raw.name = character.name;
  character.raw.background = character.background;
  if (character.backgroundDetails) character.raw.backgroundDetails = structuredClone(character.backgroundDetails);
  return character;
}

export function orphanBackgroundLore(character) {
  if (backgroundKey(character?.background) !== 'orphan') return '';
  const guardian = character.backgroundDetails?.guardian || character.raw?.backgroundDetails?.guardian;
  return guardian?.name ? `You were raised by ${indefiniteArticle(guardian.name)} ${guardian.name}.` : '';
}

export function createBackgroundCatalog(monsters, data) {
  return { guardians: buildGuardianPool(monsters), cultures: data?.cultures || [] };
}
