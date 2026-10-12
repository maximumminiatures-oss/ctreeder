import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateDungeon } from '../../S3_content/src/generator.js';
import { TILE_SIZE_PX } from '../../S3_content/src/constants.js';
import { computeLightPolygon, computeLightPolygonFromSegments, isPointInPolygon } from '../../S3_content/src/light-geometry.js';
import { reviewedTileLightSegments } from '../../S3_content/src/reviewed-tile-rules.js';
import { hasLineOfSightFrom } from '../../S3_content/src/visibility.js';
import { getOrganicTileData, isOrganicMovementBlockingTile, setOrganicTileMeta } from '../../S3_content/src/organic-tiles.js';

const assets = JSON.parse(readFileSync(new URL('../../S3_content/data/organic-assets.json', import.meta.url)));
const delta = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
const corners = { north: ['nw', 'ne'], east: ['ne', 'se'], south: ['se', 'sw'], west: ['sw', 'nw'] };

function openRoom() {
  const width = 14, height = 10;
  return { map: { width, height }, tiles: Array.from({ length: width * height }, (_, i) => ({
    x: i % width, y: Math.floor(i / width), type: 'floor', meta: {}
  })), rooms: [], entities: [], decor: {} };
}

function lit(polygon, x, y) {
  return isPointInPolygon([(x + 0.5) * TILE_SIZE_PX, (y + 0.5) * TILE_SIZE_PX], polygon);
}

test('reviewed isolated blockers use artist contours; unknown legacy blockers retain pillar geometry', () => {
  const organic = openRoom();
  const pillar = openRoom();
  setOrganicTileMeta(organic.tiles[4 * 14 + 5], 'org-blocks-NWxNExSExSWxNxExSxWx.png');
  pillar.decor.columns = [{ x: 5, y: 4 }];
  const source = { x: 2, y: 4, radius: 9 };
  const actual = computeLightPolygon(organic, source);
  const segments=reviewedTileLightSegments('org-blocks-NWxNExSExSWxNxExSxWx.png',{x:5,y:4,w:1,h:1,turn:0});
  assert.deepEqual(actual,computeLightPolygonFromSegments([2.5*54,4.5*54],9.5*54,segments.map(s=>s.map(p=>p.map(v=>v*54)))));
  assert.equal(lit(actual, 8, 4), false);
  assert.equal(lit(actual, 7, 3), true);
  assert.equal(hasLineOfSightFrom(organic, 2, 4, 8, 4), false);
  assert.equal(hasLineOfSightFrom(organic, 2, 4, 7, 3), true);
  assert.ok(isOrganicMovementBlockingTile(organic.tiles[4 * 14 + 5]));
  setOrganicTileMeta(organic.tiles[4*14+5],'org-blocks-NWxNExSExSWxNxExSxWx99.png');
  assert.deepEqual(computeLightPolygon(organic,source),computeLightPolygon(pillar,source));
});

test('connected movement blockers occlude their filled edges, leaving open sides open', () => {
  const state = openRoom();
  const tile = state.tiles[4 * 14 + 5];
  setOrganicTileMeta(tile, 'org-blocks-NWoNEoSEoSWxNoExSoWo.png');
  const polygon = computeLightPolygon(state, { x: 8, y: 4, radius: 8 });
  assert.equal(isPointInPolygon([5.95*54,4.5*54],polygon),true,'light can enter the open east edge');
  assert.equal(lit(polygon, 5, 4), false, 'the reviewed interior outline still occludes the tile center');
  assert.equal(lit(polygon, 3, 4), false, 'the west edge blocks light');
  assert.equal(hasLineOfSightFrom(state, 8, 4, 5, 4), false);
});

test('physical PNG edge corrections are transformed for rotated and flipped tiles', () => {
  const tile = { meta: {} };
  setOrganicTileMeta(tile, 'org-blocks-NWxNExSEoSWoNxEoSoWx2.png');
  assert.deepEqual(getOrganicTileData(tile).sides, { north: 'o', east: 'o', south: 'x', west: 'x' });
  setOrganicTileMeta(tile, 'org-blocks-NWxNExSEoSWoNxEoSoWx2.png', { rotationTurns: 2 });
  assert.deepEqual(getOrganicTileData(tile).sides, { south: 'o', west: 'o', north: 'x', east: 'x' });
  setOrganicTileMeta(tile, 'org-blocks-NWxNExSEoSWoNxEoSoWx2.png', { flipX: true });
  assert.deepEqual(getOrganicTileData(tile).sides, { north: 'o', west: 'o', south: 'x', east: 'x' });
});

test('organic blockers do not acquire square wall frames along their open edges', () => {
  let checked=0;
  for(const cryptHallways of [false,true]) {
    const state=generateDungeon(72,1,{architecturePattern:'organic',organicAssets:assets,cryptHallways});
    for(const tile of state.tiles) {
      const art=getOrganicTileData(tile);
      if(art?.kind!=='blocks')continue;
      for(const [side,[dx,dy]] of Object.entries(delta)) {
        if(art.sides[side]!=='x')continue;
        const neighbor=state.tiles[(tile.y+dy)*state.map.width+tile.x+dx];
        const adjacent=getOrganicTileData(neighbor);
        if(adjacent?.kind!=='free')continue;
        checked++;
        assert.equal(adjacent.sides[opposite[side]],'x',`${tile.x},${tile.y}/${side}: ${art.asset}`);
      }
    }
  }
  assert.ok(checked>0);
});

test('organic maps preserve connected irregular rooms and narrow straight/L halls', () => {
  let rooms = 0, irregular = 0, hallArt = 0, narrowHallArt = 0, checkedDoors = 0, bends = 0;
  for (const seed of [...Array.from({ length: 45 }, (_, i) => i + 1), 50, 72, 75, 83, 84, 98, 250]) {
    const state = generateDungeon(seed, 1, { architecturePattern: 'organic', organicAssets: assets, cryptHallways: false });
    assert.equal(state.generation.connectivityValid, true, `seed ${seed}`);
    assert.ok(state.rooms.length >= 5);
    for (const room of state.rooms) {
      rooms++;
      if (room.organicTileKeys.length < room.width * room.height) irregular++;
    }
    for (const hall of state.halls) {
      for (const point of hall.tiles) {
        const tile = state.tiles[point.y * state.map.width + point.x];
        const art = getOrganicTileData(tile);
        if (art?.kind !== 'free') continue;
        hallArt++;
        const open = Object.keys(delta).filter((side) => art.sides[side] === 'x');
        if (open.length === 2) {
          narrowHallArt++;
          if (opposite[open[0]] !== open[1]) bends++;
        }
      }
    }
    for (const door of state.entities.filter((e) => e.subtype === 'door' && !String(e.doorKind || '').startsWith('stairs'))) {
      checkedDoors++;
      const axis = door.orientation === 'horizontal' ? ['north', 'south'] : ['west', 'east'];
      let blockers = 0;
      for (const side of axis) {
        const [dx, dy] = delta[side];
        const tile = state.tiles[(door.y + dy) * state.map.width + door.x + dx];
        const art = getOrganicTileData(tile);
        assert.ok(['free', 'blocks'].includes(art?.kind), `neighbor for door ${door.id}, seed ${seed}`);
        if (isOrganicMovementBlockingTile(tile)) blockers++;
        const facing = opposite[side];
        assert.equal(art.sides[facing], 'x');
        for (const corner of corners[facing]) assert.equal(art.corners[corner], 'o', `door jamb ${corner}, seed ${seed}`);
      }
      assert.ok(blockers <= 1, `never block both sides of a door, seed ${seed}`);
    }
  }
  assert.ok(irregular / rooms > 0.65);
  assert.ok(narrowHallArt / hallArt > 0.7);
  assert.ok(bends > 20);
  assert.ok(checkedDoors > 100);
});
