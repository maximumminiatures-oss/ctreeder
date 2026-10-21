import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMonsterCompanion, ensureMonsterCompanionTraits } from '../../S3_content/src/companions.js';
import { canSeeWithDarkvision, companionEquipmentClass, darkvisionCells, isDarkvisionCharacter,
  isTilePhysicallyIlluminated, partyDarkvisionReveals, tileIntersectsLightPolygon, tileIntersectsLightRadius } from '../../S3_content/src/darkvision.js';
import { isMonsterCurrentlyVisible, darknessAttackMode, markMonsterCorrectlyGuessed, monsterCanSeeTarget,
  shouldRepositionAfterDarkGuess } from '../../S3_content/src/monster-perception.js';

const monster = extra => ({ id:'orc', type:'monster', name:'Orc', S:2, I:0, hp:10, ac:12, x:2,y:2, ...extra });
function scene() {
  return { map:{width:20,height:8}, tiles:Array.from({length:160},(_,i)=>({x:i%20,y:Math.floor(i/20),type:'floor'})),
    characters:[],entities:[],rooms:[],player:{x:0,y:0},visibility:{visibleNow:new Set(),exploredEver:new Set()} };
}

test('friendly and charmed companions gain stored Darkvision and fighter proficiency without becoming lights', () => {
  for (const kind of ['friendly','charmed']) {
    const character = buildMonsterCompanion(monster(),{kind});
    assert.equal(isDarkvisionCharacter(character),true); assert.equal(companionEquipmentClass(character),'fighter');
    assert.equal(character.companion.proficiencyClass,'Fighter'); assert.equal(character.companion.darkvisionRadius,12);
    assert.equal(character.bonuses.filter(bonus=>bonus.name==='Darkvision').length,1);
    assert.equal(character.bonuses[0].bonusName,"Darkvision 60'");
    assert.equal(character.lightRadius,undefined); assert.equal(character.languages,'Orcish');
    ensureMonsterCompanionTraits(character); assert.equal(character.bonuses.length,1);
  }
  assert.equal(companionEquipmentClass(buildMonsterCompanion(monster(),{kind:'doppelganger'})),null);
});

test('companion vision reveals dim cells and creatures out to twelve squares without illuminating a human', () => {
  const state=scene(), companion=buildMonsterCompanion(monster()), target=monster({id:'foe',x:14});
  state.characters=[companion]; state.entities=[target];
  assert.equal(canSeeWithDarkvision(state,companion,target),true);
  assert.equal(partyDarkvisionReveals(state,target),true);
  assert.equal(isMonsterCurrentlyVisible(state,target),true);
  assert.ok(darkvisionCells(state).some(cell=>cell.x===14&&cell.y===2));
  assert.equal(state.visibility.visibleNow.size,0); assert.equal(state.visibility.exploredEver.size,0);
  assert.equal(isTilePhysicallyIlluminated(state,target),false);
  target.x=15; assert.equal(partyDarkvisionReveals(state,target),false);
  const human={id:'human',hp:8,x:2,y:2}; assert.equal(canSeeWithDarkvision(state,human,target),false);
});

test('darkvision respects walls, closed eyes, dead observers, viewer ownership and route context', () => {
  const state=scene(), companion=buildMonsterCompanion(monster()), target=monster({id:'foe',x:4});
  state.characters=[companion]; state.tiles[2*20+3].type='wall';
  assert.equal(partyDarkvisionReveals(state,target),false);
  state.tiles[2*20+3].type='floor'; companion.conditions={sleeping:{}};
  assert.equal(partyDarkvisionReveals(state,target),false);
  companion.conditions={}; companion.hp=0; assert.equal(partyDarkvisionReveals(state,target),false);
  companion.hp=10; state.viewerCharacterIds=new Set(['other']); assert.equal(partyDarkvisionReveals(state,target),false);
  delete state.viewerCharacterIds;
  state.entities=[{subtype:'door',type:'feature',x:3,y:2,wallSide:'east',hallDirection:'east',doorState:'closed'}];
  assert.equal(partyDarkvisionReveals(state,target),false);
  state.entities=[];
  state.underpasses=[{id:'below',lowerCells:[{x:2,y:2},{x:3,y:2},{x:4,y:2}],upperCrossings:[{x:2,y:2},{x:4,y:2}],portals:[]}];
  companion.routeId='below';target.routeId=''; assert.equal(partyDarkvisionReveals(state,target),false);
});

test('a partly illuminated monster is visible even when its center tile was not added to visibleNow', () => {
  const state=scene(), human={id:'human',hp:8,x:1,y:3,lightRadius:2.05}, target=monster({x:4,y:3});
  state.characters=[human];state.entities=[target];
  assert.equal(isMonsterCurrentlyVisible(state,target),true);
  human.lightRadius=1.9;assert.equal(isMonsterCurrentlyVisible(state,target),false);
});

test('a narrow light sliver counts even when the tile center and existing sample points are dark', () => {
  const tile={x:5,y:4}, sliver=[[5,4],[5.03,4],[5.03,5],[5,5]];
  assert.equal(tileIntersectsLightPolygon(tile,sliver),true);
  assert.equal(tileIntersectsLightPolygon(tile,[[6.1,4],[6.2,4],[6.2,5],[6.1,5]]),false);
  assert.equal(tileIntersectsLightPolygon(tile,[[-1,4.01],[10,4.01],[10,4.02],[-1,4.02]]),true);
  assert.equal(tileIntersectsLightRadius({x:6,y:0},{x:0,y:0,radius:5.6}),true);
  assert.equal(tileIntersectsLightRadius({x:7,y:0},{x:0,y:0,radius:5.6}),false);
  const polygon=sliver.map(point=>point.map(value=>value*54));
  assert.equal(isTilePhysicallyIlluminated({},tile,{sources:[{x:0,y:4,radius:6}],polygonFor:()=>polygon,tileSize:54}),true);
});

test('monsters can see darkness and gain advantage against humans there; guessed intelligent monsters reposition', () => {
  const state=scene(), foe=monster(), human={id:'human',hp:8,x:4,y:2};
  assert.equal(monsterCanSeeTarget(state,foe,human),true);
  assert.deepEqual(darknessAttackMode(foe,human),{advantage:true,disadvantage:false});
  assert.deepEqual(darknessAttackMode(human,foe),{advantage:false,disadvantage:true});
  human.invisibility={rounds:3}; assert.equal(monsterCanSeeTarget(state,foe,human),false);
  markMonsterCorrectlyGuessed(foe); assert.equal(shouldRepositionAfterDarkGuess(foe),true);
  foe.I=-1; assert.equal(shouldRepositionAfterDarkGuess(foe),false);
  foe.I=0; assert.equal(shouldRepositionAfterDarkGuess(foe,{isIlluminated:()=>true}),false);
  foe.x++; assert.equal(shouldRepositionAfterDarkGuess(foe),false);
});
