import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dimensions } from '../tools/tile-debugger/model.mjs';

const [input, output] = process.argv.slice(2);
if (!output) throw Error('Usage: node scripts/build_reviewed_layouts.mjs example.json output.js');
const bytes = readFileSync(input), scene = JSON.parse(bytes);
const regions = [
  { id: 'paired-canal-basins', kind: 'room', box: [16, 3, 8, 12], ports: [['north',3,0],['south',4,11]] },
  { id: 'divided-canal-room', kind: 'room', box: [14, 16, 5, 7], ports: [['east',4,3]], isolatedBank: true, chance: .025 },
  { id: 'internal-wall-room', kind: 'room', box: [4, 17, 8, 6], ports: [['north',5,0]], pendingCustomLight: true },
  { id: 'round-well-room', kind: 'room', box: [7, 7, 5, 5], ports: [['west',0,2],['east',4,2],['south',2,4]] },
  { id: 'water-edge-room', kind: 'room', box: [0, 6, 6, 9], ports: [['north',1,0],['east',5,3]] },
  { id: 'angled-left-hall', kind: 'hall', box: [1, 1, 6, 5], ports: [['south',0,4],['east',5,0]] },
  { id: 'angled-right-hall', kind: 'hall', box: [23, 1, 6, 6], ports: [['west',0,0],['south',5,5]],
    excludeAssets: ['3x3stairs-black.png','wall-n-3.png'],
    excludedFloor: [[5,0],[5,1],[5,2],[5,3],[0,4],[0,5]] },
  { id: 'hall-stair-entrance', kind: 'entrance', box: [28, 0, 4, 4], ports: [['south',0,3]], token: [2,2] }
];
const layouts = regions.map(region => {
  const [left, top, width, height] = region.box;
  const floor = [];
  for (let y=0;y<height;y++) for(let x=0;x<width;x++) {
    if (!region.excludedFloor?.some(([xx,yy])=>xx===x&&yy===y) &&
      !scene.placements.some(tile => tile.asset === '1-black.png' && tile.x === left+x && tile.y === top+y)) floor.push([x,y]);
  }
  const placements = scene.placements.filter(tile => {
    if (tile.asset === '1-black.png' || tile.asset === 'door-closed.png' || region.excludeAssets?.includes(tile.asset)) return false;
    const [w,h]=dimensions(tile);
    return tile.x < left+width && tile.x+w > left && tile.y < top+height && tile.y+h > top;
  }).map(tile => ({ asset:tile.asset,digest:tile.digest,x:tile.x-left,y:tile.y-top,w:tile.w,h:tile.h,
    turn:tile.turn,flipX:tile.flipX,flipY:tile.flipY,movement:tile.movement,lightShape:tile.lightShape,
    annotations:Object.fromEntries(Object.entries(tile.annotations).filter(([,rule])=>rule.movement||rule.light)),
    ...(tile.shadowPaths?.length?{shadowPaths:tile.shadowPaths}:{}) }));
  // Native artwork can spill into the one-cell wall margin, as in the round well example.
  const doors = scene.placements.filter(tile => tile.asset === 'door-closed.png' && tile.x >= left && tile.x < left+width && tile.y >= top && tile.y < top+height)
    .filter(tile => !region.ports.some(([,x,y])=>x===tile.x-left && y===tile.y-top))
    .map(tile=>({x:tile.x-left,y:tile.y-top,orientation:tile.turn%2?'vertical':'horizontal'}));
  const shadowPaths = (scene.shadowPaths || []).filter(path => path.points.every(([x,y]) =>
    x >= left && x <= left+width && y >= top && y <= top+height))
    .map(path => ({ ...path, points: path.points.map(([x,y]) => [x-left,y-top]) }));
  return { ...region, width,height,floor,placements,doors,shadowPaths,box:undefined };
});
const source = { example: input.split(/[\\/]/).pop(), sha256: createHash('sha256').update(bytes).digest('hex') };
writeFileSync(output, '// Generated from an artist-reviewed layout; keep the original export intact.\n' +
  'export const REVIEWED_LAYOUT_SOURCE = '+JSON.stringify(source)+';\n'+
  'export const REVIEWED_LAYOUTS = '+JSON.stringify(layouts,null,2)+';\n');
console.log(JSON.stringify({source,templates:layouts.map(({id,kind,width,height,placements})=>({id,kind,width,height,assets:placements.length}))},null,2));
