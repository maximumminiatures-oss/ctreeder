import test from 'node:test';
import assert from 'node:assert/strict';
import { advancementButtonLabel, initializeImportChoices, awardExperience, canLevelUp, beginLevelUp, resolveAdvancement, advancementOptions, classAttackBonus, classArmorBonus, xpTarget } from '../../S3_content/src/class-progression.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';
import { serializeDungeonState, hydrateDungeonState } from '../../S3_content/src/persistence.js';
import { castingBonus } from '../../S3_content/src/spell-effects.js';
import fs from 'node:fs';

const spells = [1,2,3,4,5].flatMap(tier => JSON.parse(fs.readFileSync(new URL(`../../S3_content/spells/tier-${tier}.json`, import.meta.url))));
function hero(className = 'Fighter') {
  return { id:'a', name:'A', className, ancestry:'Human', alignment:'Lawful', level:1, XP:0, hp:6, maxHitPoints:6,
    stats:{ STR:12, DEX:12, CON:12, INT:12, WIS:12, CHA:12 }, gear:[], gearSlotsTotal:13, bonuses:[], levels:[], raw:{}, spellsKnown:'Light, Cure Wounds' };
}
const sequence = (...values) => { let i=0; return () => values[Math.min(i++, values.length-1)]; };
const earnLevel = (character, xp, random=()=>.5) => { awardExperience(character,xp); return beginLevelUp(character,{random}); };

test('unfinished spells never appear in advancement choices or resolve through direct commands', () => {
  const character = hero('Wizard'); character.level = 4;
  const event = earnLevel(character, 40);
  const task = event.tasks.find(task => task.type === 'spell');
  const names = advancementOptions(character, event, task, { spells }).map(option => option.value);
  assert.ok(names.includes('Protection From Energy'));
  for (const name of ['Fabricate', 'Sending']) {
    assert.ok(!names.includes(name));
    assert.throws(() => resolveAdvancement(character, event.id, task.id, name, { spells }), /valid pending/);
  }
});

test('XP waits for Level Up, then consumes current-level threshold and preserves overflow',()=>{
  const character=hero();assert.equal(awardExperience(character,12),true);
  assert.equal(character.level,1);assert.equal(character.maxHitPoints,6);assert.equal(canLevelUp(character),true);
  const event=beginLevelUp(character,{random:()=>.5});
  assert.equal(character.level,2);assert.equal(character.XP,2);assert.equal(xpTarget(character),20);
  assert.equal(character.maxHitPoints,12);assert.equal(character.hp,12);assert.equal(event.hpGain,6);
  assert.equal(event.completed,true);assert.equal(character.raw.xpNext,20);
  assert.throws(()=>beginLevelUp(character),/no new level/);
});

test('several earned levels are claimed individually, with titles and talents on odd levels only',()=>{
  const character=hero();awardExperience(character,105);
  const levels=[];
  while(canLevelUp(character)) {
    const event=beginLevelUp(character,{random:()=>.5});levels.push(event);
    if(!event.completed) {
      assert.throws(()=>beginLevelUp(character),/Finish any pending/);
      resolveAdvancement(character,event.id,'talent',event.level===3?'STR':'DEX');
    }
  }
  assert.equal(character.level,5);assert.equal(character.XP,5);assert.equal(character.title,'Knight');
  assert.deepEqual(levels.filter(event=>event.talentRoll).map(event=>event.level),[3,5]);
  assert.equal(character.stats.STR,14);assert.equal(character.stats.DEX,14);
  assert.throws(()=>resolveAdvancement(character,'level-3','talent','STR'),/valid pending/);
});

test('dwarves roll twice for HP; minimum gain is one; level ten preserves extra XP',()=>{
  const character=hero();character.ancestry='Dwarf';
  earnLevel(character,10,sequence(0,.99));assert.equal(character.maxHitPoints,15);assert.deepEqual(character.advancements[0].hpRolls,[1,8]);
  const frail=hero();frail.stats.CON=3;earnLevel(frail,10,()=>0);assert.equal(frail.maxHitPoints,7);
  const capped=hero();capped.level=10;awardExperience(capped,1000);assert.equal(capped.XP,1000);assert.equal(canLevelUp(capped),false);
});

test('priests gain exactly one tier-one spell at level two without counting Turn Undead',()=>{
  const character=hero('Priest');
  character.spellsKnown = 'Turn Undead, Light, Cure Wounds';
  const event=earnLevel(character,12);
  assert.equal(event.tasks.length,1);
  for(const task of event.tasks) {
    const choices=advancementOptions(character,event,task,{spells});
    assert.ok(!choices.some(option=>['Turn Undead','Light','Cure Wounds','Magic Missile'].includes(option.value)));
    resolveAdvancement(character,event.id,task.id,choices[0].value,{spells});
  }
  const known = character.spellsKnown.split(', ');
  assert.equal(known.length,4);assert.equal(known.filter(name=>name!=='Turn Undead').length,3);
  assert.equal(event.completed,true);
  assert.throws(()=>resolveAdvancement(character,event.id,'spell','Light',{spells}),/valid pending/);
});

test('wizard and priest new spell tasks use exactly the requested tier at each level',()=>{
  for(const className of ['Wizard','Priest'])for(let level=2;level<=10;level++) {
    const character=hero(className);character.level=level-1;character.XP=xpTarget(character);
    const event=beginLevelUp(character,{random:()=>.5});
    const tasks=event.tasks.filter(task=>task.type==='spell');assert.equal(tasks.length, className === 'Wizard' && level === 2 ? 2 : 1);
    for(const task of tasks) {
      assert.equal(task.tier,Math.floor((level+1)/2));
      for(const option of advancementOptions(character,event,task,{spells}))assert.equal(spells.find(spell=>spell.name===option.value).tier,task.tier);
    }
  }
});

test('attack/armor talents stack; class-stat choices increase carrying capacity and new-level HP',()=>{
  const character=hero();character.level=2;
  earnLevel(character,20,sequence(.5,.25,.25));assert.equal(classAttackBonus(character,true),1);assert.equal(classAttackBonus(character,false),1);
  character.level=4;earnLevel(character,40,sequence(.5,.8,.8));resolveAdvancement(character,'level-5','talent','Shield');assert.equal(classArmorBonus(character,'shield'),1);
  const con=hero();con.level=2;con.stats.CON=11;const event=earnLevel(con,20);const before=con.maxHitPoints;
  resolveAdvancement(con,event.id,'talent','CON');assert.equal(con.maxHitPoints,before+1);assert.equal(event.hpGain,6);
  assert.equal(con.gearSlotsTotal,14);
});

test('spell-advantage talent does not accidentally add a numerical spellcasting bonus',()=>{
  const wizard=hero('Wizard');wizard.level=2;wizard.spellsKnown='Alarm';
  const event=earnLevel(wizard,20,sequence(.5,.5,.65));
  assert.equal(event.tasks[0].type,'spell-advantage');resolveAdvancement(wizard,event.id,'talent','Alarm',{spells});
  assert.equal(castingBonus(wizard,'wizard'),0);
});

test('pending choices and large HP/XP survive normalization and save/load without rerolling',()=>{
  const character=hero('Wizard');character.maxHitPoints=130;character.hp=130;earnLevel(character,15);
  const state={characters:[character],activeCharacterId:'a',map:{width:1,height:1},tiles:[],entities:[],rooms:[],player:{},visibility:{}};
  normalizeCharacterState(state);const restored=hydrateDungeonState(serializeDungeonState(state)).characters[0];
  assert.equal(restored.maxHitPoints,134);assert.equal(restored.XP,5);assert.equal(restored.advancements[0].tasks[0].tier,1);
  assert.throws(()=>beginLevelUp(restored),/no new level/);
  resolveAdvancement(restored,'level-2','spell','Alarm',{spells});assert.ok(restored.spellsKnown.includes('Alarm'));
});

test('caster labels count the unfinished spell and talent choices independently', () => {
  for (const className of ['Priest', 'Wizard']) {
    for (const initial of [true, false]) {
      const tasks = ['spell', 'extra-spell', 'stat', 'spell-advantage'].map(type => ({ type }));
      const event = { initial, tasks };
      const character = { className, advancements: [event] };
      const cases = [
        [[], 'Pick Spells + Talents'], [[0], 'Pick Spell + Talents'],
        [[2], 'Pick Spells + Talent'], [[0, 2], 'Pick Spell + Talent'],
        [[2, 3], 'Pick Spells'], [[0, 2, 3], 'Pick Spell'],
        [[0, 1], 'Pick Talents'], [[0, 1, 2], 'Pick Talent'],
        [[0, 1, 2, 3], 'Level Up']
      ];
      for (const [done, expected] of cases) {
        tasks.forEach((task, index) => task.done = done.includes(index));
        event.completed = tasks.every(task => task.done);
        assert.equal(advancementButtonLabel(character), expected);
      }
    }
  }
});

test('Magic Missile is excluded from the Wizard spell-advantage talent and remains learnable', () => {
  const wizard = hero('Wizard');
  wizard.level = 2;
  wizard.spellsKnown = 'Alarm, Magic Missile';
  const event = earnLevel(wizard, 20, sequence(.5, .5, .65));
  const talent = event.tasks.find(task => task.type === 'spell-advantage');
  assert.ok(advancementOptions(wizard, event, talent, { spells }).some(option => option.value === 'Alarm'));
  assert.ok(!advancementOptions(wizard, event, talent, { spells }).some(option => option.value === 'Magic Missile'));
  assert.throws(() => resolveAdvancement(wizard, event.id, talent.id, 'Magic Missile', { spells }), /valid pending/);
  wizard.spellsKnown = 'Alarm';
  assert.ok(advancementOptions(wizard, event, { type: 'spell', tier: 1 }, { spells }).some(option => option.value === 'Magic Missile'));
});

test('a Wizard can defer level choices and later spend four tier-one and two tier-two picks', () => {
  const wizard = hero('Wizard');
  wizard.ancestry = 'Elf';
  initializeImportChoices(wizard, { random: () => .2 });
  for (const xp of [10, 20, 30]) earnLevel(wizard, xp, () => .2);
  const tasks = wizard.advancements.flatMap(event => event.tasks.filter(task => task.type === 'spell').map(task => [event, task]));
  assert.deepEqual(tasks.map(([, task]) => task.tier), [1, 1, 1, 1, 2, 2]);
  assert.throws(() => resolveAdvancement(wizard, tasks[0][0].id, tasks[0][1].id, 'Acid Arrow', { spells }), /pending/);
  wizard.learnedScrollSpells = ['Levitate'];
  for (const [index, name] of ['Magic Missile','Mage Armor','Burning Hands','Detect Magic','Web','Acid Arrow'].entries()) {
    const [event, task] = tasks[index];
    resolveAdvancement(wizard, event.id, task.id, name, { spells });
  }
  assert.deepEqual(wizard.learnedScrollSpells, ['Levitate']);
  assert.ok(tasks.every(([, task]) => task.done));
});

test('level-zero HP and gear persist and a dwarf replaces HP when picking a class at 3 XP', () => {
  const character = { ...hero('Level 0'), ancestry: 'Dwarf', level: 0, stats: { CON: 12 }, raw: {} };
  const rng = sequence(0, .28);
  initializeImportChoices(character, { random: rng });
  assert.equal(character.hp, 1);
  assert.deepEqual(character.gear.map(item => [item.name, item.quantity]), [['Arrows', 5], ['Shortbow', 1]]);
  normalizeCharacterState({ characters: [character] });
  resolveAdvancement(character, 'choose-alignment', 'alignment', 'Neutral');
  awardExperience(character, 3);
  const event = beginLevelUp(character);
  resolveAdvancement(character, event.id, 'class', 'Fighter', { random: sequence(.2, .8, .2, .2) });
  assert.equal(character.level, 1);
  assert.equal(character.className, 'Fighter');
  assert.equal(character.hp, 10);
  assert.equal(character.maxHitPoints, 10);
  assert.equal(character.XP, 0);
  assert.ok(character.advancements.find(entry => entry.id === 'initial').tasks.some(task => task.id === 'talent'));
});
