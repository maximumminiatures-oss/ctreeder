import test from 'node:test';
import assert from 'node:assert/strict';
import { awardExperience, canLevelUp, beginLevelUp, resolveAdvancement, advancementOptions, classAttackBonus, classArmorBonus, xpTarget } from '../../S3_content/src/class-progression.js';
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

test('priests have four tier-one spells at level two, not counting Turn Undead',()=>{
  const character=hero('Priest'),event=earnLevel(character,12);
  assert.equal(event.tasks.length,2);
  for(const task of event.tasks) {
    const choices=advancementOptions(character,event,task,{spells});
    assert.ok(!choices.some(option=>['Turn Undead','Light','Magic Missile'].includes(option.value)));
    resolveAdvancement(character,event.id,task.id,choices[0].value,{spells});
  }
  assert.equal(character.spellsKnown.split(', ').length,4);assert.equal(event.completed,true);
  assert.throws(()=>resolveAdvancement(character,event.id,'spell','Light',{spells}),/valid pending/);
});

test('wizard and priest new spell tasks use exactly the requested tier at each level',()=>{
  for(const className of ['Wizard','Priest'])for(let level=2;level<=10;level++) {
    const character=hero(className);character.level=level-1;character.XP=xpTarget(character);
    const event=beginLevelUp(character,{random:()=>.5});
    const tasks=event.tasks.filter(task=>task.type==='spell');assert.equal(tasks.length,className==='Priest'&&level===2?2:1);
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
