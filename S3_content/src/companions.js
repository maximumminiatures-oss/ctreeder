import { monsterScore, isAnimalMonster, creatureLanguages } from './encounters.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const CLASS_NAMES=/\b(?:peasant|pirate|assassin|bandit|thief|acolyte|apprentice|knight|guard|soldier|cultist|merchant|wizard|priest|fighter|ranger|berserker|gladiator)\b/i;
export const isMimic = monster => /^mimic\b/i.test(monster?.name||'');
export const isDoppelganger = monster => /^dopp?elg[aä]nger\b/i.test(monster?.name||'');
export const concealedMimic = monster => monster?.type==='monster'&&isMimic(monster)&&!monster.disguiseRevealed;
export const displayMonsterName = monster => monster.disguiseRevealed ? monster.name : monster.impersonatedCharacter?.name || monster.disguiseName || monster.name;

export function initializeDisguises(state) {
  for(const monster of state.entities||[]) if(monster.type==='monster'&&!monster.defeated) {
    if(isMimic(monster))monster.mimicDisguise=true;
    if(isDoppelganger(monster)&&!monster.disguiseName&&!monster.disguiseRevealed) {
      const names=['Elf','Thief','Peasant'];
      const seed=String(monster.id||monster.name).split('').reduce((sum,c)=>sum+c.charCodeAt(0),Number(state.seed)||0);
      monster.disguiseName=names[Math.abs(seed)%names.length];monster.attitude='neutral';monster.attitudeChecked=true;monster.hostile=false;
    }
  }
}

export function nativeAttackLines(monster) {
  return String(monster.attack||'').split(/\s+(?:or|and)\s+/i).map(segment=>{
    const match=segment.trim().match(/^\d*\s*(.*?)\s+([+-]\d+)\s*\(([^)]*)\)/);
    if(!match)return null;
    const name=match[1].replace(/\s*\([^)]*\)/g,'').trim();
    const damage=match[3].match(/\d+d\d+(?:\s*[+-]\s*\d+)?/)?.[0]||'1';
    const range=/far/i.test(segment)?'far':/near/i.test(segment)?'near':'close';
    return `${name}: ${match[2]}, ${damage}, ${range}`;
  }).filter(Boolean);
}
export function nativeGear(monster) {
  const gear=[];
  for(const attack of nativeAttackLines(monster)) {
    const name=attack.split(':')[0];
    if(!/\b(?:dagger|sword|longsword|shortsword|greatsword|mace|club|axe|spear|crossbow|bow|staff|hammer|sling|javelin|polearm)\b/i.test(name))continue;
    if(gear.some(item=>item.name===name))continue;
    gear.push({name,type:'weapon',equipped:!gear.some(item=>item.type==='weapon'),attackBonus:Number(attack.match(/:\s*([+-]\d+)/)?.[1])||0,
      damage:attack.match(/\d+d\d+(?:\s*[+-]\s*\d+)?/)?.[0]||'1',slots:1});
  }
  const armor=String(monster.ac||'');
  for(const name of ['leather','chainmail','plate','shield']) if(new RegExp(name,'i').test(armor))gear.push({name,equipped:true,slots:1});
  return gear;
}
export function buildMonsterCompanion(monster,{id,controllerId,ancestries=['Human','Dwarf','Elf','Halfling','Goblin','Half-Orc'],random=Math.random,kind='friendly',impersonated=null}={}) {
  const classLike=CLASS_NAMES.test(monster.name||'');
  const choices=['Human',...ancestries];
  const stats=Object.fromEntries([['STR','S'],['DEX','D'],['CON','C'],['INT','I'],['WIS','W'],['CHA','Ch']].map(([name,key])=>[name,monsterScore(monster,key)]));
  const character={id:id||`companion-${monster.id}`,name:impersonated?.name||monster.name,
    ancestry:impersonated?.ancestry||(classLike?choices[Math.floor(random()*choices.length)]:monster.name),
    className:impersonated?.className||(classLike?monster.name:isAnimalMonster(monster)?'Animal':'Monster'),
    level:Number(impersonated?.level||monster.level)||1,stats,hp:Number.parseInt(monster.hp,10)||1,maxHitPoints:Number(monster.maxHp)||Number.parseInt(monster.hp,10)||1,
    armorClass:Number.parseInt(monster.ac,10)||10,x:monster.x,y:monster.y,routeId:monster.routeId,roomId:monster.roomId,
    languages:creatureLanguages(monster,true).join(', '),alignment:monster.alignment||monster.AL||'',
    gear:kind==='doppelganger'?[{name:'Dagger',type:'weapon',equipped:true,slots:1,bound:true,attackBonus:2,damage:'1d4'}]:nativeGear(monster),
    attacks:nativeAttackLines(monster),equipmentInitialized:true,spellsKnown:'',
    companion:{kind,sourceMonsterId:monster.id,source:clone(monster),controllerCharacterId:controllerId||null,
      gearCapacity:kind==='doppelganger'?12:monsterScore(monster,'S'),damageTaken:0,departurePending:false},
    impersonation:impersonated?clone(impersonated):null};
  return character;
}
export function recordCompanionDamage(character,damage) {
  if(character.companion?.kind!=='friendly')return;
  const data=character.companion;
  data.damageTaken=(Number(data.damageTaken)||0)+Math.max(0,damage);
  if(data.damageTaken>=Math.max(1,Math.floor(character.maxHitPoints*2/3)))data.departurePending=true;
}
export function dropCompanionGear(state,character) {
  for(const [index,item]of(character.gear||[]).entries())state.entities.push({
    id:`departure-${character.id}-${index}-${Date.now()}`,type:'treasure',subtype:'dropped-equipment',kind:'gear',name:item.name,
    x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,visible:true,value:Number(item.value)||0,slots:item.slots??1,gearItem:clone(item)
  });
  character.gear=[];
}
export function companionLeaves(state,character) {
  dropCompanionGear(state,character);
  const monster={...clone(character.companion.source),id:character.companion.sourceMonsterId,
    type:'monster',x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,hp:character.hp,
    attitude:'friendly',attitudeChecked:true,hostile:false,departing:true,defeated:false,leftPeacefully:false};
  state.entities=state.entities.filter(entity=>entity.id!==monster.id);state.entities.push(monster);
  state.characters=state.characters.filter(member=>member.id!==character.id);
  return `The friendly ${monster.name} leaves with a tearful goodbye.`;
}
export function archiveSlainCharacter(state,character) {
  const snapshot=clone(character);
  const corpse={id:`character-corpse-${character.id}`,type:'feature',subtype:'character-corpse',name:`Dead ${character.name}`,
    x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,visible:true,characterCorpse:snapshot};
  state.entities.push(corpse);
  const coins={gold:Number(character.gold)||0,silver:Number(character.silver)||0,copper:Number(character.copper)||0};
  if(coins.gold||coins.silver||coins.copper)state.entities.push({id:`corpse-coins-${character.id}`,type:'treasure',kind:'coins',
    name:`${character.name}'s coins`,x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,visible:true,coinBreakdown:coins,
    value:coins.gold+coins.silver/10+coins.copper/100,corpseOwnerId:character.id});
  for(const [index,item]of(character.gear||[]).entries())state.entities.push({
    id:`corpse-gear-${character.id}-${index}`,type:'treasure',subtype:'dropped-equipment',kind:'gear',name:item.name,
    x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,visible:true,value:Number(item.value)||0,gearItem:clone(item),slots:item.slots??1,
    corpseOwnerId:character.id
  });
  state.characters=state.characters.filter(member=>member.id!==character.id);
  return corpse;
}
