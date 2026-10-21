import { abilityScoreModifier } from './characters.js';
import { rollCheck, defeatMonster } from './interactions.js';
import { castingBonus, canTouchCharacter } from './spell-effects.js';
import { handItemKind } from './equipment.js';
import { canTargetAtRange } from './targeting.js';
import { isUndeadMonster } from './crypts.js';
import { wizardCastingMode, rollWizardMishaps } from './wizard-mishaps.js';

export const FAITH_SPELLS = new Set(['shield of faith', 'holy weapon', 'protection from evil', 'turn undead']);
export const FAITH_CRITICAL_CHOICES = {
  'shield of faith': [['bonus','+4 AC'],['duration','10 Rounds']],
  'holy weapon': [['duration','10 Rounds'],['bonus','+2 Attack and Damage'],['range','10-Foot Range']],
  'turn undead': [['duration','Flee for 10 Rounds'],['range','Double Range'],['destroy','Destroy on Failure by 5+']]
};
export const alignmentOf = entity => {
  const value=String(entity?.alignment || entity?.AL || entity?.['**AL**'] || '').toLowerCase();
  return /^(c|chaotic)$/.test(value)?'chaotic':/^(l|lawful)$/.test(value)?'lawful':/^(n|neutral)$/.test(value)?'neutral':'';
};
export const protectionName = caster => /priest/i.test(caster.className) && alignmentOf(caster)==='chaotic' ? 'Protection from Good' : 'Protection from Evil';
const alive = entity => entity && !entity.dead && !entity.slain && !entity.defeated && Number(entity.hp)>0;
const monsterCatalogs=new WeakMap();
export function restoreMonsterSpellStats(state,catalog) {
  for (const entity of state.entities || []) if (entity.name === 'Wasp, Giant') entity.name = 'Giant Wasp';
  if(!Array.isArray(catalog)) return;
  let records=monsterCatalogs.get(catalog);
  if(!records) {
    records=new Map();
    for(const monster of catalog){const key=String(monster.name||monster['Monster Name']).toLowerCase().replace(/^wasp, giant$/,'giant wasp');if(!records.has(key))records.set(key,monster);}
    monsterCatalogs.set(catalog,records);
  }
  for(const entity of state.entities||[]) if(entity.type==='monster') {
    const source=records.get(String(entity.name||'').toLowerCase());
    if(!source)continue;
    if(!entity.tags?.length)entity.tags=source.tags||[];
    if(!entity.talents?.length)entity.talents=source.talents||[];
    for(const key of ['S','D','C','I','W','Ch','languages'])if(entity[key]==null||entity[key]==='')entity[key]=source[key]??source[`**${key==='Ch'?'CH':key}**`]??'';
    if(!entity.maxHp)entity.maxHp=Number.parseInt(entity.hp,10)||Number(source.hp)||1;
    if(!entity.alignment&&!entity.AL&&!entity['**AL**'])entity.alignment=source.alignment??source.AL??source['**AL**']??'';
    if(entity.chaModifier==null)entity.chaModifier=Number(entity.Ch??entity['**CH**']??source.chaModifier??source.Ch??source['**CH**'])||0;
  }
}
export const equippedWeapon = character => (character?.gear || []).find(item=>item.equipped && handItemKind(item)==='weapon');
export const holyWeaponBonus = item => item?.holyWeapon?.rounds>0 ? Number(item.holyWeapon.bonus)||0 : 0;
export const faithArmorBonus = character => Math.max(0,...(character.faithEffects || []).filter(effect=>effect.spell==='shield of faith'&&effect.rounds>0).map(effect=>effect.bonus));

export function protectionAuras(state) {
  return (state.characters || []).filter(c=>alive(c)&&c.focusSpell?.spell==='protection from evil').map(c=>({
    caster:c,center:state.characters.find(target=>target.id===c.focusSpell.centerId)||c,
    radius:c.focusSpell.radius,opposes:c.focusSpell.opposes
  })).filter(aura=>alive(aura.center));
}
export function protectionDisadvantage(state, entity) {
  const alignment=alignmentOf(entity);
  return protectionAuras(state).some(aura=>aura.caster.id!==entity.id && aura.opposes.includes(alignment) &&
    canTargetAtRange(state,aura.center,entity,aura.radius,{requireLight:false}));
}
export function blocksMindControl(state, target, description) {
  return /\b(?:charm\w*|beguil\w*|possess\w*|compel\w*|compuls\w*|dominat\w*|hypnot\w*|mind[ -]?control|enslav\w*|enthrall\w*|mesmeri\w*|suggestion|command)\b/i.test(description) &&
    protectionAuras(state).some(aura=>canTargetAtRange(state,aura.center,target,aura.radius,{requireLight:false}));
}
export function faithCastingMode(state,caster,advantage=false) {
  return wizardCastingMode(caster,1,advantage,protectionDisadvantage(state,caster));
}
export function faithCastingModifier(caster) {
  const wizard=/wizard/i.test(caster.className);
  return abilityScoreModifier(caster.stats?.[wizard?'INT':'WIS'])+castingBonus(caster,wizard?'wizard':'priest');
}
function loseSpell(state,caster,spell,naturalOne) {
  caster.failedSpellKeys=[...new Set([...(caster.failedSpellKeys||[]),spell])];
  if(naturalOne) {
    if(/wizard/i.test(caster.className)) return rollWizardMishaps(state,caster,spell,{
      knownSpells:String(caster.spellsKnown||'').split(/,\s*/),
      resolveMisfire:target=>{
        caster.focusSpell={spell:'protection from evil',centerId:target.id,radius:1,critical:false,
          opposes:['chaotic'],lastTurn:state.combat?.active?`${state.combat.round}:${caster.id}`:null};
        return {targetId:target.id,detail:`Protection from Evil centers on ${target.name}; ${caster.name} maintains its focus.`};
      }
    });
    caster.spellPenance={...(caster.spellPenance||{}),[spell]:{paid:false}};
  }
  return [];
}

export function castFaithSpell(state,caster,spell,{advantage=false,checkRoll=rollCheck}={}) {
  if(!FAITH_SPELLS.has(spell)) throw new Error('Unknown implemented faith spell.');
  if(caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if((caster.failedSpellKeys||[]).includes(spell)) throw new Error('This spell is unavailable until recovery.');
  if(spell==='turn undead' && !(caster.gear||[]).some(item=>/holy symbol/i.test(item.name))) throw new Error('Turn Undead requires a holy symbol.');
  if(spell==='protection from evil') caster.focusSpell=null;
  const check=checkRoll(faithCastingModifier(caster),faithCastingMode(state,caster,advantage));
  const succeeded=check.roll!==1&&(check.roll===20||check.total>=11);
  const name=spell==='protection from evil'?protectionName(caster):spell.replace(/\b\w/g,c=>c.toUpperCase());
  const message=`${caster.name} ${succeeded?'casts':'fails to cast'} ${name}: 1d20 = (${check.roll}) ${check.modifier>=0?'+':''}${check.modifier} = ${check.total} vs DC 11.`;
  if(!succeeded) return {check,succeeded,message,mishaps:loseSpell(state,caster,spell,check.roll===1)};
  if(spell==='protection from evil') {
    caster.focusSpell={spell,radius:check.roll===20?2:1,critical:check.roll===20,
      opposes:name.endsWith('Good')?['lawful','neutral']:['chaotic'],lastCheck:check.total,
      lastTurn:state.combat?.active?`${state.combat.round}:${caster.id}`:null};
    return {check,succeeded,message:`${message} ${name} remains while focus is maintained.`};
  }
  if(check.roll===20) {
    caster.pendingSpell={spell,phase:'critical',castingTotal:check.total};
    return {check,succeeded,critical:true,message:`${message} Choose a critical effect.`};
  }
  const outcome=applyFaithSpell(state,caster,{spell,castingTotal:check.total});
  return {check,succeeded,...outcome,message:`${message} ${outcome.message}`};
}

function applyFaithSpell(state,caster,pending) {
  const {spell,choice,castingTotal}=pending;
  const rounds=choice==='duration'?10:5;
  if(spell==='shield of faith') {
    caster.faithEffects=(caster.faithEffects||[]).filter(effect=>effect.spell!==spell);
    caster.faithEffects.push({spell,bonus:choice==='bonus'?4:2,rounds});
    return {message:`${caster.name} gains +${choice==='bonus'?4:2} AC for ${rounds} rounds.`};
  }
  if(spell==='holy weapon') {
    caster.pendingSpell={...pending,phase:'targeting',radius:choice==='range'?2:1,rounds,bonus:choice==='bonus'?2:1};
    return {message:'Pick a character whose equipped weapon will be blessed.'};
  }
  const results=[];
  for(const monster of state.entities.filter(entity=>entity.type==='monster'&&alive(entity)&&isUndeadMonster(entity)&&
      canTargetAtRange(state,caster,entity,choice==='range'?12:6,{requireLight:false}))) {
    const modifier=Number(monster.chaModifier??monster.Ch??monster['**CH**'])||0;
    const resistance=rollCheck(modifier);
    const margin=castingTotal-resistance.total;
    const destroyed=margin>=(choice==='destroy'?5:10)&&Number(monster.level??monster['**LV**']??1)<=Number(caster.level||1);
    if(destroyed) defeatMonster(state,monster,{ash:true});
    else if(margin>0) monster.turnedUndead={casterId:caster.id,rounds};
    results.push({id:monster.id,check:resistance,destroyed,fled:!destroyed&&margin>0});
  }
  return {results,message:results.length?results.map(result=>{
    const monster=state.entities.find(entity=>entity.id===result.id);
    return `${monster.name}: CHA ${result.check.total} vs ${castingTotal}; ${result.destroyed?'destroyed to an ash pile':result.fled?`flees for ${rounds} rounds`:'resists'}.`;
  }).join(' '):'No undead are within range and line of sight.'};
}

export function resolveFaithSpell(state,caster,{choice,targetId}={}) {
  const pending=caster.pendingSpell;
  if(!FAITH_SPELLS.has(pending?.spell)) throw new Error('No faith spell is pending.');
  if(pending.phase==='critical') {
    if(!FAITH_CRITICAL_CHOICES[pending.spell]?.some(([key])=>key===choice)) throw new Error('Choose a valid critical effect.');
    caster.pendingSpell=null;
    return applyFaithSpell(state,caster,{...pending,choice});
  }
  if(pending.spell!=='holy weapon'||pending.phase!=='targeting') throw new Error('No weapon blessing is ready.');
  const target=state.characters.find(character=>character.id===targetId),weapon=equippedWeapon(target);
  if(!alive(target)||!weapon) throw new Error('Choose a living character with an equipped weapon.');
  if(!(pending.radius===1?canTouchCharacter(state,caster,target):canTargetAtRange(state,caster,target,pending.radius,{requireLight:false}))) throw new Error('That character is outside Holy Weapon range.');
  weapon.holyWeapon={bonus:pending.bonus,rounds:pending.rounds,casterId:caster.id,magical:true};
  caster.pendingSpell=null;
  return {message:`${target.name}'s ${weapon.name} is magical: +${pending.bonus} attack and damage for ${pending.rounds} rounds.`};
}

export function maintainFocus(state,caster,{reason='next round',advantage=false,checkRoll=rollCheck}={}) {
  const focus=caster.focusSpell;
  if(!focus) return null;
  if(!alive(caster)) {caster.focusSpell=null;return {message:`${caster.name} loses focus.`};}
  const check=checkRoll(faithCastingModifier(caster),faithCastingMode(state,caster,advantage));
  const succeeded=check.roll!==1&&(check.roll===20||check.total>=11);
  let mishaps=[];
  if(!succeeded) {
    caster.focusSpell=null;
    if(check.roll===1) mishaps=loseSpell(state,caster,focus.spell,true);
  } else {
    focus.lastCheck=check.total;
  }
  return {check,succeeded,mishaps,message:`${caster.name} focus (${reason}): ${check.total} vs DC 11; ${succeeded?'maintained':'lost'}${check.roll===1?'; critical failure':''}.`};
}

export function advanceFaithRounds(state,rounds=1) {
  for(const character of state.characters||[]) {
    character.faithEffects=(character.faithEffects||[]).map(effect=>({...effect,rounds:effect.rounds-rounds})).filter(effect=>effect.rounds>0);
  }
  const gear=[...(state.characters||[]).flatMap(character=>character.gear||[]),...(state.entities||[]).map(entity=>entity.gearItem).filter(Boolean)];
  for(const item of gear) if(item.holyWeapon) {item.holyWeapon.rounds-=rounds;if(item.holyWeapon.rounds<=0)delete item.holyWeapon;}
  for(const monster of state.entities||[]) if(monster.turnedUndead) {
    monster.turnedUndead.rounds-=rounds;if(monster.turnedUndead.rounds<=0)delete monster.turnedUndead;
  }
}

export function chooseUndeadFleeStep(state,monster,caster,canStep,visited=new Set()) {
  const directions=[[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  const valid=(from,x,y)=>{
    const dx=x-from.x,dy=y-from.y;
    return (dx*(from.x-caster.x)+dy*(from.y-caster.y))>=0 &&
      Math.hypot(x-caster.x,y-caster.y)>=Math.hypot(from.x-caster.x,from.y-caster.y) && canStep(from.x,from.y,x,y);
  };
  const hallwayDistance=start=>{
    const queue=[{...start,distance:0}],seen=new Set([start.x+','+start.y]);
    for(let i=0;i<queue.length&&i<state.tiles.length;i++) {
      const point=queue[i];
      const tile=state.tiles[point.y*state.map.width+point.x];
      if(tile?.hallId || (tile?.roomId&&tile.roomId!==monster.roomId)) return point.distance;
      for(const [dx,dy] of directions) {
        const x=point.x+dx,y=point.y+dy;
        if(!seen.has(x+','+y)&&valid(point,x,y)) {seen.add(x+','+y);queue.push({x,y,distance:point.distance+1});}
      }
    }
    return Infinity;
  };
  return directions.map(([dx,dy])=>({x:monster.x+dx,y:monster.y+dy})).filter(point=>!visited.has(point.x+','+point.y)&&valid(monster,point.x,point.y))
    .map(point=>({...point,hallway:hallwayDistance(point),distance:Math.hypot(point.x-caster.x,point.y-caster.y)}))
    .sort((a,b)=>a.hallway-b.hallway||b.distance-a.distance)[0]||null;
}
