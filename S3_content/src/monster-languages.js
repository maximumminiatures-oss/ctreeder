export const MONSTER_LANGUAGES = Object.freeze([
  'Common', 'Dwarvish', 'Elvish', 'Giant', 'Goblin', 'Merran', 'Orcish',
  'Reptilian', 'Sylvan', 'Thanian', 'Celestial', 'Diabolic', 'Draconic', 'Primordial'
]);

const normalizedName = creature => String(creature?.name || '').toLowerCase()
  .replace(/[\u2018\u2019']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const RULES = [
  ['Dwarvish', /\b(?:duergar|azer)\b/],
  ['Elvish', /\b(?:elf|elves|drow|fairy|fairies|faerie\w*)\b/],
  ['Giant', /\b(?:giants?|ogres?|trolls?|cyclops|oni)\b/],
  ['Goblin', /\b(?:bugbears?|goblins?|hobgoblins?|worgs?)\b/],
  ['Merran', /\b(?:merfolk|sahuagin|sirens?|deep ones?)\b/],
  ['Orcish', /\borcs?\b/],
  ['Reptilian', /\b(?:lizardfolk|viperian\w*|kobolds?|nagas?|salamanders?)\b/],
  ['Sylvan', /\b(?:centaurs?|dryads?|fairy|fairies|faerie\w*|leprechauns?|ettercaps?|gnome deep|deep gnome|hags?|treants?|unicorns?|will o wisp\w*)\b/],
  ['Thanian', /\b(?:minotaurs?|beastm[ae]n|manticores?|gorgons?|harp(?:y|ies)|medusa\w*|phoenix|sphinx\w*|stranglers?)\b/],
  ['Celestial', /\b(?:angels?|archangels?)\b/],
  ['Diabolic', /\b(?:demons?|fiends?|(?:arch)?devils?|hell hounds?|nightmares?|oni|rakshasa\w*)\b/],
  ['Draconic', /\b(?:dragons?|cou?atls?|hydras?|wyverns?)\b/],
  ['Primordial', /\b(?:elder things?|elementals?|azer|cloakers?|chuuls?|brain eaters?|djinni|efreeti|gargoyles?|invisible stalkers?|krakens?|rime walkers?|void spawn|ropers?)\b/],
  ['Common', /\b(?:apprentice\w*|archmagi|archmages?|bandits?|assassins?|berserkers?|cultists?|dopp?elgangers?|druids?|ghosts?|ghasts?|ghouls?|golems?|guards?|knights?|mages?|mumm(?:y|ies)|peasants?|pirates?|priests?|reavers?|scarecrows?|shadows?|skeletons?|soldiers?|thugs?|thieves|thief|vampire\w*|werewolves|werewolf|wererats?|wights?|wraiths?|zombies?)\b/]
];
const NO_AUTOMATIC_LANGUAGE = /\b(?:gray ooze|grey ooze|grick|griffon|grimlow|ochre jelly|stingbat|ankheg|animated armor|basilisk|black pudding|cave brute|bulette|cave creeper|chimera|cockatrice|darkmantle|gelatinous cube|otyugh|primordial slime|owlbear|purple worm|remorhaz|roc|rot flower|rust monster|shambling mound)\b/;
const ANIMALS = /\b(?:dinosaur\w*|allosaurus|ankylosaurus|brachiosaurus|pterodactyl|stegosaurus|triceratops|tyrannosaurus|velociraptor|panthers?|pegasus|scorpions?|smilodon|vultures?|wolves|wolf|wasps?|sharks?|snakes?|crocodiles?|piranhas?|scarabs?|crabs?|centipedes?|apes?|camels?|leech(?:es)?|mastiffs?|mammoths?|moose|manta ray|rhinoceros|badgers?|hippopotamus|lions?|bears?|bats?|jellyfish|boars?|hippogriffs?|dung beetles?|elephants?|rats?|frogs?|gorillas?|horses?|octopus|spiders?)\b/;

export const isTelepathicMonster = creature => /\b(?:aboleths?|brain eaters?|mushroomfolk)\b/.test(normalizedName(creature));
export const isAnimalMonsterName = creature => ANIMALS.test(normalizedName(creature)) &&
  !/\b(?:void spider|wererat|werewolf|owlbear|bugbear|viperian)\b/.test(normalizedName(creature));

export function normalizeLanguages(value) {
  const names = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  const result = [];
  for (const name of names) {
    const text = String(name).trim();
    if (!text || /^(?:none|no languages?|-)$/i.test(text)) continue;
    const canonical = /^angelic$/i.test(text) ? 'Celestial' :
      MONSTER_LANGUAGES.find(language => language.toLowerCase() === text.toLowerCase()) || text;
    if (!result.some(language => language.toLowerCase() === canonical.toLowerCase())) result.push(canonical);
  }
  return result;
}

export function automaticMonsterLanguages(monster) {
  if (isTelepathicMonster(monster)) return [...MONSTER_LANGUAGES];
  const name = normalizedName(monster);
  if (NO_AUTOMATIC_LANGUAGE.test(name) || isAnimalMonsterName(monster)) return [];
  return RULES.filter(([, pattern]) => pattern.test(name)).map(([language]) => language);
}

function seededRandom(monster, seed) {
  let hash = 2166136261;
  const identity = JSON.stringify([seed ?? '', monster.id ?? '', monster.name ?? '', monster.I ?? monster['**I**'] ?? 0]);
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return () => {
    hash = (hash + 0x6D2B79F5) | 0;
    let n = Math.imul(hash ^ hash >>> 15, 1 | hash);
    n ^= n + Math.imul(n ^ n >>> 7, 61 | n);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

// Persist once on the entity: a save/load or repeated reaction check must not reroll languages.
export function ensureMonsterLanguages(monster, { random, seed } = {}) {
  if (!monster) return [];
  if (isTelepathicMonster(monster)) {
    monster.languages = [...MONSTER_LANGUAGES];
  } else if (monster.languages !== undefined && monster.languages !== null) {
    monster.languages = normalizeLanguages(monster.languages);
  } else if (monster.raw?.languages !== undefined && monster.raw.languages !== null) {
    monster.languages = normalizeLanguages(monster.raw.languages);
  } else {
    const languages = automaticMonsterLanguages(monster);
    const draw = random || seededRandom(monster, seed);
    const count = Math.max(0, Math.floor(Number(monster.I ?? monster['**I**']) || 0));
    for (let i = 0; i < count && languages.length < MONSTER_LANGUAGES.length; i++) {
      const available = MONSTER_LANGUAGES.filter(language => !languages.includes(language));
      const roll = Math.min(1 - Number.EPSILON, Math.max(0, Number(draw()) || 0));
      const hasCommon = languages.includes('Common');
      const pool = hasCommon ? available : available.filter(language => language !== 'Common');
      languages.push(!hasCommon && (roll < .25 || !pool.length) ? 'Common' :
        pool[Math.min(pool.length - 1, Math.floor((hasCommon ? roll : (roll - .25) / .75) * pool.length))]);
    }
    monster.languages = languages;
  }
  monster.languageAssignmentVersion = 1;
  return monster.languages;
}

export function initializeMonsterLanguages(state) {
  for (const monster of state.entities || []) if (monster.type === 'monster') ensureMonsterLanguages(monster, { seed: state.seed });
  return state;
}
