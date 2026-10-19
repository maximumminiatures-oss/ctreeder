export function reorderGear(character,fromIndex,toIndex) {
  const gear=character?.gear;
  if(!Array.isArray(gear)||![fromIndex,toIndex].every(index=>Number.isInteger(index)&&index>=0&&index<gear.length))throw new Error('Choose two existing gear items.');
  if([gear[fromIndex],gear[toIndex]].some(item=>/^backpack$/i.test(String(item.name||'').trim())))throw new Error('The backpack stays in its fixed position.');
  if(fromIndex===toIndex)return false;
  const [item]=gear.splice(fromIndex,1);gear.splice(toIndex,0,item);
  character.raw||={};character.raw.gear=JSON.parse(JSON.stringify(gear));return true;
}
