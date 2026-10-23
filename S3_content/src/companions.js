import { monsterScore, isAnimalMonster } from './encounters.js';
import { ensureMonsterLanguages, initializeMonsterLanguages } from './monster-languages.js';
import { MONSTER_DARKVISION_RADIUS, MONSTER_DARKVISION_TALENT } from './darkvision.js';
import { sameRoute, routeOf, routeStep, routeKey } from './underpasses.js';
import { isSleeping } from './conditions.js';
import { isFloatingDisc } from './floating-disc.js';
import { monsterAlignmentName, monsterGearName, normalizeMonsterGearItem } from './monster-terms.js';
import { formatFieldName } from './ui-text.js';
import { STARTING_ROOM_SHOP_ITEMS } from './shop-catalog.js';

const clone=value=>JSON.parse(JSON.stringify(value));
const CLASS_NAMES=/\b(?:peasant|pirate|assassin|bandit|thief|acolyte|apprentice|knight|guard|soldier|cultist|merchant|wizard|priest|fighter|ranger|berserker|gladiator)\b/i;
export const isMimic = monster => /^mimic\b/i.test(monster?.name||'');
export const isDoppelganger = monster => /^dopp?elg[aä]nger\b/i.test(monster?.name||'');
export const concealedMimic = monster => monster?.type==='monster'&&isMimic(monster)&&!monster.disguiseRevealed;
export const displayMonsterName = monster => monster.disguiseRevealed ? monster.name : monster.impersonatedCharacter?.name || monster.disguiseName || monster.name;
export const isAnimatedArmor = monster => /\banimated[ -]+armou?r\b/i.test(monster?.name || '');
export const concealedAnimatedArmor = monster => monster?.type === 'monster' && isAnimatedArmor(monster) && !monster.disguiseRevealed;

export function animatedArmorDisguiseAsset(monster) {
  if (!isAnimatedArmor(monster)) return null;
  if (!monster.disguiseRevealed) monster.disguiseName ||= 'Statue';
  if (!/^statue-1x1-[nesw]$/.test(monster.statueAssetKey || '')) {
    const hash = [...String(monster.id || monster.name)].reduce((value, letter) => (value * 31 + letter.charCodeAt(0)) >>> 0, 0);
    monster.statueAssetKey = `statue-1x1-${['n', 'e', 's', 'w'][hash % 4]}`;
  }
  return monster.statueAssetKey;
}

export function updateAnimatedArmorDisguises(state, { hasLineOfSight = () => true } = {}) {
  const revealed = [];
  for (const monster of state.entities || []) {
    if (!concealedAnimatedArmor(monster) || monster.defeated || monster.leftPeacefully) continue;
    animatedArmorDisguiseAsset(monster);
    if ((state.characters || []).some(character => !character.dead && !character.slain && Number(character.hp) > 0 &&
      !isSleeping(character, state) && !isFloatingDisc(character) &&
      sameRoute(state, character, monster) && Math.max(Math.abs(character.x - monster.x), Math.abs(character.y - monster.y)) <= 1 &&
      hasLineOfSight(monster, character))) {
      monster.disguiseRevealed = true;
      monster.hostile = true;
      monster.attitude = 'hostile';
      monster.attitudeChecked = true;
      delete monster.armorWaiting;
      revealed.push(monster);
    }
  }
  return revealed;
}

export function shouldAnimatedArmorWait(state, monster, { isIlluminated = () => false } = {}) {
  if (!concealedAnimatedArmor(monster) || monster.defeated || monster.leftPeacefully) return false;
  const nearest = (state.characters || []).filter(character => !isFloatingDisc(character) && !character.dead && !character.slain && Number(character.hp) > 0 &&
    sameRoute(state, monster, character)).sort((a, b) => Math.hypot(a.x - monster.x, a.y - monster.y) - Math.hypot(b.x - monster.x, b.y - monster.y))[0];
  if (!nearest || Math.max(Math.abs(nearest.x - monster.x), Math.abs(nearest.y - monster.y)) <= 1) return false;
  return !isIlluminated(monster);
}

export function animatedArmorCanEnter(state, monster, destination, { isIlluminated = () => false } = {}) {
  if (!concealedAnimatedArmor(monster)) return true;
  return sameRoute(state, monster, destination) && !isIlluminated(destination);
}

// Retreat may cross lit cells. The callback must check geometry/occupancy, not the normal armor light-entry gate.
export function planWanderingArmorRetreat(state, monster, { movement = 1, canStep, isIlluminated = () => false,
  stepCost = () => 1, hasLineOfSight = () => true, maxNodes = 4096 } = {}) {
  if (!monster?.wandering || !concealedAnimatedArmor(monster) || monster.defeated || monster.leftPeacefully ||
    Number(monster.hp) <= 0 || isSleeping(monster, state) || movement <= 0 || typeof canStep !== 'function' || !isIlluminated(monster)) return null;
  const observers = (state.characters || []).filter(character => !isFloatingDisc(character) && !character.dead && !character.slain &&
    Number(character.hp) > 0 && !isSleeping(character, state) && sameRoute(state, monster, character));
  const nextToObserver = point => observers.some(character =>
    Math.max(Math.abs(character.x - point.x), Math.abs(character.y - point.y)) <= 1 && hasLineOfSight(point, character));
  if (nextToObserver(monster)) return null;
  const start = { x: Number(monster.x), y: Number(monster.y), routeId: routeOf(state, monster), cost: 0, steps: [] };
  const queue = [start], cheapest = new Map([[routeKey(start), 0]]);
  const directions = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  for (let visited = 0; queue.length && visited < maxNodes; visited++) {
    queue.sort((a, b) => a.cost - b.cost);
    const point = queue.shift();
    if (point.cost !== cheapest.get(routeKey(point))) continue;
    if (point.steps.length && !isIlluminated(point)) {
      const steps = point.steps.filter(step => step.cost <= movement);
      if (!steps.length) return null;
      const end = steps.at(-1);
      return { x: end.x, y: end.y, routeId: end.routeId, cost: end.cost,
        steps: steps.map(({ cost, ...step }) => step), escaped: end.cost === point.cost,
        darkDestination: { x: point.x, y: point.y, routeId: point.routeId }, remainingCost: point.cost - end.cost };
    }
    const departureCost = Number(stepCost(point.x, point.y, point));
    if (!(departureCost > 0) || !Number.isFinite(departureCost)) continue;
    const cost = point.cost + departureCost;
    for (const [dx, dy] of directions) {
      const x = point.x + dx, y = point.y + dy, next = routeStep(state, point, { x, y });
      if (!next || !sameRoute(state, start, next) || x < 0 || y < 0 || x >= state.map.width || y >= state.map.height ||
        (cheapest.get(routeKey(next)) ?? Infinity) <= cost || nextToObserver(next) ||
        !canStep(point.x, point.y, x, y, point)) continue;
      cheapest.set(routeKey(next), cost);
      queue.push({ ...next, cost, steps: [...point.steps, { ...next, cost }] });
    }
  }
  return null;
}

export function initializeDisguises(state) {
  initializeMonsterLanguages(state);
  for(const monster of state.entities||[]) if(monster.type==='monster'&&!monster.defeated) {
    if (isAnimatedArmor(monster)) animatedArmorDisguiseAsset(monster);
    if(isMimic(monster))monster.mimicDisguise=true;
    if(isDoppelganger(monster)&&!monster.disguiseName&&!monster.disguiseRevealed) {
      const names=['Elf','Thief','Peasant'];
      const seed=String(monster.id||monster.name).split('').reduce((sum,c)=>sum+c.charCodeAt(0),Number(state.seed)||0);
      monster.disguiseName=names[Math.abs(seed)%names.length];monster.attitude='neutral';monster.attitudeChecked=true;monster.hostile=false;
    }
  }
}

export function ensureMonsterCompanionTraits(character) {
  if (!character?.companion) return character;
  if (!character.languages && character.companion.source) character.languages = ensureMonsterLanguages(character.companion.source).join(', ');
  character.companion.darkvisionRadius = MONSTER_DARKVISION_RADIUS;
  character.companion.proficiencyClass = character.companion.kind === 'doppelganger' ? null : 'Fighter';
  character.bonuses ||= [];
  if (!character.bonuses.some(bonus => /^darkvision(?:\b|$)/i.test(bonus.name || bonus.bonusName || ''))) character.bonuses.push({
    sourceType: 'Monster', sourceName: character.companion.source?.name || character.ancestry || 'Monster',
    gainedAtLevel: Number(character.level) || 1, name: 'Darkvision', bonusName: MONSTER_DARKVISION_TALENT, bonusTo: ''
  });
  return character;
}

export function nativeAttackLines(monster) {
  return String(monster.attack ?? monster['**ATK**'] ?? monster.ATK ?? '').split(/\s+(?:or|and)\s+/i).map(segment=>{
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
    if(!/\b(?:dagger|sword|longsword|shortsword|greatsword|mace|club|greatclub|axe|greataxe|spear|crossbow|bow|shortbow|longbow|staff|hammer|warhammer|sling|javelin|polearm|cutlass|falchion|glaive|trident|morningstar|scimitar|scythe|pick|scepter|whip|dart)\b/i.test(name))continue;
    if(gear.some(item=>item.name.toLowerCase()===name.toLowerCase()))continue;
    const config = STARTING_ROOM_SHOP_ITEMS.find(item => item.name.toLowerCase() === name.toLowerCase());
    gear.push({name:formatFieldName(name),type:'weapon',equipped:!gear.some(item=>item.type==='weapon'),attackBonus:Number(attack.match(/:\s*([+-]\d+)/)?.[1])||0,
      damage:attack.match(/\d+d\d+(?:\s*[+-]\s*\d+)?/)?.[0]||'1',slots:config?.slots ?? 1,
      nativeMonsterWeapon:true,...(config ? {costGp:config.costCopper/100} : {})});
  }
  const armor=String(monster.ac ?? monster['**AC**'] ?? monster.AC ?? '');
  for(const [pattern,name] of [[/\bleather(?:\s+armor)?\b/i,'Leather Armor'],[/\bchain\s*mail\b/i,'Chainmail'],[/\bplate(?:\s+mail)?\b/i,'Plate Mail'],[/\bshield\b/i,'Shield']]) {
    if (!pattern.test(armor)) continue;
    const label = /\bmithral\s+/i.test(armor) && /^(?:Chainmail|Plate Mail)$/.test(name) ? `Mithral ${name}` : name;
    const config = STARTING_ROOM_SHOP_ITEMS.find(item => item.name.toLowerCase() === label.toLowerCase());
    gear.push({name:label,type:'armor',equipped:true,slots:config?.slots ?? 1,...structuredClone(config?.gear || {}),
      ...(config ? {costGp:config.costCopper/100} : {})});
  }
  return gear;
}

// An explicitly saved inventory (even empty) wins over inferred stat-block gear.
export function ensureMonsterGear(monster) {
  const explicit = Array.isArray(monster.gear) || Array.isArray(monster.carriedGear) && monster.carriedGear.length > 0;
  const inventory = Array.isArray(monster.gear) ? monster.gear
    : Array.isArray(monster.carriedGear) && monster.carriedGear.length ? monster.carriedGear : nativeGear(monster);
  const stolen = new Set((monster.stolenGearNames || []).map(name => monsterGearName(name).toLowerCase()));
  monster.gear = inventory.filter(item => explicit || !stolen.has(monsterGearName(item.name).toLowerCase())).map(normalizeMonsterGearItem);
  monster.carriedGear = monster.gear;
  return monster.gear;
}

export function transferredMonsterGear(item) {
  const result = normalizeMonsterGearItem(clone(item));
  // A creature's total attack modifier is not an intrinsic bonus on its weapon.
  if (result.nativeMonsterWeapon) {
    delete result.nativeMonsterWeapon;
    delete result.attackBonus;
    const config = STARTING_ROOM_SHOP_ITEMS.find(config => config.name.toLowerCase() === result.name.toLowerCase());
    if (config) { delete result.damage; Object.assign(result, clone(config.gear || {})); }
  }
  result.bound = false;
  result.equipped = false;
  return result;
}
export function buildMonsterCompanion(monster,{id,controllerId,ancestries=['Human','Dwarf','Elf','Halfling','Goblin','Half-Orc'],random=Math.random,kind='friendly',impersonated=null}={}) {
  ensureMonsterLanguages(monster);
  const classLike=CLASS_NAMES.test(monster.name||'');
  const choices=['Human',...ancestries];
  const stats=Object.fromEntries([['STR','S'],['DEX','D'],['CON','C'],['INT','I'],['WIS','W'],['CHA','Ch']].map(([name,key])=>[name,monsterScore(monster,key)]));
  const character={id:id||`companion-${monster.id}`,name:impersonated?.name||monster.name,
    ancestry:impersonated?.ancestry||(classLike?choices[Math.floor(random()*choices.length)]:monster.name),
    className:impersonated?.className||(classLike?monster.name:isAnimalMonster(monster)?'Animal':'Monster'),
    level:Number(impersonated?.level||monster.level)||1,stats,hp:Number.parseInt(monster.hp,10)||1,maxHitPoints:Number(monster.maxHp)||Number.parseInt(monster.hp,10)||1,
    armorClass:Number.parseInt(monster.ac,10)||10,x:monster.x,y:monster.y,routeId:monster.routeId,roomId:monster.roomId,
    languages:monster.languages.join(', '),alignment:monsterAlignmentName(monster.alignment||monster.AL||monster['**AL**']||''),
    gear:kind==='doppelganger'?[{name:'Dagger',type:'weapon',equipped:true,slots:1,bound:true,attackBonus:2,damage:'1d4'}]:clone(ensureMonsterGear(monster)),
    attacks:nativeAttackLines(monster),equipmentInitialized:true,spellsKnown:'',
    companion:{kind,sourceMonsterId:monster.id,source:clone(monster),controllerCharacterId:controllerId||null,
      gearCapacity:kind==='doppelganger'?12:monsterScore(monster,'S'),damageTaken:0,departurePending:false},
    impersonation:impersonated?clone(impersonated):null};
  return ensureMonsterCompanionTraits(character);
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
    x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,visible:true,value:Number(item.value)||0,slots:item.slots??1,gearItem:transferredMonsterGear(item)
  });
  character.gear=[];
}
export function companionLeaves(state,character) {
  dropCompanionGear(state,character);
  const monster={...clone(character.companion.source),id:character.companion.sourceMonsterId,
    type:'monster',x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,hp:character.hp,
    attitude:'friendly',attitudeChecked:true,hostile:false,departing:true,defeated:false,leftPeacefully:false,gear:[],carriedGear:[]};
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
    x:character.x,y:character.y,routeId:character.routeId,roomId:character.roomId,visible:true,value:Number(item.value)||0,
    gearItem:character.companion ? transferredMonsterGear(item) : clone(item),slots:item.slots??1,
    corpseOwnerId:character.id
  });
  state.characters=state.characters.filter(member=>member.id!==character.id);
  return corpse;
}
