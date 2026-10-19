import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { enchantedEquipment, magicPotion, magicScroll, identifyMagicItem, isMagicItem, magicSaleValue,
  drinkPotion, advancePotionRounds, placeMagicTreasure, queueScrollLearning, learnQueuedScrolls } from '../../S3_content/src/magic-items.js';
import { SeededRng } from '../../S3_content/src/rng.js';
import { attackNarrative, attackRollSegments } from '../../S3_content/src/combat-rules.js';
import { sheetLore, talentPresentation } from '../../S3_content/src/sheet-lore.js';
const rules = JSON.parse(await readFile(new URL('../../S3_content/data/rules-data.json', import.meta.url)));
const wizard = () => ({id:'w',name:'Wizard',className:'Wizard',stats:{STR:9,INT:14,CON:12},hp:2,maxHitPoints:8,gear:[],spellsKnown:'Detect Magic'});

test('magic equipment has exact prices, hidden names, retained tags and bundle prices', () => {
  for (const bonus of [1,2,3]) {
    const weapon = enchantedEquipment(rules.weapons.find(item=>item.name==='greataxe'),'weapon',bonus);
    assert.equal(weapon.value,10+[0,200,500,900][bonus]); assert.equal(weapon.name,'Magic Greataxe');
    assert.equal(magicSaleValue(weapon),100); identifyMagicItem(weapon);
    assert.equal(weapon.name,`+${bonus} Greataxe`);assert.ok(isMagicItem(weapon));assert.equal(magicSaleValue(weapon),weapon.value);
    const armor = enchantedEquipment(rules.armor[0],'armor',bonus);
    assert.equal(armor.value,10+[0,150,300,900][bonus]);
  }
  const ammo = enchantedEquipment(rules.gear[0],'ammunition',1);
  assert.equal(ammo.quantity,20);assert.equal(ammo.value,201);
  identifyMagicItem(ammo);ammo.quantity=ammo.totalUnits=10;assert.equal(magicSaleValue(ammo),100.5);
});
test('scroll tier costs include explicit casting costs and healing I starts identified', () => {
  for (const tier of [1,2,3,4,5]) {
    const scroll = magicScroll({name:'Spell',tier,classes:['wizard'],costGp:25});
    assert.equal(scroll.value,[0,80,140,200,260,360][tier]+25);
    assert.equal(scroll.name,'Magic Scroll');identifyMagicItem(scroll);assert.equal(scroll.name,'Scroll of Spell');
  }
  assert.equal(magicPotion('healing-1').name,'Potion of Healing I');assert.ok(isMagicItem(magicPotion('healing-1')));
  assert.equal(magicPotion('healing-2').name,'Potion');
});
test('potions heal, turn into flasks, and giant strength expires without permanently changing STR', () => {
  const caster=wizard();caster.gear=[magicPotion('healing-2'),magicPotion('giant-strength'),magicPotion('invisibility')];
  drinkPotion(caster,0,{random:()=>.99});assert.equal(caster.hp,8);assert.equal(caster.gear[0].name,'Empty flask');
  drinkPotion(caster,1);assert.equal(caster.stats.STR,18);advancePotionRounds({characters:[caster]},9);assert.equal(caster.stats.STR,18);
  advancePotionRounds({characters:[caster]},1);assert.equal(caster.stats.STR,9);
  drinkPotion(caster,2);assert.equal(caster.invisibility.rounds,10);assert.equal(caster.invisibility.breakOnOffense,true);
});
test('Vitality uses class hit dice, persists the number drunk, and can kill instantly', () => {
  for(const [className,sides]of[['Wizard',4],['Thief',4],['Priest',6],['Fighter',8]]) {
    const character=wizard();character.className=className;character.gear=[magicPotion('vitality'),magicPotion('vitality')];
    drinkPotion(character,0,{random:()=>.99});assert.equal(character.maxHitPoints,8+sides);assert.equal(character.vitalityPotionsDrunk,1);
    drinkPotion(character,1,{checkRoll:()=>({total:17})});assert.equal(character.dead,true);assert.equal(character.slain,true);assert.equal(character.hp,0);
  }
});
test('treasure replacement reserves exact magic prices, preserves total budget, and is deterministic', () => {
  function scene(){return {level:1,generation:{},rulesData:rules,entities:Array.from({length:20},(_,i)=>({id:String(i),type:'treasure',value:100,name:'Loot'}))};}
  const a=scene(),b=scene();placeMagicTreasure(a,new SeededRng(88));placeMagicTreasure(b,new SeededRng(88));assert.deepEqual(a,b);
  assert.equal(a.entities.filter(item=>item.gearItem?.magic).length,4);
  assert.ok(Math.abs(a.entities.reduce((sum,item)=>sum+item.value,0)-2000)<.001);
  for(const entity of a.entities.filter(item=>item.gearItem?.magic))assert.equal(entity.value,entity.gearItem.value);
  const tiny=scene();tiny.entities.forEach(item=>item.value=.01);placeMagicTreasure(tiny,new SeededRng(88));assert.equal(tiny.generation.magicTreasureCount,0);
});
test('scroll learning queues on the actual item, consumes it on either result, and stores bonus known spells', () => {
  for(const total of [14,15]) {
    const caster=wizard();caster.gear=[magicScroll({name:'Burning Hands',tier:1,classes:['wizard']})];identifyMagicItem(caster.gear[0]);
    assert.equal(queueScrollLearning(caster,0).message,'will attempt on next rest.');
    const [result]=learnQueuedScrolls(caster,()=>({total}));assert.equal(result.succeeded,total===15);
    assert.equal(caster.gear[0].name,'Blank paper');assert.equal(caster.gear[0].value,1);
    assert.equal(caster.spellsKnown.includes('Burning Hands'),total===15);
    if(total===15)assert.deepEqual(caster.learnedScrollSpells,['Burning Hands']);
  }
});
test('unidentified attack bonuses affect totals without being named or folded into other bonuses', () => {
  const context={character:{name:'Hero'},monster:{name:'Giant Wasp',ac:13},weapon:'Shortsword',roll:{roll:9,modifier:4,total:13},ability:'STR',abilityModifier:2,hit:true,damage:7};
  assert.doesNotMatch(attackNarrative({...context,hiddenMagic:2}),/magic|other/);
  assert.match(attackRollSegments({...context,magic:2}).find(part=>part.tooltip).tooltip.map(part=>part.text).join(''),/\+2 STR \+2 magic/);
});
test('talent provenance moves into hover text and lore uses exact supplied descriptions', () => {
  assert.deepEqual(talentPresentation('Thief 1: Backstab x 2 (all thieves)'),{text:'Backstab x 2',source:'Thief 1'});
  assert.deepEqual(talentPresentation('Fighter 1: Shortsword mastery'),{text:'Shortsword mastery',source:'Fighter 1'});
  assert.match(sheetLore('Deity','Ord'),/Every insightful question answered/);
  assert.match(sheetLore('Alignment','Chaotic'),/Destroy the status quo/);
  assert.equal(sheetLore('Deity','unknown'),'');
});
