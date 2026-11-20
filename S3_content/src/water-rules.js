import {isSlowWaterTile} from './water-terrain.js';
import {getTile} from './state-schema.js';
import {isInnerWallBlockingTile} from './inner-walls.js';
import {waterHabitat} from './water-habitats.js';

const effects=creature=>creature?.transformationEffects||[];
const activeFeature=(creature,name)=>effects(creature).some(e=>e.spell==='alter self'&&e.rounds>0&&e.features?.includes(name));
export const movementText=creature=>String(creature?.movement||creature?.mv||creature?.['**MV**']||
  creature?.companion?.source?.movement||creature?.companion?.source?.['**MV**']||'');
export const isOnCeiling=creature=>creature?.conditions?.ceiling===true;
export const canClimbCeiling=creature=>/\bclimb\b/i.test(movementText(creature))||
  creature?.conditions?.lycanthropy?.transformed&&creature.conditions.lycanthropy.kind==='wererat'||
  creature?.type==='monster'&&/^wererat$/i.test(creature.name||'')||activeFeature(creature,'spider-legs');
export const aboveWater=creature=>isOnCeiling(creature)||creature?.conditions?.incorporeal===true||
  /\bfly\b/i.test(movementText(creature))||effects(creature).some(e=>
    ['fly','gaseous form','levitate'].includes(e.spell)&&(e.spell==='levitate'||e.rounds>0));
export function wallAdjacent(state,x,y){
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy)continue;
    const tile=getTile(state,x+dx,y+dy);
    if(tile&&(tile.type==='wall'||isInnerWallBlockingTile(tile)))return true;
  }
  return false;
}
export const canReachCeiling=(state,creature,x=creature?.x,y=creature?.y)=>
  Boolean(creature&&canClimbCeiling(creature)&&wallAdjacent(state,Number(x),Number(y)));
export const waterMovementExempt=(state,creature,x=creature?.x,y=creature?.y)=>
  Boolean(aboveWater(creature)||/\bswim\b/i.test(movementText(creature))||activeFeature(creature,'gills')||
    isSlowWaterTile(state,x,y)&&canReachCeiling(state,creature,x,y));
export const isImmersed=(state,creature)=>Boolean(state&&creature&&!aboveWater(creature)&&
  isSlowWaterTile(state,Number(creature.x),Number(creature.y)));
export function waterStepBlock(state,creature,fromX,fromY,x,y){
  if(!creature||aboveWater(creature)||canReachCeiling(state,creature,fromX,fromY))return '';
  const habitat=waterHabitat(creature),wet=isSlowWaterTile(state,x,y);
  return habitat.bound&&!wet?'This creature cannot leave the water.':
    habitat.averse&&wet?'This creature will not enter water.':'';
}
export function quenchImmersedEffects(state,creature,position=creature){
  if(!creature||!isImmersed(state,{...creature,x:position.x,y:position.y}))return false;
  let changed=false;
  for(const key of ['hellfire','burning','onFire'])if(creature.conditions?.[key]){
    delete creature.conditions[key];changed=true;
  }
  const ongoing=effect=>effect&&/\b(?:fire|acid)\b/i.test(String(effect.damageType||effect.damageSource||''))&&
    Boolean(effect.ongoing||effect.perRound||effect.damagePerRound||effect.tickDamage);
  for(const property of ['spellEffects','effects'])if(Array.isArray(creature[property])){
    const before=creature[property].length;
    creature[property]=creature[property].filter(e=>!ongoing(e));changed||=before!==creature[property].length;
  }
  for(const caster of [...(state.characters||[]),...(state.entities||[])]){
    const focus=caster.focusSpell;
    if(focus?.spell==='acid arrow'&&focus.targetIds?.includes(creature.id)){
      focus.targetIds=focus.targetIds.filter(id=>id!==creature.id);changed=true;
      if(!focus.targetIds.length&&!caster.pendingSpell)caster.focusSpell=null;
    }
  }
  return changed;
}
export function commitWaterMovement(state,creature,from,to=creature){
  if(!creature)return '';
  let message='';
  if(!aboveWater(creature)&&(isSlowWaterTile(state,to.x,to.y)||isSlowWaterTile(state,from.x,from.y))&&canReachCeiling(state,creature,from.x,from.y)){
    creature.conditions||={};creature.conditions.ceiling=true;
    message=creature.name+' climbs from wall to ceiling.';
  }
  quenchImmersedEffects(state,creature,to);
  return message;
}
export function modeMovementSquares(creature,mode,fallback=6){
  const text=movementText(creature);
  if(!new RegExp('\\b'+mode+'\\b','i').test(text))return fallback;
  if(/triple\s*near/i.test(text))return 18;
  if(/double\s*near/i.test(text)||/\bfar\b/i.test(text))return 12;
  if(/\bnear\b/i.test(text))return 6;
  if(/\bclose\b/i.test(text))return 1;
  return fallback;
}

export const willUseCeiling=(state,creature,from,to)=>isOnCeiling(creature)||
  !aboveWater(creature)&&(isSlowWaterTile(state,from.x,from.y)||isSlowWaterTile(state,to.x,to.y))&&
  canReachCeiling(state,creature,from.x,from.y);
export function ceilingMovementView(state,creature,from,to){
  return creature&&willUseCeiling(state,creature,from,to)&&!isOnCeiling(creature)?
    {...creature,conditions:{...creature.conditions,ceiling:true}}:creature;
}
