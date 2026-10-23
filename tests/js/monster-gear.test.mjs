import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMonsterCompanion, companionLeaves, ensureMonsterGear, nativeGear, transferredMonsterGear } from '../../S3_content/src/companions.js';
import { normalizeCharacterState } from '../../S3_content/src/characters.js';
import { defeatMonster } from '../../S3_content/src/interactions.js';
import { stealableGear } from '../../S3_content/src/thievery.js';

const rawPirate = JSON.parse(readFileSync(new URL('../../S3_content/monsters-1.json', import.meta.url))).find(monster => monster['Monster Name'] === 'Pirate');
function pirate(extra = {}) {
  return { id:'pirate', type:'monster', name:'Pirate', hp:4, maxHp:4, level:1, ac:rawPirate['**AC**'],
    attack:rawPirate['**ATK**'], S:1, D:1, C:0, I:0, W:0, Ch:0, AL:'C', x:2, y:2, roomId:'room', ...extra };
}
function scene(monster) {
  return { seed:42, level:1, characters:[], entities:[monster], map:{width:5,height:5},
    tiles:Array.from({length:25},(_,i)=>({x:i%5,y:Math.floor(i/5),type:'floor',roomId:'room'})), rooms:[], underpasses:[] };
}
const drops = state => state.entities.filter(entity => entity.subtype === 'dropped-equipment');

test('companion alignments use full labels and Leather Armor persists through repeated save normalization', () => {
  for (const [value, expected] of [['C','Chaotic'],['L','Lawful'],['N','Neutral']]) {
    const monster = pirate({ AL:value });
    const character = buildMonsterCompanion(monster, { random:()=>0 });
    assert.equal(character.alignment, expected);
    assert.deepEqual(character.gear.map(item=>item.name), ['Cutlass','Dagger','Leather Armor']);
    assert.equal(character.hp,4); assert.equal(character.maxHitPoints,4); assert.equal(character.stats.STR,12);
    const state = { characters:[character] };
    character.alignment = value; character.gear.find(item=>item.type==='armor').name='Leather';
    for(let i=0;i<3;i++) { normalizeCharacterState(state); state.characters=JSON.parse(JSON.stringify(state.characters)); }
    assert.equal(state.characters[0].alignment,expected);
    assert.equal(state.characters[0].raw.alignment,expected);
    assert.equal(state.characters[0].gear.at(-1).name,'Leather Armor');
    assert.equal(state.characters[0].gear.at(-1).equipped,true);
    assert.equal(state.characters[0].hp,4);
  }
});

test('slain pirates always drop their real weapons and armor independently of the random treasure roll, exactly once', () => {
  const monster=pirate({routeId:'lower'}),state=scene(monster);
  state.underpasses=[{id:'lower',lowerCells:[],upperCrossings:[],portals:[]}];
  const random=Math.random; Math.random=()=>.99;
  try { defeatMonster(state,monster); } finally { Math.random=random; }
  assert.deepEqual(drops(state).map(item=>item.name),['Cutlass','Dagger','Leather Armor']);
  assert.equal(state.entities.some(item=>item.subtype==='monster-loot'),false);
  for(const item of drops(state)) {
    assert.equal(item.routeId,'lower'); assert.equal(item.x,2); assert.equal(item.y,2); assert.equal(item.roomId,'room');
    assert.equal(item.gearItem.equipped,false); assert.equal(item.gearItem.bound,false); assert.equal(item.collected,false);
  }
  assert.equal(drops(state).find(item=>item.name==='Dagger').gearItem.attackBonus,undefined);
  assert.equal(drops(state).find(item=>item.name==='Dagger').gearItem.damage,'1d4');
  assert.deepEqual(monster.gear,[]); assert.deepEqual(monster.carriedGear,[]);
  defeatMonster(state,monster); assert.equal(drops(state).length,3);
});

test('a saved explicit inventory, including an empty one, overrides stat-block inference and preserves item identities', () => {
  const item={instanceId:'unique',name:'Magic Dagger',magic:{kind:'weapon',bonus:2},totalUnits:1,equipped:true};
  const monster=pirate({carriedGear:[item]}),state=scene(monster);
  defeatMonster(state,monster);
  assert.equal(drops(state).length,1); assert.equal(drops(state)[0].gearItem.instanceId,'unique');
  assert.deepEqual(drops(state)[0].gearItem.magic,item.magic);
  const unarmed=pirate({gear:[],carriedGear:[]}),empty=scene(unarmed);
  defeatMonster(empty,unarmed); assert.equal(drops(empty).length,0);
});

test('stealing and save/load do not regenerate weapons at death or when the monster joins the party', () => {
  let monster=pirate(); const entry=stealableGear(monster).find(entry=>entry.item.name==='Dagger');
  assert.ok(entry); monster.gear.splice(entry.index,1);
  monster=JSON.parse(JSON.stringify(monster));
  const companion=buildMonsterCompanion(monster);
  assert.equal(companion.gear.some(item=>item.name==='Dagger'),false);
  const state=scene(monster); defeatMonster(state,monster);
  assert.deepEqual(drops(state).map(item=>item.name),['Cutlass','Leather Armor']);
  const oldSave=pirate({stolenGearNames:['dagger']});
  assert.equal(ensureMonsterGear(oldSave).some(item=>item.name==='Dagger'),false);
});

test('departing companions do not duplicate already-dropped gear if later slain', () => {
  const character=buildMonsterCompanion(pirate()),state={...scene(pirate()),characters:[character],entities:[]};
  companionLeaves(state,character);
  assert.equal(drops(state).length,3);
  defeatMonster(state,state.entities.find(item=>item.type==='monster'));
  assert.equal(drops(state).length,3);
});

test('natural attacks produce no inventory; canonical armor and slots do not alter native combat statistics', () => {
  assert.deepEqual(nativeGear({attack:'2 claw +3 (1d6) and 1 bite +3 (1d8)',ac:'15'}),[]);
  const gear=nativeGear({attack:'1 warhammer +7 (1d10+4)',ac:'15 (mithral chainmail)'});
  assert.equal(gear[0].attackBonus,7); assert.equal(gear[0].damage,'1d10+4');
  const transferred=transferredMonsterGear(gear[0]);
  assert.equal(transferred.attackBonus,undefined); assert.equal(transferred.damage,'1d10');
  assert.equal(gear[0].attackBonus,7);
  assert.equal(gear[1].name,'Mithral Chainmail'); assert.equal(gear[1].slots,1);
});
