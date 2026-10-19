import { parseOrganicSignature } from '../../S3_content/src/organic-tiles.js';
import { computeLightPolygonFromSegments } from '../../S3_content/src/light-geometry.js';
import { setAssetShadowPaths, sameShadowTrace } from './shadow-paths.mjs';
import { hasFixedSolidMovement, isStatueAsset } from '../../S3_content/src/reviewed-tile-rules.js';

export const CELL = 54;
export const VERSION = 1;
export const MAX_PLACEMENTS = 20000;
const SIDES = ['north', 'east', 'south', 'west'];

export function blankScene() {
  return { version: VERSION, name: 'Organic tile example', width: 32, height: 24,
    background: 'paper', placements: [], token: { x: 8, y: 8, torch: true, radius: 6 },
    reviewed: {}, placementReviewed: {}, lightingReviewed: {}, unreviewed: {}, assetRules: {}, notes: '', explored: [], shadowPaths: [], shadowRules: {} };
}

export function isOrganicAsset(asset) {
  return /(^|[/-])org[-.]|organic|black-org|1x1-org/i.test(asset.name);
}

export function isReviewableAsset(asset) {
  return isOrganicAsset(asset) || /^crypt \d+\.png$/i.test(asset.id);
}

export function sortAssets(assets) {
  const common = ['1-black.png', 'door-closed.png', '__floor__', 'door-open.png',
    'door-portcullis.png', 'plr-1.png', 'u-stair-n.png', 'd-stair-1.png'];
  const rank = a => common.includes(a.id) ? common.indexOf(a.id) :
    isOrganicAsset(a) ? (a.w === 1 && a.h === 1 ? 8 : 9) : 10;
  return [...assets].sort((a, b) => rank(a) - rank(b) ||
    (rank(a) >= 9 ? b.pixelWidth * b.pixelHeight - a.pixelWidth * a.pixelHeight || Math.max(b.w, b.h) - Math.max(a.w, a.h) : 0) ||
    a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

export function dimensions(tile) {
  return tile.turn % 2 ? [tile.h, tile.w] : [tile.w, tile.h];
}

export function transformPoint(tile, [x, y]) {
  if (tile.flipX) x = tile.w - x;
  if (tile.flipY) y = tile.h - y;
  for (let i = 0, w = tile.w, h = tile.h; i < tile.turn; i++) {
    [x, y] = [h - y, x];
    [w, h] = [h, w];
  }
  return [tile.x + x, tile.y + y];
}

export function inverseTransformPoint(tile, [x, y]) {
  x -= tile.x; y -= tile.y;
  let [w, h] = dimensions(tile);
  for (let i = 0; i < tile.turn; i++) { [x, y] = [y, w - x]; [w, h] = [h, w]; }
  if (tile.flipX) x = tile.w - x;
  if (tile.flipY) y = tile.h - y;
  return [x, y];
}

export function addShadowPath(scene, points, tile = null, id = crypto.randomUUID()) {
  const clean = points.filter((point, index) => !index || point.some((value, axis) => value !== points[index - 1][axis]));
  if (clean.length < 2) return null;
  const path = { id, source: 'artist', points: clean.map(point => tile ? inverseTransformPoint(tile, point) : [...point]) };
  const paths = tile ? (tile.shadowPaths ||= []) : (scene.shadowPaths ||= []);
  if (paths.length >= 1000 || path.points.length > 4096) throw new Error('Too many shadow points.');
  paths.push(path);
  if (tile) {
    const rule = setAssetShadowPaths(scene, tile, paths);
    return rule.paths.find(candidate => sameShadowTrace(candidate, path)) || path;
  }
  return path;
}

export function shadowPaths(scene) {
  return [...(scene.shadowPaths || []).map(path => ({ ...path, tileId: null })),
    ...scene.placements.flatMap(tile => (tile.shadowPaths || []).map(path => ({
      ...path, tileId: tile.id, points: path.points.map(point => transformPoint(tile, point))
    })))];
}

function validateShadowPaths(value, width, height, padding = 0) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) throw new Error('Invalid shadow paths.');
  const ids = new Set();
  return value.map(path => {
    if (!path || !Array.isArray(path.points) || path.points.length < 2 || path.points.length > 4096 ||
      path.points.some(point => !Array.isArray(point) || point.length !== 2 ||
        !point.every(Number.isFinite) || point[0] < -padding || point[1] < -padding || point[0] > width+padding || point[1] > height+padding)) {
      throw new Error('Invalid shadow point.');
    }
    const id = String(path.id || crypto.randomUUID());
    if (ids.has(id)) throw new Error('Duplicate shadow path.');
    ids.add(id); return { id, points: path.points.map(point => [...point]),
      ...(['artist','inferred'].includes(path.source) ? { source: path.source } : {}) };
  });
}

export function features(tile) {
  const result = [];
  for (let y = 0; y <= tile.h; y++) for (let x = 0; x <= tile.w; x++) {
    result.push({ key: `p:${x}:${y}`, kind: 'vertex', points: [[x, y]] });
    if (x < tile.w) result.push({ key: `h:${x}:${y}`, kind: 'edge', points: [[x, y], [x + 1, y]] });
    if (y < tile.h) result.push({ key: `v:${x}:${y}`, kind: 'edge', points: [[x, y], [x, y + 1]] });
  }
  return result;
}

export function createPlacement(asset, x, y, id = crypto.randomUUID()) {
  const signature = parseOrganicSignature(asset.name);
  const annotations = {};
  const tile = { id, asset: asset.id, digest: asset.digest, x, y, w: asset.w, h: asset.h,
    turn: 0, flipX: false, flipY: false, movement: /^org-blocks-/.test(asset.name) || asset.id === '1-black.png' || asset.id === 'door-closed.png',
    lightShape: asset.id === '1-black.png' ? 'solid' : asset.id === 'door-closed.png' ? 'door' :
      /^plr-/.test(asset.name) || isStatueAsset(asset.id) || (/^org-blocks-/.test(asset.name) && signature && SIDES.every(s => signature.sides[s] === 'x')) ? 'pillar' : 'edges',
    locked: asset.id === '1-black.png', annotations, confirmed: false };
  if (asset.id === 'door-open.png') tile.lightShape = 'none';
  for (const f of features(tile)) {
    let filled = false;
    if (signature && tile.w === 1 && tile.h === 1) {
      const side = { 'h:0:0': 'north', 'v:1:0': 'east', 'h:0:1': 'south', 'v:0:0': 'west' }[f.key];
      const corner = { 'p:0:0': 'nw', 'p:1:0': 'ne', 'p:1:1': 'se', 'p:0:1': 'sw' }[f.key];
      filled = (side ? signature.sides[side] : signature.corners[corner]) === 'o';
    }
    annotations[f.key] = { movement: filled, light: f.kind === 'edge' && filled, editedMovement: false, editedLight: false };
  }
  applyFixedMovementRules(tile);
  return tile;
}

export function applyFixedMovementRules(tile) {
  if (!hasFixedSolidMovement(tile.asset)) return;
  tile.movement = true;
  if (isStatueAsset(tile.asset)) tile.lightShape = 'pillar';
  for (const annotation of Object.values(tile.annotations)) annotation.movement = true;
}

export function applyLearnedFeatures(tile, asset, learned = {}) {
  const rule = learned[asset.id];
  if (!rule || tile.locked || tile.asset !== asset.id || rule.digest !== asset.digest ||
    tile.digest !== asset.digest || tile.w !== rule.w || tile.h !== rule.h) return 0;
  let changed = 0;
  for (const property of ['movement', 'light']) {
    const edited = property === 'movement' ? 'editedMovement' : 'editedLight';
    for (const [key, value] of Object.entries(rule[property] || {})) {
      const annotation = tile.annotations[key];
      if (!annotation || annotation[edited] || typeof value !== 'boolean' || annotation[property] === value) continue;
      annotation[property] = value;
      changed++;
    }
  }
  return changed;
}

export function applyLearnedRules(scene, assets, learned, partial = {}) {
  scene.unreviewed ||= {};
  let added = 0;
  for (const asset of assets) {
    const rule = learned[asset.id];
    if (!rule || rule.digest !== asset.digest || asset.w !== 1 || asset.h !== 1 ||
      scene.unreviewed[asset.id] === asset.digest || scene.reviewed[asset.id] === asset.digest) continue;
    const template = createPlacement(asset, 0, 0);
    template.movement = rule.movement; template.lightShape = rule.lightShape;
    for (const [key, annotation] of Object.entries(template.annotations)) {
      annotation.movement = rule.movementFeatures.includes(key);
      annotation.light = rule.lightFeatures.includes(key);
    }
    const placed = scene.placements.filter(tile => tile.asset === asset.id);
    // A changed example stays pending; learning never rewrites its geometry.
    if (placed.some(tile => tile.movement !== template.movement || tile.lightShape !== template.lightShape ||
      Object.entries(template.annotations).some(([key, annotation]) =>
        tile.annotations[key]?.movement !== annotation.movement || tile.annotations[key]?.light !== annotation.light))) continue;
    scene.reviewed[asset.id] = asset.digest;
    scene.assetRules[asset.id] = { movement: template.movement, lightShape: template.lightShape,
      annotations: structuredClone(template.annotations) };
    for (const tile of placed) tile.confirmed = true;
    added++;
  }
  for (const asset of assets) {
    if (!partial[asset.id] || scene.reviewed[asset.id] === asset.digest) continue;
    for (const tile of scene.placements.filter(tile => tile.asset === asset.id)) {
      added += applyLearnedFeatures(tile, asset, partial);
    }
  }
  return added;
}

function boxSegments(left, top, right, bottom) {
  return [[[left, top], [right, top]], [[right, top], [right, bottom]],
    [[right, bottom], [left, bottom]], [[left, bottom], [left, top]]];
}

export function lightSegments(scene, bounds = null) {
  const segments = boxSegments(0, 0, scene.width * CELL, scene.height * CELL);
  for (const path of shadowPaths(scene)) for (let i = 1; i < path.points.length; i++) {
    const a = path.points[i - 1], b = path.points[i];
    if (a[0] !== b[0] || a[1] !== b[1]) segments.push([a, b].map(point => point.map(value => value * CELL)));
  }
  for (const tile of scene.placements) {
    const [w, h] = dimensions(tile);
    if (bounds && (tile.x + w < bounds.left || tile.x > bounds.right || tile.y + h < bounds.top || tile.y > bounds.bottom)) continue;
    const left = tile.x * CELL, top = tile.y * CELL;
    const custom = !tile.locked && tile.shadowPaths?.length > 0;
    if (tile.lightShape === 'solid' && !custom) segments.push(...boxSegments(left, top, left + w * CELL, top + h * CELL));
    if (tile.lightShape === 'pillar' && !custom) {
      const cx = left + w * CELL / 2, cy = top + h * CELL / 2;
      segments.push(...boxSegments(cx - CELL / 6, cy - CELL / 6, cx + CELL / 6, cy + CELL / 6));
    }
    if (tile.lightShape === 'door' && !custom) segments.push([[0, tile.h / 2], [tile.w, tile.h / 2]].map(p => transformPoint(tile, p).map(v => v * CELL)));
    for (const f of features(tile)) {
      const rule = tile.annotations[f.key];
      if (!rule?.light || (custom && !rule.editedLight && !rule.profileLight) || (tile.lightShape === 'none' && !rule.editedLight)) continue;
      const points = f.points.map(p => transformPoint(tile, p).map(v => v * CELL));
      if (f.kind === 'edge') segments.push(points);
      else {
        const [x, y] = points[0], inset = CELL / 16;
        segments.push(...boxSegments(x - inset, y - inset, x + inset, y + inset));
      }
    }
  }
  return segments;
}

export function lightPolygon(scene) {
  if (!scene.token.torch) return [];
  const source = [(scene.token.x + 0.5) * CELL, (scene.token.y + 0.5) * CELL];
  const radius = (scene.token.radius + 0.5) * CELL, margin = scene.token.radius + 1;
  const nearby = lightSegments(scene, { left: scene.token.x - margin, right: scene.token.x + margin,
    top: scene.token.y - margin, bottom: scene.token.y + margin });
  const seen = new Set();
  const segments = nearby.filter(([a, b]) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((source[0] - a[0]) * dx + (source[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(source[0] - a[0] - dx * t, source[1] - a[1] - dy * t) > radius + CELL) return false;
    const key = [a.join(','), b.join(',')].sort().join('|');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  return computeLightPolygonFromSegments(source, radius, segments);
}

export function brushCells(from, to) {
  let [x, y] = from.map(Math.floor);
  const [endX, endY] = to.map(Math.floor), dx = Math.abs(endX - x), dy = -Math.abs(endY - y);
  const stepX = x < endX ? 1 : -1, stepY = y < endY ? 1 : -1;
  let error = dx + dy;
  const cells = [];
  while (true) {
    cells.push([x, y]); if (x === endX && y === endY) break;
    const twice = error * 2;
    if (twice >= dy) { error += dy; x += stepX; }
    if (twice <= dx) { error += dx; y += stepY; }
  }
  return cells;
}

export function topPlacementAt(placements, x, y) {
  for (let i = placements.length - 1; i >= 0; i--) {
    const tile = placements[i], [w, h] = dimensions(tile);
    if (x >= tile.x && x < tile.x + w && y >= tile.y && y < tile.y + h) return tile;
  }
  return null;
}

export function applyBrush(scene, kind, cells, blackAsset, options = {}) {
  let changes = 0, limited = false, checkpointed = false;
  const checkpoint = () => { if (!checkpointed) { options.beforeChange?.(); checkpointed = true; } };
  const visited = options.visited || new Set();
  for (const [x, y] of cells) {
    if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) continue;
    const key = `${x},${y}`; if (visited.has(key)) continue; visited.add(key);
    const top = topPlacementAt(kind === 'erase' && options.eraseSource ? options.eraseSource : scene.placements, x + .5, y + .5);
    if (kind === 'paint') {
      if (top?.asset === '1-black.png') continue;
      if (scene.placements.length >= MAX_PLACEMENTS) { limited = true; break; }
      checkpoint(); scene.placements.push(createPlacement(blackAsset, x, y)); changes++;
    } else if (kind === 'erase' && top && scene.placements.includes(top)) {
      checkpoint(); scene.placements.splice(scene.placements.indexOf(top), 1); changes++;
    }
  }
  return { changes, limited };
}

function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function intersects(a, b, c, d) {
  const u = cross(a, b, c), v = cross(a, b, d), s = cross(c, d, a), t = cross(c, d, b);
  return u * v <= 0 && s * t <= 0 && Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) <= Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) &&
    Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) <= Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1]));
}

export function canMoveToken(scene, dx, dy) {
  const { x, y } = scene.token, nx = x + dx, ny = y + dy;
  if (nx < 0 || ny < 0 || nx >= scene.width || ny >= scene.height) return false;
  const a = [x + 0.5, y + 0.5], b = [nx + 0.5, ny + 0.5];
  for (const tile of scene.placements) {
    const [w, h] = dimensions(tile);
    if ((tile.movement || hasFixedSolidMovement(tile.asset)) && intersectsBox(a, b, tile.x, tile.y, tile.x + w, tile.y + h)) return false;
    for (const f of features(tile)) {
      if (!tile.annotations[f.key]?.movement) continue;
      const points = f.points.map(p => transformPoint(tile, p));
      if (f.kind === 'edge' && intersects(a, b, ...points)) return false;
      if (f.kind === 'vertex' && Math.abs(cross(a, b, points[0])) < 0.00001 && points[0][0] >= Math.min(a[0], b[0]) && points[0][0] <= Math.max(a[0], b[0]) && points[0][1] >= Math.min(a[1], b[1]) && points[0][1] <= Math.max(a[1], b[1])) return false;
    }
  }
  return true;
}

function intersectsBox(a, b, l, t, r, bottom) {
  const within = p => p[0] > l && p[0] < r && p[1] > t && p[1] < bottom;
  return within(a) || within(b) || boxSegments(l, t, r, bottom).some(([c, d]) => intersects(a, b, c, d));
}

export function toggleRules(tile, keys, property) {
  if (tile.locked) return false;
  if (property === 'movement' && hasFixedSolidMovement(tile.asset)) { applyFixedMovementRules(tile); return false; }
  if (!keys.length) {
    if (property === 'movement') tile.movement = !tile.movement;
    else tile.lightShape = tile.lightShape === 'solid' ? 'none' : 'solid';
  } else {
    const value = !keys.every(key => tile.annotations[key]?.[property]);
    for (const key of keys) {
      if (!tile.annotations[key]) continue;
      tile.annotations[key][property] = value;
      tile.annotations[key][property === 'movement' ? 'editedMovement' : 'editedLight'] = true;
    }
  }
  tile.confirmed = false;
  return true;
}

export function exportScene(scene, assets, placementRules = {}, lightingRules = {}) {
  const used = new Set(scene.placements.map(t => t.asset));
  return { ...structuredClone(scene), exportedAt: new Date().toISOString(), cellSize: CELL,
    coordinateConvention: 'Placement x/y is top-left after rotation. Annotations use unrotated asset grid coordinates; flips precede clockwise rotation.',
    vertexConvention: 'Movement vertices block diagonal crossings. Light vertices use a 1/8-cell square centered at the vertex.',
    shadowPathConvention: 'Open polylines block light only. Scene paths use map grid units. Tile paths use native asset grid units, may extend outside artwork, follow its transforms, and are shared by exact asset name/digest. Repeated outlines keep the fewest-point version; distinct lines are retained.',
    assets: assets.filter(a => used.has(a.id)).map(a => ({ id: a.id, name: a.name, digest: a.digest, pixelWidth: a.pixelWidth, pixelHeight: a.pixelHeight, w: a.w, h: a.h })),
    needsConfirmation: assets.filter(a => isReviewableAsset(a) && scene.reviewed[a.id] !== a.digest).map(a => a.id),
    needsPlacementConfirmation: assets.filter(a => isReviewableAsset(a) && scene.placementReviewed?.[a.id] !== a.digest && placementRules[a.id]?.digest !== a.digest).map(a=>a.id),
    needsLightingConfirmation: assets.filter(a => lightingRules[a.id]?.digest === a.digest && lightingRules[a.id].reviewReasons.length &&
      scene.lightingReviewed?.[a.id] !== a.digest).map(a=>a.id) };
}

export function validateScene(value, assets) {
  if (!value || value.version !== VERSION || !Number.isInteger(value.width) || !Number.isInteger(value.height) || value.width < 4 || value.height < 4 || value.width > 80 || value.height > 80 || !Array.isArray(value.placements) || value.placements.length > MAX_PLACEMENTS) throw new Error('Invalid debug map.');
  const catalog = new Map(assets.map(a => [a.id, a]));
  const scene = blankScene();
  for (const key of ['width', 'height', 'background', 'name', 'notes']) if (value[key] !== undefined) scene[key] = value[key];
  if (!['paper', 'dungeon'].includes(scene.background)) throw new Error('Unknown background.');
  scene.name = String(scene.name).slice(0, 120); scene.notes = String(scene.notes).slice(0, 10000);
  if (value.study && typeof value.study.id === 'string' && /^[A-Za-z0-9_-]+$/.test(value.study.id) && Number.isInteger(value.study.page) && value.study.page >= 0) {
    scene.study = { id: value.study.id, page: value.study.page };
  }
  for (const item of value.placements) {
    const asset = catalog.get(item.asset);
    if (!asset) throw new Error(`Asset unavailable: ${item.asset}`);
    const tile = createPlacement(asset, 0, 0, String(item.id || crypto.randomUUID()));
    for (const key of ['x', 'y', 'turn']) if (!Number.isInteger(item[key])) throw new Error('Invalid tile coordinate.');
    tile.x = item.x; tile.y = item.y; tile.turn = ((item.turn % 4) + 4) % 4;
    tile.flipX = item.flipX === true; tile.flipY = item.flipY === true;
    const [w, h] = dimensions(tile);
    if (tile.x < 0 || tile.y < 0 || tile.x + w > scene.width || tile.y + h > scene.height) throw new Error('Tile outside map.');
    if (!tile.locked) {
      tile.movement = item.movement === true;
      if (['edges', 'solid', 'pillar', 'door', 'none'].includes(item.lightShape)) tile.lightShape = item.lightShape;
      for (const key of Object.keys(tile.annotations)) if (item.annotations?.[key]) for (const prop of ['movement', 'light', 'editedMovement', 'editedLight']) tile.annotations[key][prop] = item.annotations[key][prop] === true;
      for (const key of Object.keys(tile.annotations)) if (item.annotations?.[key]?.profileLight === true) tile.annotations[key].profileLight = true;
    }
    applyFixedMovementRules(tile);
    tile.confirmed = item.confirmed === true && item.digest === asset.digest;
    if (item.shadowPaths?.length && item.digest === asset.digest && item.w === tile.w && item.h === tile.h) {
      tile.shadowPaths = validateShadowPaths(item.shadowPaths, tile.w, tile.h, 80);
      if (['artist','inferred','mixed'].includes(item.shadowSource)) tile.shadowSource = item.shadowSource;
    }
    scene.placements.push(tile);
  }
  if (!value.token || !Number.isInteger(value.token.x) || !Number.isInteger(value.token.y) || value.token.x < 0 || value.token.y < 0 || value.token.x >= scene.width || value.token.y >= scene.height) throw new Error('Invalid token.');
  scene.token = { x: value.token.x, y: value.token.y, torch: value.token.torch !== false, radius: Math.max(1, Math.min(20, Math.round(Number(value.token.radius) || 6))) };
  scene.shadowPaths = validateShadowPaths(value.shadowPaths, scene.width, scene.height);
  for (const asset of assets) {
    const rule = value.shadowRules?.[asset.id];
    if (rule?.digest !== asset.digest || rule.w !== asset.w || rule.h !== asset.h) continue;
    scene.shadowRules[asset.id] = { digest: asset.digest, w: asset.w, h: asset.h,
      paths: validateShadowPaths(rule.paths, asset.w, asset.h, 80),
      ...(['artist','inferred','mixed'].includes(rule.source) ? { source: rule.source } : {}),
      ...(rule.edited === true ? { edited: true } : {}),
      ...(rule.reviewed === true ? { reviewed: true } : {}),
      ...(typeof rule.revision === 'string' ? { revision: rule.revision.slice(0,80) } : {}) };
  }
  scene.reviewed = Object.fromEntries(assets.filter(a => value.reviewed?.[a.id] === a.digest).map(a => [a.id, a.digest]));
  scene.placementReviewed = Object.fromEntries(assets.filter(a => value.placementReviewed?.[a.id] === a.digest).map(a => [a.id, a.digest]));
  scene.lightingReviewed = Object.fromEntries(assets.filter(a => value.lightingReviewed?.[a.id] === a.digest).map(a => [a.id, a.digest]));
  scene.unreviewed = Object.fromEntries(assets.filter(a => value.unreviewed?.[a.id] === a.digest).map(a => [a.id, a.digest]));
  for (const asset of assets) {
    const rule = value.assetRules?.[asset.id];
    if (!rule || scene.reviewed[asset.id] !== asset.digest || asset.id === '1-black.png') continue;
    const template = createPlacement(asset, 0, 0);
    template.movement = rule.movement === true;
    if (['edges', 'solid', 'pillar', 'door', 'none'].includes(rule.lightShape)) template.lightShape = rule.lightShape;
    for (const key of Object.keys(template.annotations)) if (rule.annotations?.[key]) {
      for (const prop of ['movement', 'light', 'editedMovement', 'editedLight']) template.annotations[key][prop] = rule.annotations[key][prop] === true;
    }
    applyFixedMovementRules(template);
    scene.assetRules[asset.id] = { movement: template.movement, lightShape: template.lightShape, annotations: template.annotations };
    if (rule.shadowPaths?.length) scene.assetRules[asset.id].shadowPaths = validateShadowPaths(rule.shadowPaths, asset.w, asset.h, 80);
  }
  scene.explored = Array.isArray(value.explored) ? value.explored.filter(k => /^\d+,\d+$/.test(k)).slice(0, scene.width * scene.height) : [];
  return scene;
}
