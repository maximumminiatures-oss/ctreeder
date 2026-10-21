import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyDungeonState } from '../../S3_content/src/state-schema.js';
import { hydrateDungeonState, serializeDungeonState } from '../../S3_content/src/persistence.js';
import { recomputeVisibility } from '../../S3_content/src/visibility.js';
import { makeUnderpass } from '../../S3_content/src/underpasses.js';
import { WIZARD_TIER_TWO_FOCUS, WIZARD_TIER_TWO_FOCUS_CRITICAL_CHOICES, castFocusedSpell, resolveFocusedSpell,
  maintainTierTwoFocus, advanceTierTwoFocus, endWizardTierTwoFocus, cleanupWizardTierTwoFocus,
  resolveDetectThoughtsResistance, detectThoughtsModifiers } from '../../S3_content/src/wizard-tier-two-focus.js';

const check=(roll,total=null)=>(modifier,mode)=>({roll,modifier,total:total??roll+modifier,mode});
function scene() {
  const state=createEmptyDungeonState(123);state.map={width:25,height:15};
  state.tiles=Array.from({length:375},(_,i)=>({x:i%25,y:Math.floor(i/25),type:'floor',roomId:'room',meta:{}}));
  const caster={id:'wizard',name:'Wizard',className:'Wizard',hp:30,maxHitPoints:30,x:3,y:3,roomId:'room',
    stats:{INT:14},bonuses:[],gear:[],spellsKnown:'Acid Arrow, Detect Thoughts, Hold Person',raw:{},lightRadius:30};
  const monster={id:'foe',name:'Bandit',type:'monster',hp:50,level:2,W:1,x:6,y:3,roomId:'room',tags:['humanoid'],visible:true};
  state.characters=[caster,{id:'ally',name:'Ally',hp:12,x:4,y:4,stats:{},gear:[],raw:{}}];
  state.entities=[monster,{...monster,id:'second',name:'Guard',x:7}];state.player={x:3,y:3,torchLit:false,lightRadius:0};
  state.activeCharacterId=caster.id;recomputeVisibility(state);return {state,caster,monster,second:state.entities[1],ally:state.characters[1]};
}
function ready(context,spell,roll=12,choice=null) {
  const result=castFocusedSpell(context.state,context.caster,spell,{checkRoll:check(roll)});
  if(choice)resolveFocusedSpell(context.state,context.caster,{choice});return result;
}

test('focus spell sets/critical choices use stable keys and tier-two casting bonuses/modes/DC12',()=>{
  assert.deepEqual([...WIZARD_TIER_TWO_FOCUS],['acid arrow','detect thoughts','hold person','levitate','silence']);
  assert.deepEqual(WIZARD_TIER_TWO_FOCUS_CRITICAL_CHOICES['acid arrow'].map(([key])=>key),['damage','targets']);
  const ctx=scene();ctx.caster.wizardEffects=[{type:'unstable',tier:2,rounds:3}];
  ctx.caster.bonuses=[{bonusName:'Spellcasting',bonusTo:'+1 wizard spellcasting',sourceName:'Wizard'}];
  const result=castFocusedSpell(ctx.state,ctx.caster,'acid arrow',{advantage:true,checkRoll:check(9)});
  assert.equal(result.check.modifier,3);assert.equal(result.succeeded,true);assert.equal(result.check.total,12);
  assert.deepEqual(result.check.mode,{doubleRoll:false,disadvantage:false});
  assert.equal(ctx.caster.pendingSpell.phase,'targeting');assert.equal(ctx.caster.focusSpell.tier,2);
});

test('Acid Arrow initial hit is automatic and each successful caster-round focus check adds one damage tick',()=>{
  const ctx=scene();ready(ctx,'acid arrow');
  const first=resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>.5});
  assert.equal(first.hits[0].damage,4);assert.equal(ctx.monster.hp,46);assert.equal(ctx.caster.pendingSpell,null);
  const tick=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(12),random:()=>0});
  assert.equal(tick.hits[0].damage,1);assert.equal(ctx.monster.hp,45);assert.equal(ctx.caster.focusSpell.focusedRounds,2);
  const damageCheck=maintainTierTwoFocus(ctx.state,ctx.caster,{reason:'damage',checkRoll:check(12)});
  assert.deepEqual(damageCheck.hits,[]);assert.equal(ctx.monster.hp,45);assert.equal(ctx.caster.focusSpell.focusedRounds,2);
});

test('Acid Arrow critical damage doubles initial/tick dice, while targets critical selects two distinct monsters sequentially',()=>{
  let ctx=scene();ready(ctx,'acid arrow',20,'damage');
  const hit=resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>.5});
  assert.deepEqual(hit.hits[0].rolls,[4,4]);
  assert.equal(maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(12),random:()=>0}).hits[0].damage,2);
  ctx=scene();ready(ctx,'acid arrow',20,'targets');
  assert.equal(resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>0}).remaining,1);
  assert.equal(ctx.caster.pendingSpell.phase,'targeting');
  assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'}),/different/);
  assert.equal(resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'second',random:()=>0}).remaining,0);
  assert.equal(ctx.caster.pendingSpell,null);
  const tick=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(12),random:()=>0});
  assert.equal(tick.hits.length,2);assert.equal(ctx.monster.hp,48);assert.equal(ctx.second.hp,48);
});

test('Acid Arrow range is circular twelve squares and visible targets cannot cross a wall or an underpass route',()=>{
  const ctx=scene();ready(ctx,'acid arrow');ctx.monster.x=15;
  resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>0});
  endWizardTierTwoFocus(ctx.state,ctx.caster);ready(ctx,'acid arrow');ctx.monster.x=16;
  assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'}),/range/);
  ctx.monster.x=6;ctx.state.tiles[3*25+5].type='wall';
  assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'}),/line of sight/);
  ctx.state.tiles[3*25+5].type='floor';
  ctx.state.underpasses=[makeUnderpass('below',Array.from({length:11},(_,i)=>({x:i+2,y:3})),
    {x:7,y:3},[{x:1,y:3},{x:13,y:3}])];
  ctx.caster.x=6;ctx.caster.routeId='below';ctx.monster.x=7;ctx.monster.routeId='';
  assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'}),/same route/);
});

test('focus failures end effects without ordinary spell loss; natural one uses tier-two mishaps and loses the spell',()=>{
  const ctx=scene();ready(ctx,'acid arrow');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>0});
  const failure=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(2)});
  assert.equal(failure.succeeded,false);assert.equal(ctx.caster.focusSpell,null);
  assert.equal((ctx.caster.failedSpellKeys||[]).includes('acid arrow'),false);
  ready(ctx,'acid arrow');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>0});
  const critical=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(1,100),random:()=>.999});
  assert.equal(critical.succeeded,false);assert.ok(ctx.caster.failedSpellKeys.includes('acid arrow'));
  assert.equal(critical.mishaps[0].roll,12);assert.equal(ctx.caster.wizardEffects.at(-1).tier,2);
  assert.throws(()=>castFocusedSpell(ctx.state,ctx.caster,'acid arrow'),/unavailable/);
});

test('an initial failed cast loses the spell, ends the old focus, and does not apply target effects',()=>{
  const ctx=scene();ready(ctx,'hold person');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  const result=castFocusedSpell(ctx.state,ctx.caster,'acid arrow',{checkRoll:check(2)});
  assert.equal(result.succeeded,false);assert.equal(ctx.caster.focusSpell,null);
  assert.equal(ctx.monster.conditions.paralyzed,undefined);assert.equal(ctx.monster.hp,50);
  assert.ok(ctx.caster.failedSpellKeys.includes('acid arrow'));
});

test('maintenance twenties apply normal Acid Arrow damage immediately without offering or adding a critical',()=>{
  const ctx=scene();ready(ctx,'acid arrow');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>0});
  const result=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(20),random:()=>0});
  assert.equal(result.awaitingCritical,undefined);assert.equal(ctx.monster.hp,48);
  assert.equal(ctx.caster.pendingSpell,null);assert.equal(ctx.caster.focusSpell.critical,false);
  assert.equal(result.hits[0].damage,1);assert.equal(ctx.caster.focusSpell.focusedRounds,2);
  const later=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(20),random:()=>0});
  assert.equal(later.hits[0].damage,1);assert.equal(later.awaitingCritical,undefined);assert.equal(ctx.caster.focusSpell.criticalChoice,null);
});

test('Hold Person and Detect Thoughts Focus twenties preserve targets and another ready spell without critical choices',()=>{
  for(const spell of ['hold person','detect thoughts']) {
    const ctx=scene();ready(ctx,spell);resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
    const pending={spell:'magic missile',phase:'targeting',remaining:1};ctx.caster.pendingSpell=pending;
    for(const reason of ['next round','damage']) {
      const result=maintainTierTwoFocus(ctx.state,ctx.caster,{reason,checkRoll:check(20)});
      assert.equal(result.succeeded,true);assert.equal(result.awaitingCritical,undefined);
      assert.equal(ctx.caster.pendingSpell,pending);assert.equal(ctx.caster.focusSpell.criticalChoice,null);
      assert.equal(ctx.caster.focusSpell.critical,false);assert.deepEqual(ctx.caster.focusSpell.targetIds,['foe']);
    }
  }
});

test('Detect Thoughts gives round-one dialogue, round-two target-specific party modifiers, and one Luck event per casting',()=>{
  const ctx=scene();ctx.state.entities.push({id:'gold',type:'treasure',name:'Golden Crown',x:7,y:4,roomId:'room'});
  ready(ctx,'detect thoughts');const initial=resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  assert.equal(initial.dialogs[0].text,'You peer into the mind of a Bandit and learn some interesting stuff.');
  assert.deepEqual(detectThoughtsModifiers(ctx.state,ctx.ally,ctx.monster),{armorClass:0,attack:0,damage:0});
  const secondRound=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(12)});
  assert.equal(secondRound.dialogs[0].text,'You learn how this Bandit fights.');
  assert.deepEqual(detectThoughtsModifiers(ctx.state,ctx.ally,ctx.monster),{armorClass:1,attack:1,damage:1});
  assert.deepEqual(detectThoughtsModifiers(ctx.state,ctx.ally,ctx.second),{armorClass:0,attack:0,damage:0});
  let luck=0;const options={checkRoll:check(12),grantLuck:()=>luck++};
  const third=maintainTierTwoFocus(ctx.state,ctx.caster,options);assert.equal(luck,1);assert.equal(third.events[0].applied,true);
  assert.equal(third.dialogs[0].text,'You really get this Bandit.');
  assert.deepEqual(maintainTierTwoFocus(ctx.state,ctx.caster,options).dialogs,[]);assert.equal(luck,1);
  const restored=hydrateDungeonState(serializeDungeonState(ctx.state));
  maintainTierTwoFocus(restored,restored.characters[0],options);assert.equal(luck,1);
  endWizardTierTwoFocus(ctx.state,ctx.caster);ready(ctx,'detect thoughts');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  advanceTierTwoFocus(ctx.state,2,options);assert.equal(luck,2);
});

test('Detect Thoughts critical doubles AC/hit, not damage; WIS resistance uses the latest casting total and ends its modifiers',()=>{
  const ctx=scene();ready(ctx,'detect thoughts',20,'bonus');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(12,19)});
  assert.deepEqual(detectThoughtsModifiers(ctx.state,ctx.ally,ctx.monster),{armorClass:2,attack:2,damage:1});
  let result=resolveDetectThoughtsResistance(ctx.state,ctx.monster,{turnKey:'first',checkRoll:check(12,18)});
  assert.equal(result[0].dc,19);assert.equal(result[0].check.modifier,1);assert.equal(result[0].resisted,false);
  assert.deepEqual(resolveDetectThoughtsResistance(ctx.state,ctx.monster,{turnKey:'first',checkRoll:()=>assert.fail()}),[]);
  result=resolveDetectThoughtsResistance(ctx.state,ctx.monster,{turnKey:'second',checkRoll:check(12,19)});
  assert.equal(result[0].resisted,true);assert.equal(result[0].detected,true);assert.equal(ctx.caster.focusSpell,null);
  assert.deepEqual(detectThoughtsModifiers(ctx.state,ctx.ally,ctx.monster),{armorClass:0,attack:0,damage:0});
  assert.equal((ctx.caster.failedSpellKeys||[]).includes('detect thoughts'),false);
});

test('Detect Thoughts requires one visible monster within six squares and unhandled Luck emits only once',()=>{
  const ctx=scene();ready(ctx,'detect thoughts');
  assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:ctx.ally.id}),/monster/);
  ctx.monster.x=10;assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'}),/range/);
  ctx.monster.x=6;resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  const results=advanceTierTwoFocus(ctx.state,3,{checkRoll:check(12)});
  const events=results.flatMap(result=>result.events||[]);assert.equal(events.length,1);assert.equal(events[0].applied,false);
});

test('Hold Person validates humanoid and level, applies source-tagged paralysis, and cleans up on ordinary focus failure',()=>{
  const ctx=scene();ready(ctx,'hold person');ctx.monster.level=5;
  assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'}),/level 4/);
  ctx.monster.level=4;resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  assert.equal(ctx.monster.conditions.paralyzed.casterId,ctx.caster.id);
  assert.equal(ctx.monster.conditions.paralyzed.focusId,ctx.caster.focusSpell.id);
  maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(2)});
  assert.equal(ctx.monster.conditions.paralyzed,undefined);assert.equal(ctx.monster.conditions.holdPersonSources,undefined);
});

test('Hold Person critical supports level eight or two sequential distinct humanoids',()=>{
  let ctx=scene();ready(ctx,'hold person',20,'level');ctx.monster.level=8;
  resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});assert.ok(ctx.monster.conditions.paralyzed);
  ctx=scene();ready(ctx,'hold person',20,'targets');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  assert.equal(ctx.caster.pendingSpell.remaining,1);assert.throws(()=>resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'}),/different/);
  resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'second'});assert.equal(ctx.caster.pendingSpell,null);
  assert.ok(ctx.monster.conditions.paralyzed);assert.ok(ctx.second.conditions.paralyzed);
  endWizardTierTwoFocus(ctx.state,ctx.caster);assert.equal(ctx.monster.conditions.paralyzed,undefined);assert.equal(ctx.second.conditions.paralyzed,undefined);
});

test('paralysis cleanup preserves another caster and unrelated prior paralysis, including when external code clears focus',()=>{
  const ctx=scene();ctx.monster.conditions={paralyzed:{source:'trap'}};
  ready(ctx,'hold person');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe'});
  const other={...ctx.caster,id:'wizard2',name:'Wizard2',focusSpell:null,pendingSpell:null,raw:{}};ctx.state.characters.push(other);
  castFocusedSpell(ctx.state,other,'hold person',{checkRoll:check(12)});resolveFocusedSpell(ctx.state,other,{targetId:'foe'});
  endWizardTierTwoFocus(ctx.state,ctx.caster);assert.equal(ctx.monster.conditions.paralyzed.casterId,'wizard2');
  other.focusSpell=null;cleanupWizardTierTwoFocus(ctx.state);assert.deepEqual(ctx.monster.conditions.paralyzed,{source:'trap'});
});

test('caster death ends focus, caster-turn keys prevent duplicate ticks, and combat global advance cannot double-cast maintenance',()=>{
  const ctx=scene();ctx.state.combat={active:true,round:1};ready(ctx,'acid arrow');resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',random:()=>0});
  assert.equal(maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:()=>assert.fail()}).skipped,true);
  assert.deepEqual(advanceTierTwoFocus(ctx.state,1,{checkRoll:()=>assert.fail()}),[]);
  ctx.state.combat.round=2;maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(12),random:()=>0});
  assert.equal(ctx.monster.hp,48);assert.equal(maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:()=>assert.fail()}).skipped,true);
  ctx.caster.hp=0;cleanupWizardTierTwoFocus(ctx.state);assert.equal(ctx.caster.focusSpell,null);
});

test('injected damage and defeat handlers own side effects exactly once; killing one of two targets preserves the other',()=>{
  const ctx=scene();ready(ctx,'acid arrow',20,'targets');let applications=0,defeats=0;
  const options={random:()=>0,applyDamage:(state,target,damage)=>{applications++;target.hp-=damage;},
    onDefeat:(state,target)=>{defeats++;target.defeated=true;}};
  resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'foe',...options});ctx.second.hp=1;
  resolveFocusedSpell(ctx.state,ctx.caster,{targetId:'second',...options});
  assert.equal(applications,2);assert.equal(defeats,1);assert.equal(ctx.monster.hp,49);assert.ok(ctx.caster.focusSpell);
  maintainTierTwoFocus(ctx.state,ctx.caster,{...options,checkRoll:check(12)});assert.equal(applications,3);assert.equal(defeats,1);
});

test('generic maintenance supports marked tier-two Levitate/Silence without granting critical effects',()=>{
  const ctx=scene();
  for(const spell of ['levitate','silence']) {
    ctx.caster.focusSpell={spell,tier:1,focusedRounds:1,lastCheck:15};
    assert.equal(maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:()=>assert.fail()}),null);
    ctx.caster.focusSpell.tier=2;
    let applied=0,ended=0;
    const result=maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(20),
      onCriticalChoice:()=>applied++});
    assert.equal(result.succeeded,true);assert.equal(result.awaitingCritical,undefined);
    assert.equal(ctx.caster.pendingSpell,undefined);assert.equal(applied,0);
    assert.equal(ctx.caster.focusSpell.radius,undefined);assert.equal(ctx.caster.focusSpell.focusedRounds,2);
    maintainTierTwoFocus(ctx.state,ctx.caster,{checkRoll:check(2),onFocusEnd:()=>ended++});assert.equal(ended,1);
    assert.equal(ctx.caster.focusSpell,null);assert.equal((ctx.caster.failedSpellKeys||[]).includes(spell),false);
  }
});
