import createElement from './node_modules/lucide/dist/esm/createElement.js';
import { CELL, MAX_PLACEMENTS, blankScene, sortAssets, isReviewableAsset, createPlacement, dimensions,
  transformPoint, features, lightPolygon, canMoveToken, toggleRules, exportScene, validateScene, brushCells, applyBrush, applyLearnedRules, applyLearnedFeatures,
  addShadowPath, shadowPaths, applyFixedMovementRules } from './model.mjs';
import { applyShadowRules, applyAssetShadowRule, setAssetShadowPaths } from './shadow-paths.mjs';
import { LEARNED_SHADOW_RULES } from '../../S3_content/src/tile-shadow-rules.js';
import { LEARNED_PLACEMENT_RULES } from './learned-placement-rules.mjs';
import { ORGANIC_LIGHTING_RULES } from './organic-lighting-drafts.mjs';
import { applyOrganicLightingRules } from './lighting-rules.mjs';
import { LEARNED_TILE_RULES, LEARNED_FEATURE_RULES } from './learned-rules.mjs';
import { isPointInPolygon } from '../../S3_content/src/light-geometry.js';

const $ = id => document.getElementById(id);
await Promise.all([...document.querySelectorAll('[data-icon]')].map(async node => {
  const { default: icon } = await import(`./node_modules/lucide/dist/esm/icons/${node.dataset.icon}.js`);
  const svg = createElement(icon); svg.setAttribute('aria-hidden', 'true'); node.replaceWith(svg);
}));
const canvas = $('map'), ctx = canvas.getContext('2d'), viewport = $('viewport');
const terrain = document.createElement('canvas'), fog = document.createElement('canvas');
const images = new Map(), tilesSelected = new Set(), featuresSelected = new Set();
const history = [], future = [];
const BASE_STORAGE = 'shadowspawner-tile-workbench-v1';
const SHADOW_STORAGE = `${BASE_STORAGE}:asset-shadows`;
const SHADOW_DEFAULTS = { ...LEARNED_SHADOW_RULES, ...ORGANIC_LIGHTING_RULES };
let shadowLibrary = {};
let STORAGE = BASE_STORAGE, study = null, studyIndex = 0;
let assets = [], catalog, scene = blankScene(), mode = 'tile', lighting = false, picked = null;
let zoom = 1, pan = [24, 24], terrainDirty = true, pendingDraw = false, ready = false;
let dragging = null, saveTimer, polygon = [], explored = new Set(), outputDirectory;
let pickerDrag = null, suppressPickerClickUntil = 0;
let needsSave = false;
let shadowDraft = null, shadowHover = null, selectedShadow = null;
function useShadowLibrary() {
  Object.assign(scene.shadowRules, structuredClone(shadowLibrary));
  applyShadowRules(scene, assets, SHADOW_DEFAULTS);
}
function publishShadowLibrary() {
  for (const tile of scene.placements) if (shadowLibrary[tile.asset] && !scene.shadowRules[tile.asset]) {
    scene.shadowRules[tile.asset] = { digest: tile.digest, w: tile.w, h: tile.h, paths: [] };
  }
  Object.assign(shadowLibrary, structuredClone(scene.shadowRules));
  localStorage.setItem(SHADOW_STORAGE, JSON.stringify(shadowLibrary));
}
const dragPreview = document.createElement('canvas'); dragPreview.id = 'drag-preview';
dragPreview.width = dragPreview.height = 72; dragPreview.hidden = true; document.body.append(dragPreview);

function status(message) { $('status').textContent = message; }
function imageFor(id) { return images.get(id); }
function activeTile() { return scene.placements.find(t => tilesSelected.has(t.id)); }
function selectedKeys(tile) {
  return [...featuresSelected].filter(k => k.startsWith(tile.id + '|')).map(k => k.slice(tile.id.length + 1));
}
function historyPoint() {
  scene.explored = [...explored]; history.push(structuredClone(scene));
  if (history.length > 80) history.shift(); future.length = 0;
}
function persist() {
  needsSave = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 180);
}
function saveNow() {
  clearTimeout(saveTimer);
  if (!ready || !needsSave) return;
  scene.explored = [...explored];
  try { localStorage.setItem(STORAGE, JSON.stringify(scene)); needsSave = false; }
  catch { status('Browser storage full. Use Output to retain this map.'); }
}
function changed(art = true) {
  terrainDirty ||= art; updateLighting(); refreshInspector(); requestDraw(); persist();
}
function requestDraw() {
  if (!pendingDraw) { pendingDraw = true; requestAnimationFrame(() => { pendingDraw = false; draw(); }); }
}
function pointAt(event) {
  const rect = canvas.getBoundingClientRect();
  return [(event.clientX - rect.left - pan[0]) / zoom / CELL, (event.clientY - rect.top - pan[1]) / zoom / CELL];
}
function topTile(point) {
  return [...scene.placements].reverse().find(t => {
    const [w, h] = dimensions(t);
    return point[0] >= t.x && point[0] < t.x + w && point[1] >= t.y && point[1] < t.y + h;
  });
}
function featureAt(point, candidates, kind = null) {
  const threshold = 8 / (zoom * CELL);
  let best = null, distance = threshold;
  for (const tile of candidates) for (const f of features(tile)) {
    if (kind && f.kind !== kind) continue;
    const points = f.points.map(p => transformPoint(tile, p));
    let d;
    if (f.kind === 'vertex') d = Math.hypot(point[0] - points[0][0], point[1] - points[0][1]);
    else {
      const [a, b] = points, dx = b[0] - a[0], dy = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy)));
      d = Math.hypot(point[0] - a[0] - t * dx, point[1] - a[1] - t * dy);
    }
    if (d <= distance && !(best?.feature.kind === 'vertex' && f.kind === 'edge')) {
      distance = d; best = { tile, feature: f };
    }
  }
  return best;
}
function clearSelection() { tilesSelected.clear(); featuresSelected.clear(); selectedShadow = null; }
function setMode(value) {
  if (mode === 'shadow' && value !== mode) finishShadow();
  mode = value;
  for (const button of document.querySelectorAll('button[data-mode]')) button.setAttribute('aria-pressed', button.dataset.mode === mode);
  if (['token', 'paint', 'erase'].includes(mode)) clearSelection();
  viewport.dataset.mode = mode;
  picked = null; refreshInspector(); requestDraw(); viewport.focus();
}

function refreshPicker() {
  const query = $('search').value.toLowerCase(), onlyPending = $('pending-only').checked;
  const filtered = assets.filter(a => a.name.toLowerCase().includes(query) && (!onlyPending || needsReview(a)));
  const fragment = document.createDocumentFragment();
  for (const asset of filtered) {
    const button = document.createElement('button'); button.className = 'tile-option';
    button.draggable = false; button.dataset.asset = asset.id;
    button.title = `${asset.name} (${asset.w} x ${asset.h})${needsReview(asset) ?
      (needsPlacementReview(asset) ? ' - placement pending' : ' - placement understood; lighting/rules pending') : ''}`;
    button.setAttribute('aria-label', button.title); button.setAttribute('role', 'listitem');
    const img = imageFor(asset.id); img.alt = ''; img.draggable = false;
    if (asset.crop) { img.style.objectFit = 'none'; img.style.objectPosition = 'left top'; }
    button.append(img);
    if (needsReview(asset)) {
      const dot = document.createElement('i'); dot.className = needsPlacementReview(asset) ? 'pending-dot' : 'pending-dot lighting-dot'; button.append(dot);
    }
    const name = document.createElement('span'); name.textContent = asset.id === '__floor__' ? 'Paper floor' : asset.name.replace(/\.png$/i, ''); button.append(name);
    button.addEventListener('click', () => {
      if (performance.now() < suppressPickerClickUntil) return;
      setMode('tile');
      picked = asset.id; clearSelection();
      for (const b of $('picker').children) b.classList.toggle('active', b === button);
      status(asset.name); refreshInspector(); requestDraw(); viewport.focus();
    });
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      pickerDrag = { asset, button, pointerId: event.pointerId, start: [event.clientX, event.clientY], active: false };
      button.setPointerCapture(event.pointerId);
    });
    button.addEventListener('pointermove', movePickerDrag);
    button.addEventListener('pointerup', finishPickerDrag);
    button.addEventListener('pointercancel', cancelPickerDrag);
    button.addEventListener('lostpointercapture', cancelPickerDrag);
    fragment.append(button);
  }
  $('picker').replaceChildren(fragment);
  $('asset-count').textContent = `${filtered.length} / ${assets.length} assets`;
  $('pending-count').textContent = `${assets.filter(needsPlacementReview).length} placement gaps | ${assets.filter(needsRuleReview).length} rule gaps`;
}
function movePickerDrag(event) {
  if (!pickerDrag || event.pointerId !== pickerDrag.pointerId) return;
  if (!pickerDrag.active && Math.hypot(event.clientX - pickerDrag.start[0], event.clientY - pickerDrag.start[1]) < 6) return;
  if (!pickerDrag.active) {
    pickerDrag.active = true; dragPreview.hidden = false;
    const target = dragPreview.getContext('2d'), image = imageFor(pickerDrag.asset.id);
    target.clearRect(0, 0, 72, 72); target.fillStyle = '#d3d5d2'; target.fillRect(0, 0, 72, 72);
    const scale = Math.min(64 / pickerDrag.asset.pixelWidth, 64 / pickerDrag.asset.pixelHeight);
    target.drawImage(image, 4, 4, pickerDrag.asset.pixelWidth * scale, pickerDrag.asset.pixelHeight * scale);
  }
  dragPreview.style.left = `${event.clientX + 12}px`; dragPreview.style.top = `${event.clientY + 12}px`;
  event.preventDefault();
}
function cancelPickerDrag() {
  if (!pickerDrag) return;
  const drag = pickerDrag; pickerDrag = null; dragPreview.hidden = true;
  if (drag.button.hasPointerCapture(drag.pointerId)) drag.button.releasePointerCapture(drag.pointerId);
}
function finishPickerDrag(event) {
  if (!pickerDrag || event.pointerId !== pickerDrag.pointerId) return;
  const drag = pickerDrag, rect = canvas.getBoundingClientRect();
  if (drag.active) {
    suppressPickerClickUntil = performance.now() + 250;
    const point = pointAt(event);
    if (event.clientX >= rect.left && event.clientX < rect.right && event.clientY >= rect.top && event.clientY < rect.bottom && point[0] >= 0 && point[1] >= 0 && point[0] < scene.width && point[1] < scene.height) {
      place(drag.asset.id, ...point); viewport.focus();
      saveNow();
    }
  }
  cancelPickerDrag();
}
function needsRuleReview(asset) {
  if (!isReviewableAsset(asset)) return false;
  if (scene.unreviewed[asset.id] === asset.digest) return true;
  const profile = ORGANIC_LIGHTING_RULES[asset.id];
  if (profile?.digest === asset.digest && profile.reviewed && !profile.reviewReasons.length) return false;
  return scene.reviewed[asset.id] !== asset.digest ||
    (profile?.reviewReasons.length > 0 && scene.lightingReviewed[asset.id] !== asset.digest);
}
function needsPlacementReview(asset) { return isReviewableAsset(asset) && scene.placementReviewed[asset.id] !== asset.digest && LEARNED_PLACEMENT_RULES[asset.id]?.digest !== asset.digest; }
function needsReview(asset) { return needsPlacementReview(asset) || needsRuleReview(asset); }
function refreshInspector() {
  const tile = activeTile(), keys = tile ? selectedKeys(tile) : [];
  const asset = tile ? catalog.get(tile.asset) : picked ? catalog.get(picked) : null;
  $('selection-name').textContent = asset?.name || (mode === 'token' ? 'Character token' : 'No selection');
  $('selection-details').textContent = tile ? `${tile.x}, ${tile.y} | ${dimensions(tile).join(' x ')} | Layer ${scene.placements.indexOf(tile) + 1}${keys.length ? ' | ' + keys.join(', ') : ''}${tile.locked ? ' | Locked blocker' : ''}` :
    mode === 'token' ? `${scene.token.x}, ${scene.token.y}` : '';
  const mutable = tile && !tile.locked;
  for (const id of ['movement', 'light-shape', 'edge-light', 'confirmed', 'duplicate', 'delete', 'flip-x', 'flip-y']) $(id).disabled = !tile || (!mutable && ['movement', 'light-shape', 'edge-light'].includes(id));
  $('movement').checked = tile ? (keys.length ? keys.every(k => tile.annotations[k].movement) : tile.movement) : false;
  $('movement').indeterminate = keys.length && keys.some(k => tile.annotations[k].movement) && !keys.every(k => tile.annotations[k].movement);
  $('edge-light').checked = keys.length && keys.every(k => tile.annotations[k].light);
  $('edge-light').indeterminate = keys.length && keys.some(k => tile.annotations[k].light) && !keys.every(k => tile.annotations[k].light);
  $('edge-light-row').hidden = !keys.length; $('light-shape-row').hidden = Boolean(keys.length);
  $('light-shape').value = tile?.lightShape || 'edges'; $('confirmed').checked = tile ? scene.reviewed[tile.asset] === tile.digest : false;
  for (const b of document.querySelectorAll('[data-turn]')) { b.disabled = !tile; b.setAttribute('aria-pressed', Boolean(tile && tile.turn === Number(b.dataset.turn))); }
  $('flip-x').setAttribute('aria-pressed', Boolean(tile?.flipX)); $('flip-y').setAttribute('aria-pressed', Boolean(tile?.flipY));
  $('undo').disabled = !history.length; $('redo').disabled = !future.length;
  if (selectedShadow) {
    $('selection-name').textContent = 'Shadow line';
    $('selection-details').textContent = selectedShadow.tileId ? 'Attached to tile' : 'Map coordinates';
    $('delete').disabled = false;
  }
}
function updateControls() {
  $('map-name').value = scene.name; $('notes').value = scene.notes; $('background').value = scene.background;
  $('map-width').value = scene.width; $('map-height').value = scene.height;
  $('torch').checked = scene.token.torch; $('radius').value = scene.token.radius;
  refreshInspector(); refreshPicker();
}
function revokeConfirmation(tile) {
  delete scene.reviewed[tile.asset]; delete scene.assetRules[tile.asset];
  delete scene.lightingReviewed[tile.asset];
  scene.unreviewed[tile.asset] = tile.digest;
  for (const t of scene.placements.filter(t => t.asset === tile.asset)) t.confirmed = false;
}
function applyRules(property) {
  const targets = scene.placements.filter(t => tilesSelected.has(t.id) && !t.locked);
  if (!targets.length) return;
  historyPoint();
  for (const tile of targets) { toggleRules(tile, selectedKeys(tile), property); revokeConfirmation(tile); }
  refreshPicker(); changed(false);
}
function confirmTile(checked) {
  const tile = activeTile(); if (!tile) return;
  historyPoint();
  if (checked) {
    delete scene.unreviewed[tile.asset];
    scene.reviewed[tile.asset] = tile.digest;
    scene.placementReviewed[tile.asset] = tile.digest;
    scene.lightingReviewed[tile.asset] = tile.digest;
    setAssetShadowPaths(scene, tile, (tile.shadowPaths || []).map(path => ({ ...path, source: 'artist' })));
    publishShadowLibrary();
    scene.assetRules[tile.asset] = structuredClone({ movement: tile.movement, lightShape: tile.lightShape, annotations: tile.annotations,
      ...(tile.shadowPaths?.length ? { shadowPaths: tile.shadowPaths } : {}) });
    tile.confirmed = true;
  } else { delete scene.placementReviewed[tile.asset]; revokeConfirmation(tile); }
  refreshPicker(); changed(false);
}
function place(assetId, x, y) {
  const asset = catalog.get(assetId); if (!asset) return;
  if (scene.placements.length >= MAX_PLACEMENTS) { status(`Placement limit reached (${MAX_PLACEMENTS}). Erase unused layers or start another map.`); return; }
  if (asset.w > scene.width || asset.h > scene.height) { status('Asset is larger than this map. Increase map dimensions.'); return; }
  finishShadow();
  historyPoint();
  const tile = createPlacement(asset, Math.max(0, Math.min(scene.width - asset.w, Math.floor(x))), Math.max(0, Math.min(scene.height - asset.h, Math.floor(y))));
  applyLearnedFeatures(tile, asset, LEARNED_FEATURE_RULES);
  if (scene.assetRules[assetId] && !tile.locked) { Object.assign(tile, structuredClone(scene.assetRules[assetId])); tile.confirmed = true; }
  applyFixedMovementRules(tile);
  applyOrganicLightingRules({ placements: [tile] }, assets, ORGANIC_LIGHTING_RULES);
  applyAssetShadowRule(scene, tile);
  scene.placements.push(tile); clearSelection(); tilesSelected.add(tile.id); picked = null; mode = 'tile';
  for (const b of document.querySelectorAll('button[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === mode);
  viewport.dataset.mode = mode;
  status(`Placed ${asset.name}`); changed();
}
function transformSelected(property, value) {
  const targets = scene.placements.filter(t => tilesSelected.has(t.id)); if (!targets.length) return;
  if (targets.some(t => {
    const candidate = { ...t, [property]: value ?? !t[property] }, [w, h] = dimensions(candidate);
    return candidate.x + w > scene.width || candidate.y + h > scene.height;
  })) { status('Rotation would place a tile outside the map.'); return; }
  historyPoint();
  for (const tile of targets) tile[property] = value ?? !tile[property];
  changed();
}
function moveSelected(dx, dy) {
  if (mode === 'token') {
    if (!canMoveToken(scene, dx, dy)) { status('Movement blocked'); return; }
    historyPoint(); scene.token.x += dx; scene.token.y += dy; status(`Token ${scene.token.x}, ${scene.token.y}`); changed(false); return;
  }
  const targets = scene.placements.filter(t => tilesSelected.has(t.id)); if (!targets.length) return;
  if (targets.some(t => { const [w, h] = dimensions(t); return t.x + dx < 0 || t.y + dy < 0 || t.x + dx + w > scene.width || t.y + dy + h > scene.height; })) return;
  historyPoint(); for (const tile of targets) { tile.x += dx; tile.y += dy; } changed();
}
function deleteTop() {
  if (shadowDraft) { shadowDraft = null; shadowHover = null; updateLighting(); requestDraw(); return; }
  if (selectedShadow) {
    const owner = scene.placements.find(tile => tile.id === selectedShadow.tileId);
    const paths = owner ? owner.shadowPaths : scene.shadowPaths;
    const index = paths?.findIndex(path => path.id === selectedShadow.id) ?? -1;
    if (index >= 0) {
      historyPoint(); paths.splice(index, 1);
      if (owner) { setAssetShadowPaths(scene, owner, paths); revokeConfirmation(owner); publishShadowLibrary(); }
    }
    clearSelection(); changed(false); return;
  }
  const tile = [...scene.placements].reverse().find(t => tilesSelected.has(t.id)); if (!tile) return;
  historyPoint(); scene.placements.splice(scene.placements.indexOf(tile), 1);
  tilesSelected.delete(tile.id); for (const key of [...featuresSelected]) if (key.startsWith(tile.id + '|')) featuresSelected.delete(key);
  const underlying = topTile([tile.x + 0.5, tile.y + 0.5]); if (underlying) tilesSelected.add(underlying.id);
  status(`Deleted ${catalog.get(tile.asset).name}`); changed();
}

function finishShadow() {
  if (!shadowDraft) return;
  const draft = shadowDraft; shadowDraft = null; shadowHover = null;
  if (draft.points.length < 2) { updateLighting(); requestDraw(); return; }
  const tile = scene.placements.find(tile => tile.id === draft.tileId);
  historyPoint();
  const path = addShadowPath(scene, draft.points, tile);
  if (tile) publishShadowLibrary();
  clearSelection(); selectedShadow = { id: path.id, tileId: tile?.id || null };
  if (tile) tilesSelected.add(tile.id);
  if (tile) { revokeConfirmation(tile); refreshPicker(); }
  status(`Shadow line: ${path.points.length} points`); changed(false); saveNow();
}

function shadowAt(point) {
  let best = null, distance = 7 / (zoom * CELL);
  for (const path of shadowPaths(scene)) for (let i = 1; i < path.points.length; i++) {
    const [a, b] = [path.points[i - 1], path.points[i]], dx = b[0] - a[0], dy = b[1] - a[1];
    const length = dx * dx + dy * dy; if (!length) continue;
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length));
    const d = Math.hypot(point[0] - a[0] - dx * t, point[1] - a[1] - dy * t);
    if (d < distance) { distance = d; best = { id: path.id, tileId: path.tileId }; }
  }
  return best;
}

function drawShadowPaths(target, includeDraft = true) {
  const paths = shadowPaths(scene);
  if (includeDraft && shadowDraft) paths.push({ ...shadowDraft, id: '__draft__', tileId: null });
  for (const path of paths) {
    const selected = (selectedShadow?.id === path.id && selectedShadow?.tileId === path.tileId) || path.id === '__draft__';
    target.strokeStyle = selected ? '#57caff' : '#f1d67a'; target.fillStyle = target.strokeStyle;
    target.lineWidth = (selected ? 3 : 2) / (includeDraft ? zoom : 1);
    target.beginPath(); target.moveTo(...path.points[0].map(value => value * CELL));
    for (const point of path.points.slice(1)) target.lineTo(...point.map(value => value * CELL));
    target.stroke();
    if (includeDraft && (selected || mode === 'shadow')) for (const point of path.points) {
      target.beginPath(); target.arc(...point.map(value => value * CELL), 3 / zoom, 0, Math.PI * 2); target.fill();
    }
  }
  if (includeDraft && shadowDraft && shadowHover) {
    target.save(); target.setLineDash([4 / zoom, 4 / zoom]); target.strokeStyle = '#57caff';
    target.beginPath(); target.moveTo(...shadowDraft.points.at(-1).map(value => value * CELL));
    target.lineTo(...shadowHover.map(value => value * CELL)); target.stroke(); target.restore();
  }
}

function drawTile(target, tile) {
  const image = imageFor(tile.asset), asset = catalog.get(tile.asset); if (!image) return;
  const [w, h] = dimensions(tile);
  target.save(); target.translate((tile.x + w / 2) * CELL, (tile.y + h / 2) * CELL);
  target.rotate(tile.turn * Math.PI / 2); target.scale(tile.flipX ? -1 : 1, tile.flipY ? -1 : 1);
  if (asset.crop) target.drawImage(image, 0, 0, CELL, CELL, -tile.w * CELL / 2, -tile.h * CELL / 2, tile.w * CELL, tile.h * CELL);
  else target.drawImage(image, -tile.w * CELL / 2, -tile.h * CELL / 2, asset.pixelWidth, asset.pixelHeight);
  target.restore();
}
let gridTexture;
function paintTerrain() {
  if (!terrainDirty) return;
  terrain.width = scene.width * CELL; terrain.height = scene.height * CELL;
  fog.width = terrain.width; fog.height = terrain.height;
  const target = terrain.getContext('2d');
  target.fillStyle = scene.background === 'paper'
    ? target.createPattern(imageFor('room_grid_backgroung.jpg'), 'repeat') : '#000000';
  target.fillRect(0, 0, terrain.width, terrain.height);
  if (scene.background === 'dungeon' && gridTexture) {
    target.fillStyle = target.createPattern(gridTexture, 'repeat'); target.fillRect(0, 0, terrain.width, terrain.height);
  }
  for (const tile of scene.placements) drawTile(target, tile);
  terrainDirty = false;
}
function updateLighting() {
  const preview = shadowDraft?.points.length > 1 ? { ...scene, shadowPaths: [...scene.shadowPaths, shadowDraft] } : scene;
  polygon = lightPolygon(preview);
  if (polygon.length) {
    const r = scene.token.radius + 1;
    for (let y = Math.max(0, scene.token.y - r); y <= Math.min(scene.height - 1, scene.token.y + r); y++)
      for (let x = Math.max(0, scene.token.x - r); x <= Math.min(scene.width - 1, scene.token.x + r); x++)
        if (isPointInPolygon([(x + 0.5) * CELL, (y + 0.5) * CELL], polygon)) explored.add(`${x},${y}`);
  }
}
function polygonPath(target) {
  target.beginPath(); if (!polygon.length) return;
  target.moveTo(...polygon[0]); for (const p of polygon.slice(1)) target.lineTo(...p); target.closePath();
}
function paintFog() {
  const target = fog.getContext('2d'); target.clearRect(0, 0, fog.width, fog.height);
  target.fillStyle = 'rgba(0,0,0,.96)'; target.fillRect(0, 0, fog.width, fog.height);
  for (const key of explored) {
    const [x, y] = key.split(',').map(Number);
    target.clearRect(x * CELL, y * CELL, CELL, CELL); target.fillStyle = 'rgba(0,0,0,.66)'; target.fillRect(x * CELL, y * CELL, CELL, CELL);
  }
  if (polygon.length) { target.globalCompositeOperation = 'destination-out'; polygonPath(target); target.fill(); target.globalCompositeOperation = 'source-over'; }
}
function drawToken(target) {
  const x = (scene.token.x + 0.5) * CELL, y = (scene.token.y + 0.5) * CELL;
  target.beginPath(); target.arc(x, y, 11, 0, Math.PI * 2); target.fillStyle = '#3584dd'; target.fill();
  target.strokeStyle = mode === 'token' ? '#69ddff' : '#fff'; target.lineWidth = 3 / Math.max(zoom, .6); target.stroke();
  const flame = imageFor('Sprite-fire.png');
  if (scene.token.torch && flame) {
    target.drawImage(flame, x + 9, y - 17, 11, 16);
  }
}
function drawSelection(target) {
  for (const tile of scene.placements.filter(t => tilesSelected.has(t.id))) {
    const [w, h] = dimensions(tile);
    target.lineWidth = 2 / zoom; target.strokeStyle = '#57caff'; target.strokeRect(tile.x * CELL + 1 / zoom, tile.y * CELL + 1 / zoom, w * CELL - 2 / zoom, h * CELL - 2 / zoom);
    for (const f of features(tile)) {
      const selected = featuresSelected.has(tile.id + '|' + f.key), rule = tile.annotations[f.key];
      const points = f.points.map(p => transformPoint(tile, p).map(v => v * CELL));
      target.strokeStyle = selected ? '#4dc9ff' : rule.movement ? '#eb6676' : rule.light ? '#f1d67a' : 'rgba(100,210,250,.5)';
      target.fillStyle = target.strokeStyle; target.lineWidth = (selected ? 5 : rule.movement || rule.light ? 3 : 1) / zoom;
      target.beginPath();
      if (f.kind === 'vertex') { target.arc(...points[0], (selected ? 5 : 3) / zoom, 0, Math.PI * 2); target.fill(); }
      else { target.moveTo(...points[0]); target.lineTo(...points[1]); target.stroke(); }
    }
  }
}
function draw() {
  if (!ready) return;
  const rect = viewport.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  paintTerrain(); ctx.translate(...pan); ctx.scale(zoom, zoom); ctx.drawImage(terrain, 0, 0);
  if (lighting) { paintFog(); ctx.drawImage(fog, 0, 0); }
  if (!lighting || mode === 'shadow' || selectedShadow) drawShadowPaths(ctx);
  drawToken(ctx); drawSelection(ctx);
  $('zoom-label').textContent = `${Math.round(zoom * 100)}%`;
}
function fullSnapshot(useLighting) {
  paintTerrain(); const out = document.createElement('canvas'), scale = Math.min(1, 2048 / Math.max(terrain.width, terrain.height));
  out.width = Math.round(terrain.width * scale); out.height = Math.round(terrain.height * scale);
  const target = out.getContext('2d'); target.scale(scale, scale); target.drawImage(terrain, 0, 0);
  if (useLighting) { paintFog(); target.drawImage(fog, 0, 0); } else drawShadowPaths(target, false);
  drawToken(target);
  return out.toDataURL('image/png');
}
function zoomAt(next, position = [viewport.clientWidth / 2, viewport.clientHeight / 2]) {
  next = Math.max(.05, Math.min(4, next));
  const world = [(position[0] - pan[0]) / zoom, (position[1] - pan[1]) / zoom];
  pan = [position[0] - world[0] * next, position[1] - world[1] * next]; zoom = next; requestDraw();
}
function fit() {
  zoom = Math.max(.05, Math.min(1.5, (viewport.clientWidth - 36) / (scene.width * CELL), (viewport.clientHeight - 36) / (scene.height * CELL)));
  pan = [(viewport.clientWidth - scene.width * CELL * zoom) / 2, (viewport.clientHeight - scene.height * CELL * zoom) / 2]; requestDraw();
}

canvas.addEventListener('pointerdown', event => {
  viewport.focus(); const point = pointAt(event);
  if (mode === 'shadow' && event.button === 2) { event.preventDefault(); finishShadow(); return; }
  if (event.button === 1 || event.button === 2 || event.altKey) {
    dragging = { kind: 'pan', start: [event.clientX, event.clientY], pan: [...pan] }; canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  if (event.button !== 0) return;
  if (mode === 'shadow') {
    if (point[0] < 0 || point[1] < 0 || point[0] > scene.width || point[1] > scene.height) return;
    shadowDraft ||= { points: [], tileId: activeTile()?.id || null };
    if (shadowDraft.points.length >= 4096) { status('Finish this shadow line before adding more points.'); return; }
    const next = point.map(value => Math.round(value * 10000) / 10000);
    if (!shadowDraft.points.length || next.some((value, axis) => value !== shadowDraft.points.at(-1)[axis])) shadowDraft.points.push(next);
    updateLighting(); requestDraw(); event.preventDefault(); return;
  }
  if (mode === 'paint' || mode === 'erase') {
    clearSelection();
    dragging = { kind: 'brush', tool: mode, previous: point, visited: new Set(), eraseSource: [...scene.placements], changed: false };
    brushStroke(point); canvas.setPointerCapture(event.pointerId); event.preventDefault(); return;
  }
  if (mode === 'token' || Math.hypot(point[0] - scene.token.x - .5, point[1] - scene.token.y - .5) < .25) {
    setMode('token');
    dragging = { kind: 'token', start: point, position: [scene.token.x, scene.token.y], changed: false };
    canvas.setPointerCapture(event.pointerId); return;
  }
  const hit = topTile(point);
  const selected = scene.placements.filter(t => tilesSelected.has(t.id));
  const candidates = mode === 'tile' ? selected : [...selected, ...(hit && !tilesSelected.has(hit.id) ? [hit] : [])];
  const feature = featureAt(point, candidates, mode === 'tile' ? null : mode);
  if (feature) {
    if (!event.ctrlKey && !event.metaKey) clearSelection();
    tilesSelected.add(feature.tile.id); const key = feature.tile.id + '|' + feature.feature.key;
    if (featuresSelected.has(key)) featuresSelected.delete(key); else featuresSelected.add(key);
    picked = null; refreshInspector(); requestDraw(); return;
  }
  if (mode !== 'tile') return;
  const path = shadowAt(point);
  if (path) { clearSelection(); selectedShadow = path; if (path.tileId) tilesSelected.add(path.tileId); picked = null; refreshInspector(); requestDraw(); return; }
  if (hit) {
    if (!event.ctrlKey && !event.metaKey && !tilesSelected.has(hit.id)) clearSelection();
    featuresSelected.clear();
    if ((event.ctrlKey || event.metaKey) && tilesSelected.has(hit.id)) tilesSelected.delete(hit.id); else tilesSelected.add(hit.id);
    picked = null;
    dragging = { kind: 'tile', start: point, positions: scene.placements.filter(t => tilesSelected.has(t.id)).map(t => [t.id, t.x, t.y]), changed: false };
    canvas.setPointerCapture(event.pointerId);
  } else if (picked) place(picked, ...point);
  else clearSelection();
  refreshInspector(); requestDraw();
});
canvas.addEventListener('pointermove', event => {
  const point = pointAt(event);
  if (mode === 'shadow' && shadowDraft) { shadowHover = point; requestDraw(); }
  $('coordinates').textContent = `${Math.floor(point[0])}, ${Math.floor(point[1])}`;
  if (!dragging) return;
  if (dragging.kind === 'pan') { pan = [dragging.pan[0] + event.clientX - dragging.start[0], dragging.pan[1] + event.clientY - dragging.start[1]]; requestDraw(); return; }
  if (dragging.kind === 'brush') { brushStroke(point); return; }
  const dx = Math.round(point[0] - dragging.start[0]), dy = Math.round(point[1] - dragging.start[1]);
  if (!dx && !dy && !dragging.changed) return;
  if (dragging.kind === 'token') {
    const nx = Math.max(0, Math.min(scene.width - 1, dragging.position[0] + dx)), ny = Math.max(0, Math.min(scene.height - 1, dragging.position[1] + dy));
    const stepX = Math.sign(nx - scene.token.x), stepY = Math.sign(ny - scene.token.y);
    if ((!stepX && !stepY) || !canMoveToken(scene, stepX, stepY)) return;
    if (!dragging.changed) { historyPoint(); dragging.changed = true; }
    scene.token.x += stepX; scene.token.y += stepY; changed(false); return;
  }
  const targets = dragging.positions.map(([id, x, y]) => ({ tile: scene.placements.find(t => t.id === id), x: x + dx, y: y + dy }));
  if (targets.some(({ tile, x, y }) => { const [w, h] = dimensions(tile); return x < 0 || y < 0 || x + w > scene.width || y + h > scene.height; })) return;
  if (!dragging.changed) { historyPoint(); dragging.changed = true; }
  for (const { tile, x, y } of targets) { tile.x = x; tile.y = y; } changed();
});
function brushStroke(point) {
  const stroke = dragging;
  const result = applyBrush(scene, stroke.tool, brushCells(stroke.previous, point), catalog.get('1-black.png'), {
    visited: stroke.visited, eraseSource: stroke.eraseSource,
    beforeChange: () => { if (!stroke.changed) { historyPoint(); stroke.changed = true; } }
  });
  stroke.previous = point;
  if (result.changes) { status(stroke.tool === 'paint' ? 'Painting solid black tiles' : 'Erasing top layers'); changed(); }
  if (result.limited) status(`Placement limit reached (${MAX_PLACEMENTS}).`);
}
canvas.addEventListener('pointerup', () => { const edited = dragging?.changed; dragging = null; if (edited) saveNow(); });
canvas.addEventListener('pointercancel', () => { dragging = null; });
window.addEventListener('pagehide', saveNow);
window.addEventListener('beforeunload', saveNow);
canvas.addEventListener('contextmenu', event => event.preventDefault());
viewport.addEventListener('wheel', event => {
  event.preventDefault(); const rect = canvas.getBoundingClientRect(); zoomAt(zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12), [event.clientX - rect.left, event.clientY - rect.top]);
}, { passive: false });
viewport.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
viewport.addEventListener('drop', event => { event.preventDefault(); const id = event.dataTransfer.getData('application/x-sd-tile'); place(id, ...pointAt(event)); viewport.focus(); });

document.addEventListener('keydown', event => {
  if (event.target.closest('input, textarea, select') || event.altKey) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); (event.shiftKey ? redo : undo)(); return; }
  const numpad = { Numpad8: [0, -1], Numpad2: [0, 1], Numpad4: [-1, 0], Numpad6: [1, 0], Numpad7: [-1, -1], Numpad9: [1, -1], Numpad1: [-1, 1], Numpad3: [1, 1] };
  const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
  const movement = numpad[event.code] || arrows[event.key];
  if (movement) { event.preventDefault(); moveSelected(...movement); return; }
  if (event.code.startsWith('Numpad')) return;
  if (['1', '2', '3', '4'].includes(event.key)) { event.preventDefault(); transformSelected('turn', Number(event.key) - 1); }
  else if (event.key === '5') { event.preventDefault(); transformSelected('flipX'); }
  else if (event.key === '6') { event.preventDefault(); transformSelected('flipY'); }
  else if (['Escape', 'Backspace', 'Delete'].includes(event.key)) { event.preventDefault(); deleteTop(); }
  else if (event.key.toLowerCase() === 'b') { event.preventDefault(); applyRules('movement'); }
  else if (event.key.toLowerCase() === 'l') { event.preventDefault(); applyRules('light'); }
});
function restore(value, sharedShadows = true) {
  shadowDraft = null; shadowHover = null;
  scene = validateScene(value, assets); applyLearnedRules(scene, assets, LEARNED_TILE_RULES, LEARNED_FEATURE_RULES);
  applyOrganicLightingRules(scene, assets, ORGANIC_LIGHTING_RULES);
  applyShadowRules(scene, assets, SHADOW_DEFAULTS);
  if (sharedShadows) useShadowLibrary();
  if (study) scene.study = { id: study.id, page: studyIndex };
  explored = new Set(scene.explored); clearSelection(); terrainDirty = true;
  updateControls(); updateLighting(); requestDraw(); persist();
}
function loadStudyPage(index) {
  studyIndex = index;
  STORAGE = `${BASE_STORAGE}:study:${study.id}:${index}`;
  let value = study.pages[index];
  const saved = localStorage.getItem(STORAGE);
  if (saved) {
    try {
      const candidate = validateScene(JSON.parse(saved), assets);
      if (candidate.study?.id !== study.id || candidate.study.page !== index) throw new Error('Study page mismatch.');
      value = candidate;
    } catch (error) { status(`Saved study retained in storage: ${error.message}`); }
  }
  history.length = 0; future.length = 0; restore(value);
  scene.study = { id: study.id, page: index };
  $('study-page').value = String(index); $('study-page').title = scene.name; fit();
  const url = new URL(location.href); url.searchParams.set('page', String(index + 1));
  window.history.replaceState(null, '', url);
  status(`${study.name} | ${index + 1} / ${study.pages.length}`);
}
$('study-page').onchange = () => { saveNow(); loadStudyPage(Number($('study-page').value)); };
function undo() { if (!history.length) return; scene.explored = [...explored]; future.push(structuredClone(scene)); restore(history.pop(), false); publishShadowLibrary(); }
function redo() { if (!future.length) return; scene.explored = [...explored]; history.push(structuredClone(scene)); restore(future.pop(), false); publishShadowLibrary(); }
$('undo').onclick = undo; $('redo').onclick = redo;
for (const b of document.querySelectorAll('button[data-mode]')) b.onclick = () => setMode(b.dataset.mode);
for (const b of document.querySelectorAll('[data-turn]')) b.onclick = () => { transformSelected('turn', Number(b.dataset.turn)); viewport.focus(); };
$('flip-x').onclick = () => { transformSelected('flipX'); viewport.focus(); };
$('flip-y').onclick = () => { transformSelected('flipY'); viewport.focus(); };
$('movement').onchange = () => applyRules('movement'); $('edge-light').onchange = () => applyRules('light');
$('light-shape').onchange = () => { const tile = activeTile(); if (!tile || tile.locked) return; historyPoint(); tile.lightShape = $('light-shape').value; revokeConfirmation(tile); refreshPicker(); changed(false); };
$('confirmed').onchange = () => confirmTile($('confirmed').checked);
$('delete').onclick = () => { deleteTop(); viewport.focus(); };
$('deselect').onclick = () => { clearSelection(); picked = null; refreshInspector(); requestDraw(); viewport.focus(); };
$('duplicate').onclick = () => {
  const tile = activeTile(); if (!tile) return;
  if (scene.placements.length >= MAX_PLACEMENTS) { status(`Placement limit reached (${MAX_PLACEMENTS}).`); return; }
  historyPoint();
  const copy = structuredClone(tile); copy.id = crypto.randomUUID(); scene.placements.push(copy); clearSelection(); tilesSelected.add(copy.id); changed(); viewport.focus();
};
$('search').oninput = refreshPicker; $('pending-only').onchange = refreshPicker;
function switchView(value) { lighting = value; $('build-view').setAttribute('aria-pressed', !value); $('light-view').setAttribute('aria-pressed', value); requestDraw(); viewport.focus(); }
$('build-view').onclick = () => switchView(false); $('light-view').onclick = () => switchView(true);
$('torch').onchange = () => { historyPoint(); scene.token.torch = $('torch').checked; changed(false); viewport.focus(); };
$('radius').onchange = () => { historyPoint(); scene.token.radius = Math.max(1, Math.min(20, Math.round(Number($('radius').value) || 6))); $('radius').value = scene.token.radius; changed(false); };
$('reset-light').onclick = () => { historyPoint(); explored.clear(); scene.explored = []; changed(false); status('Explored lighting reset'); viewport.focus(); };
$('zoom-in').onclick = () => zoomAt(zoom * 1.25); $('zoom-out').onclick = () => zoomAt(zoom / 1.25); $('fit').onclick = fit;
$('background').onchange = () => { historyPoint(); scene.background = $('background').value; changed(); };
$('map-name').onchange = () => { scene.name = $('map-name').value; persist(); };
$('notes').oninput = () => { scene.notes = $('notes').value; persist(); };
function resizeMap() {
  const width = Math.max(4, Math.min(80, Math.round(Number($('map-width').value) || 32))), height = Math.max(4, Math.min(80, Math.round(Number($('map-height').value) || 24)));
  if (scene.placements.some(t => { const [w, h] = dimensions(t); return t.x + w > width || t.y + h > height; }) ||
    (scene.shadowPaths||[]).some(path=>path.points.some(([x,y])=>x>width||y>height))) { status('Resize would exclude placed tiles or shadow lines.'); updateControls(); return; }
  historyPoint(); scene.width = width; scene.height = height; scene.token.x = Math.min(scene.token.x, width - 1); scene.token.y = Math.min(scene.token.y, height - 1); changed(); fit();
}
$('map-width').onchange = resizeMap; $('map-height').onchange = resizeMap;
$('new-map').onclick = () => {
  if ((scene.placements.length||scene.shadowPaths.length) && !confirm('Start a new map? The current map remains available through Undo.')) return;
  historyPoint(); restore(blankScene()); status('New map'); fit();
};
$('open-map').onclick = () => $('file').click();
$('file').onchange = async () => {
  const file = $('file').files[0]; if (!file) return;
  try { const loaded = validateScene(JSON.parse(await file.text()), assets); historyPoint(); restore(loaded); fit(); status(`Opened ${file.name}`); }
  catch (error) { status(error.message); }
  $('file').value = '';
};
$('output').onclick = async () => {
  finishShadow();
  $('output').disabled = true; status('Writing map output...');
  try {
    scene.explored = [...explored]; scene.name = $('map-name').value; scene.notes = $('notes').value;
    const response = await fetch('/api/output', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scene: exportScene(scene, assets, LEARNED_PLACEMENT_RULES, ORGANIC_LIGHTING_RULES), map: fullSnapshot(false), lighting: fullSnapshot(true) }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Output failed.');
    status(`Saved ${result.path}`); persist();
  } catch (error) { status(error.message); }
  finally { $('output').disabled = false; }
};
new ResizeObserver(requestDraw).observe(viewport);

async function loadImage(asset) {
  const source = asset.source || asset.id;
  const image = new Image(); image.src = '/S3_content/assets/' + source.split('/').map(encodeURIComponent).join('/');
  await image.decode(); images.set(asset.id, image);
}
function makeGridTexture() {
  const image = imageFor('room_grid_backgroung.jpg'); gridTexture = document.createElement('canvas'); gridTexture.width = image.width; gridTexture.height = image.height;
  const target = gridTexture.getContext('2d'); target.drawImage(image, 0, 0); const data = target.getImageData(0, 0, image.width, image.height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const i = (y * image.width + x) * 4;
    const near = x % CELL < 5 || x % CELL > CELL - 5 || y % CELL < 5 || y % CELL > CELL - 5;
    const dark = (data.data[i] + data.data[i + 1] + data.data[i + 2]) / 3 < 60;
    data.data[i] = data.data[i + 1] = data.data[i + 2] = 0; data.data[i + 3] = near && dark ? 210 : 0;
  }
  target.putImageData(data, 0, 0);
}
try {
  const response = await fetch('/api/catalog'); if (!response.ok) throw new Error('Cannot load asset catalog.');
  const result = await response.json(); assets = sortAssets(result.assets); catalog = new Map(assets.map(a => [a.id, a])); outputDirectory = result.outputDirectory;
  try {
    shadowLibrary = validateScene({ ...blankScene(), shadowRules: JSON.parse(localStorage.getItem(SHADOW_STORAGE) || '{}') }, assets).shadowRules;
  } catch { shadowLibrary = {}; }
  const failed = [];
  for (let i = 0; i < assets.length; i += 24) await Promise.all(assets.slice(i, i + 24).map(a => loadImage(a).catch(() => { failed.push(a.id); })));
  if (failed.length) throw new Error(`Missing assets: ${failed.join(', ')}`);
  makeGridTexture();
  const params = new URLSearchParams(location.search), studyId = params.get('study');
  if (studyId) {
    if (!/^[A-Za-z0-9_-]+$/.test(studyId)) throw new Error('Invalid study name.');
    const response = await fetch(`/api/studies/${studyId}.json`);
    if (!response.ok) throw new Error('Study unavailable.');
    study = await response.json();
    if (study.version !== 1 || study.id !== studyId || !Array.isArray(study.pages) || !study.pages.length || study.pages.length > 128) throw new Error('Invalid study.');
    for (const [index, page] of study.pages.entries()) {
      const option = document.createElement('option'); option.value = index;
      option.textContent = `${index + 1}/${study.pages.length} - ${page.name}`; $('study-page').append(option);
    }
    $('study-page').hidden = false;
    loadStudyPage(Math.floor(Math.max(0, Math.min(study.pages.length - 1, (Number(params.get('page')) || 1) - 1))));
  } else {
    const saved = localStorage.getItem(STORAGE);
    if (saved) { try { scene = validateScene(JSON.parse(saved), assets); } catch (error) { status(`Previous map retained in browser storage: ${error.message}`); } }
  }
  const learned = applyLearnedRules(scene, assets, LEARNED_TILE_RULES, LEARNED_FEATURE_RULES);
  applyOrganicLightingRules(scene, assets, ORGANIC_LIGHTING_RULES);
  applyShadowRules(scene, assets, SHADOW_DEFAULTS);
  useShadowLibrary();
  explored = new Set(scene.explored); updateControls(); updateLighting(); ready = true; $('loading').hidden = true; fit();
  if (learned) persist();
  if (!study) status(`${assets.length} assets | Output: ${outputDirectory}`);
  // Test automation can inspect state without modifying accounts or the real game.
  window.tileWorkbench = { get scene() { scene.explored = [...explored]; return structuredClone(scene); }, get assets() { return assets; }, get view() { return { zoom, pan: [...pan] }; } };
} catch (error) { $('loading').textContent = error.message; status(error.message); console.error(error); }
