import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { initializeImportChoices, advancementOptions, resolveAdvancement, beginLevelUp, hasGrit, classArmorBonus } from '../../S3_content/src/class-progression.js';
import { backstabMultiplier, unawareReason } from '../../S3_content/src/backstab.js';
import { createTalentMagicItem } from '../../S3_content/src/talent-magic.js';
import { elementalDamage, elementalSaveOptions } from '../../S3_content/src/elemental-effects.js';
import { attackRollSegments } from '../../S3_content/src/combat-rules.js';
import { setCharacterHp } from '../../S3_content/src/characters.js';

const read = path => JSON.parse(fs.readFileSync(new URL(`../../S3_content/${path}`, import.meta.url)));
const rules=read('data/rules-data.json'), spells=[1,2,3,4,5].flatMap(tier=>read(`spells/tier-${tier}.json`));
const hero = className => ({id:'hero',name:'Hero',className,level:1,XP:0,hp:10,maxHitPoints:10,stats:{STR:14,DEX:18,CON:10,INT:12,WIS:12,CHA:8},gear:[],gearSlotsTotal:14,
  spellsKnown:'Sleep, Magic Missile, Light',levels:[],bonuses:[],raw:{}});
const sequence=(...values)=>{let i=0;return()=>values[Math.min(i++,values.length-1)];};

test('fresh casters discard imported spells and choose exactly two distinct tier-one spells; priests retain Turn Undead',()=>{
  for(const key of ['Wizard','Priest']) {
    const character=hero(key);character.bonuses=[{name:'Spell: Wizard, Tier 1',bonusName:'Magic Missile',bonusTo:'Tier:1, Spell:1'},{name:'StatBonus',bonusTo:'INT:+2'}];
    initializeImportChoices(character);const event=character.advancements[0];
    assert.equal(character.spellsKnown,key==='Priest'?'Turn Undead':'');assert.equal(character.bonuses.length,1);
    for(const task of event.tasks) {
      const options=advancementOptions(character,event,task,{spells});assert.ok(options.every(option=>spells.find(spell=>spell.name===option.value).tier===1));
      assert.ok(!options.some(option=>option.value==='Turn Undead'));
      resolveAdvancement(character,event.id,task.id,options[0].value,{spells});
    }
    assert.equal(new Set(character.spellsKnown.split(', ')).size,key==='Priest'?3:2);
    assert.equal(event.completed,true);initializeImportChoices(character);assert.equal(character.advancements.length,1);
  }
});

test('fighter chooses new mastery and Grit rather than imported selections, gains weapon, and duplicate mastery is unavailable',()=>{
  const character=hero('Fighter');character.bonuses=[{name:'WeaponMastery',bonusTo:'Shortsword'},{name:'Grit',bonusName:'Dexterity',bonusTo:'AdvantageOnStatChecks'},{name:'Plus1ToHit',bonusTo:'Melee and ranged attacks'}];
  initializeImportChoices(character);const event=character.advancements[0];
  assert.equal(character.bonuses.length,1);
  const result=resolveAdvancement(character,event.id,'mastery','dagger',{weapons:rules.weapons});assert.equal(result.createdItem.name,'dagger');
  resolveAdvancement(character,event.id,'grit','STR',{weapons:rules.weapons});assert.equal(hasGrit(character,'STR'),true);assert.equal(hasGrit(character,'DEX'),false);
  assert.ok(!advancementOptions(character,{level:3},{type:'mastery'},{weapons:rules.weapons}).some(option=>option.value==='dagger'));
});

test('wild talent points are spent singly, modifiers cap at four, and duplicate initiative rerolls',()=>{
  const character=hero('Thief');character.level=2;character.XP=20;
  const event=beginLevelUp(character,{random:sequence(.5,.99,.99)});assert.equal(event.tasks[0].type,'wild');
  resolveAdvancement(character,event.id,'talent','points');resolveAdvancement(character,event.id,'talent','CHA');
  assert.equal(character.stats.CHA,9);assert.equal(event.completed,false);assert.equal(event.tasks[0].remaining,1);
  resolveAdvancement(character,event.id,'talent','DEX');assert.equal(character.stats.DEX,19);assert.equal(event.completed,true);
  character.level=4;character.XP=40;character.bonuses.push({name:'InitiativeAdvantage'});
  const second=beginLevelUp(character,{random:sequence(.5,0,0,.5,.5)});assert.equal(second.talentRoll.total,8);
});

test('armor categories use the mundane base AC, including enchanted light armor',()=>{
  const character=hero('Fighter');character.bonuses=[{name:'ArmorMastery',bonusTo:'Light',bonusAmount:1},{name:'ArmorMastery',bonusTo:'Medium',bonusAmount:1}];
  assert.equal(classArmorBonus(character,'elven chain',12),1);assert.equal(classArmorBonus(character,'chainmail',13),1);assert.equal(classArmorBonus(character,'plate',15),0);
});

test('sleep, blindness, paralysis, surprise, invisibility and stealth make an eligible thief backstab',()=>{
  const thief=hero('Thief');assert.equal(backstabMultiplier(thief),2);
  thief.level=5;assert.equal(backstabMultiplier(thief),2);thief.bonuses=[{name:'BackstabIncrease',bonusAmount:2}];assert.equal(backstabMultiplier(thief),4);
  for(const condition of ['sleeping','blinded','paralyzed','surprised'])assert.ok(unawareReason(thief,{id:'target',conditions:{[condition]:true}},{}));
  assert.equal(unawareReason(thief,{id:'target'},{combat:{surpriseRound:true,surpriseParticipantIds:['hero']}}),'surprise');
  const parts=attackRollSegments({character:thief,monster:{name:'Stingbat'},weapon:'Dagger',roll:{roll:18,firstRoll:14,secondaryRoll:18,total:21,modifier:3,checkMode:'advantage'},ability:'DEX',abilityModifier:3,hit:true,backstab:true,advantageReason:'sleep',damage:3,
    damageRoll:{terms:[{type:'die',label:'1d4',value:2,sign:1},{type:'die',label:'1d4',value:1,sign:1,isMinimum:true}]}});
  assert.equal(parts.map(part=>part.text).join(''),'Hero backstabs the stingbat with a dagger.\n21 hits for 3 damage.');
  assert.match(parts.find(part=>part.text==='21').tooltip.map(part=>part.text).join(''),/^Advantage from sleep; 2d20 = \(14\)\(18\) \+3 DEX/);
  assert.match(parts.find(part=>part.text==='3').tooltip.map(part=>part.text).join(''),/1d4 = \(2\) \+ 1d4 = \(1\) backstab = 3/);
});

test('wizard-created weapons, armor, wands and scrolls follow bounded tables and spell tiers',()=>{
  const wizard=hero('Wizard');wizard.level=3;
  const sword=createTalentMagicItem('weapon',wizard,{rules,spells,random:sequence(0,79/80,0)});assert.equal(sword.magic.bonus,2);assert.equal(sword.magic.elementDice,'1d6');assert.equal(sword.magic.element,'lightning');
  assert.equal(sword.value,(rules.weapons[0].costGp+500)*1.5);
  const armor=createTalentMagicItem('armor',wizard,{rules,spells,random:sequence(0,74/75,0)});assert.equal(armor.magic.bonus,3);assert.equal(armor.magic.resistance,'lightning');
  assert.equal(armor.value,(10+900)*1.5);
  const wand=createTalentMagicItem('wand',wizard,{rules,spells,random:sequence(90/91,0)});assert.equal(wand.magic.tier,5);
  assert.equal(wand.value,3600);assert.ok(!wand.magic.pricePending);
  const scroll=createTalentMagicItem('scroll',wizard,{rules,spells,random:()=>0});assert.ok(scroll.magic.tier>2);assert.ok(scroll.magic.classes.includes('wizard'));
  wizard.level=10;assert.equal(createTalentMagicItem('scroll',wizard,{rules,spells,random:()=>.99}).magic.tier,5);
});

test('approved item-table overlap boundaries favor the earlier result',()=>{
  for(const [value,bonus,elementDice] of [[71,3,undefined],[72,0,'1d4'],[76,0,'1d4'],[77,0,'1d6'],[79,1,'1d4'],[80,2,'1d6']]) {
    const item=createTalentMagicItem('weapon',hero('Wizard'),{rules,spells,random:sequence(0,(value-.5)/80,0)});
    assert.equal(item.magic.bonus,bonus);assert.equal(item.magic.elementDice,elementDice);
  }
  for(const [value,tier] of [[50,1],[51,2],[75,2],[76,3],[85,3],[86,4],[90,4],[91,5]]) {
    const item=createTalentMagicItem('wand',hero('Wizard'),{rules,spells,random:sequence((value-.5)/91,0)});
    assert.equal(item.magic.tier,tier);assert.equal(item.value,[0,800,1400,2000,2600,3600][tier]);
  }
});

test('equipped elemental armor halves matching damage and supports elemental saves without affecting other damage',()=>{
  const character=hero('Fighter');character.gear=[{name:'Cold armor',equipped:true,magic:{resistance:'cold'}}];
  assert.equal(elementalDamage(character,9,'Frost troll claw').total,4);assert.equal(elementalDamage(character,9,'fire').total,9);
  assert.deepEqual(elementalSaveOptions(character,'freezing ray'),{doubleRoll:true,disadvantage:false});
  setCharacterHp(character,1,{damageSource:'ice trap'});assert.equal(character.hp,6);
  character.gear[0].equipped=false;assert.equal(elementalDamage(character,9,'Frost troll').total,9);
});
