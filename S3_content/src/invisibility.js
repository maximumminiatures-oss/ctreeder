import { abilityScoreModifier } from './characters.js';
import { rollCheck } from './interactions.js';
import { castingBonus, canTouchCharacter } from './spell-effects.js';
import { canTargetAtRange } from './targeting.js';
import { wizardCastingMode, rollWizardMishaps } from './wizard-mishaps.js';
import { makeInvisible } from './concealment.js';

export function castInvisibility(state,caster,{advantage=false,disadvantage=false,checkRoll=rollCheck}={}) {
  if(caster.pendingSpell) throw new Error('Resolve the pending spell first.');
  if((caster.failedSpellKeys||[]).includes('invisibility'))throw new Error('Invisibility is unavailable until recovery.');
  const modifier=abilityScoreModifier(caster.stats?.INT)+castingBonus(caster,'wizard');
  const check=checkRoll(modifier,wizardCastingMode(caster,2,advantage,disadvantage));
  const succeeded=check.roll!==1&&(check.roll===20||check.total>=12);
  let message=`${caster.name} ${succeeded?'casts':'fails to cast'} Invisibility: ${check.total} vs DC 12.`;
  if(!succeeded) {
    caster.failedSpellKeys=[...new Set([...(caster.failedSpellKeys||[]),'invisibility'])];
    const mishaps=check.roll===1?rollWizardMishaps(state,caster,'invisibility',{
      tier:2,knownSpells:String(caster.spellsKnown||'').split(/,\s*/),resolveMisfire:target=>{
        makeInvisible(target,{rounds:10,source:'spell',breakOnOffense:true});
        return {targetId:target.id,detail:`${target.name} becomes invisible.`};
      }}):[];
    return {check,succeeded,message,mishaps};
  }
  caster.pendingSpell={spell:'invisibility',phase:check.roll===20?'critical':'targeting',radius:1,rounds:10};
  return {check,succeeded,critical:check.roll===20,message:`${message} ${check.roll===20?'Choose a critical effect.':'Pick a creature to make invisible.'}`};
}
export function resolveInvisibility(state,caster,{choice,targetId,dismiss=false}={}) {
  const pending=caster.pendingSpell;
  if(pending?.spell!=='invisibility')throw new Error('Invisibility is not ready.');
  if(pending.phase==='critical') {
    if(!['duration','range'].includes(choice))throw new Error('Choose a critical Invisibility effect.');
    pending.phase='targeting';pending.rounds=choice==='duration'?20:10;pending.radius=choice==='range'?2:1;
    return {message:'Pick a creature to make invisible.'};
  }
  if(dismiss) {caster.pendingSpell=null;return {message:'Unused Invisibility dissipates. The casting action remains spent.'};}
  const target=[...state.characters,...state.entities.filter(entity=>entity.type==='monster')].find(entity=>entity.id===targetId);
  if(!target||target.dead||target.slain||target.defeated||Number(target.hp)<=0)throw new Error('Choose a living creature.');
  if(!(pending.radius===1?canTouchCharacter(state,caster,target):canTargetAtRange(state,caster,target,pending.radius,{requireLight:false})))throw new Error('The target is outside Invisibility range.');
  makeInvisible(target,{rounds:pending.rounds,source:'spell',breakOnOffense:true});caster.pendingSpell=null;
  return {message:`${target.name} becomes invisible for ${pending.rounds} rounds, or until attacking or casting.`};
}
