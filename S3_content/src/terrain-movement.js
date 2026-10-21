import { REVIEWED_LAYOUTS } from './reviewed-layout-data.js';
import { tileRulePoint, featureSegment } from './reviewed-tile-rules.js';

const assetName = asset => String(asset || '').split(/[\\/]/).pop().replace(/\.png$/i, '');
const waterAsset = asset => /^(?:canal|water)-/.test(assetName(asset)) && !/bridge/.test(assetName(asset));
const waterRules = new Map();
for (const layout of REVIEWED_LAYOUTS) for (const tile of layout.placements) {
  if (!waterAsset(tile.asset)) continue;
  const edges = Object.entries(tile.annotations || {}).filter(([, rule]) => rule.movement).map(([name]) => name);
  if (tile.movement || edges.length) {
    const name = assetName(tile.asset);
    const previous = waterRules.get(name) || new Set();
    for (const edge of edges) previous.add(edge);
    waterRules.set(name, previous);
  }
}

export function isSlowWaterPlacement(tile) {
  return waterAsset(tile.asset || tile.assetKey) && (tile.movement === true || tile.blocksMovement === true ||
    waterRules.has(assetName(tile.asset || tile.assetKey)) ||
    Object.values(tile.annotations || {}).some(rule => rule.movement));
}

const caches = new WeakMap();
const EMPTY = Object.freeze([]);
const segmentKey = ([a, b]) => [a.join(','), b.join(',')].sort().join(':');

function terrainIndex(state) {
  const reviewed = state.decor?.reviewed || EMPTY, canals = state.decor?.canals || EMPTY;
  let index = caches.get(state);
  if (index && index.reviewed === reviewed && index.canals === canals &&
      index.reviewedLength === reviewed.length && index.canalsLength === canals.length) return index;
  index = { reviewed, canals, reviewedLength: reviewed.length, canalsLength: canals.length, cells: new Set(), segments: new Set() };
  for (const tile of [...reviewed, ...canals]) {
    if (!isSlowWaterPlacement(tile)) continue;
    const pose = { x: Number(tile.x), y: Number(tile.y), w: tile.gridWidthTiles || tile.widthTiles || 1,
      h: tile.gridHeightTiles || tile.heightTiles || 1, turn: tile.rotationTurns || 0, flipX: tile.flipX, flipY: tile.flipY };
    const width = pose.turn % 2 ? pose.h : pose.w, height = pose.turn % 2 ? pose.w : pose.h;
    if (Array.isArray(tile.blocks)) {
      for (const point of tile.blocks) index.cells.add(point.x + ',' + point.y);
    } else for (let y = pose.y; y < pose.y + height; y++) for (let x = pose.x; x < pose.x + width; x++) index.cells.add(x + ',' + y);
    // Old saves contain anonymous edges; remove only edges authored by water assets.
    for (const edge of waterRules.get(assetName(tile.assetKey)) || []) {
      index.segments.add(segmentKey(featureSegment(edge).map(point => tileRulePoint(pose, point))));
    }
  }
  caches.set(state, index);
  return index;
}

export function isSlowWaterTile(state, x, y) {
  const tile = state.tiles?.[y * state.map?.width + x];
  return Boolean(tile && tile.x === x && tile.y === y && tile.type === 'floor' &&
    (tile.meta?.slowWater || terrainIndex(state).cells.has(x + ',' + y)));
}

export function isLegacyWaterMovementSegment(state, segment) {
  return terrainIndex(state).segments.has(segmentKey(segment));
}

export const movementStepCost = (state, x, y, creature = null) => {
  const ignoresWater = creature?.transformationEffects?.some(effect => effect.spell === 'levitate' ||
    effect.spell === 'alter self' && effect.rounds > 0 && effect.features?.includes('gills'));
  return !ignoresWater && isSlowWaterTile(state, x, y) ? 2 : 1;
};
export const WATER_STEP_DURATION_MS = 320;
export const movementOverlayRadius = (state, x, y, points, creature = null) => points / movementStepCost(state, x, y, creature);
