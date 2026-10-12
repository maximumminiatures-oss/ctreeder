import { createPlacement, dimensions, features, isOrganicAsset, transformPoint } from './model.mjs';
import { parseOrganicSignature, transformOrganicSignature } from '../../S3_content/src/organic-tiles.js';
import { STUDY_TRANSFORMS } from './study.mjs';

const EDGE_OFFSETS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const CORNER_OFFSETS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const PROBES = [[0, 0], [1, 0], [0, 1]];
const SIDES = ['north', 'east', 'south', 'west'];
const CORNERS = ['nw', 'ne', 'se', 'sw'];
const unit = pose => ({ x: 0, y: 0, w: 1, h: 1,
  turn: pose.turn || 0, flipX: Boolean(pose.flipX), flipY: Boolean(pose.flipY) });

export function composeStudyPose(inner, outer) {
  const wanted = PROBES.map(point => transformPoint(unit(outer), transformPoint(unit(inner), point)));
  const pose = STUDY_TRANSFORMS.find(candidate => PROBES.every((point, index) =>
    transformPoint(unit(candidate), point).every((value, axis) => value === wanted[index][axis])));
  if (!pose) throw new Error('Invalid tile transform.');
  return { ...pose, flipY: false };
}

function signature(tile, catalog) {
  const parsed = parseOrganicSignature(catalog.get(tile.asset)?.name || tile.asset);
  return parsed && transformOrganicSignature(parsed, tile.turn, tile.flipX, tile.flipY);
}
function featureKey(data, kind) {
  return kind === 'edge' ? [data.sides.north, data.corners.nw, data.corners.ne].join('') :
    [data.corners.nw, data.sides.north, data.sides.west].join('');
}
function topologyKey(data) {
  return [...CORNERS.map(key => data.corners[key]), ...SIDES.map(key => data.sides[key])].join('');
}
export function organicAssetFamily(asset) {
  return asset.id.match(/^(.*NW[ox]NE[ox]SE[ox]SW[ox]N[ox]E[ox]S[ox]W[ox])\d*\.png$/i)?.[1] || asset.id;
}
function geometryKey(tile, catalog) {
  const data = signature(tile, catalog);
  const annotations = features(tile).map(feature => {
    const points = feature.points.map(point => transformPoint(unit(tile), point).join(',')).sort();
    const rule = tile.annotations[feature.key];
    return [feature.kind, points, Boolean(rule.movement), Boolean(rule.light)];
  }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { shape: data ? topologyKey(data) : tile.asset,
    movement: tile.movement, lightShape: tile.lightShape, annotations };
}
export function adjacentGeometryKey(layers, assets) {
  const catalog = new Map(assets.map(asset => [asset.id, asset]));
  return JSON.stringify(layers.map(tile => geometryKey(tile, catalog)));
}
function normalizedLayers(layers, turns) {
  return layers.map(tile => ({ ...structuredClone(tile),
    ...composeStudyPose(tile, { turn: turns }) }));
}

function indexPlacements(placements) {
  const cells = new Map();
  for (const tile of placements) {
    const [w, h] = dimensions(tile);
    for (let y = tile.y; y < tile.y + h; y++) for (let x = tile.x; x < tile.x + w; x++) {
      const key = `${x},${y}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(tile);
    }
  }
  return cells;
}

function cellAnchor(tile, x, y) {
  const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(point => transformPoint(tile, point));
  return [Math.min(...corners.map(point => point[0])), Math.min(...corners.map(point => point[1]))];
}

export function studyCellGeometry(tile, assets, profiles = []) {
  const catalog = assets instanceof Map ? assets : new Map(assets.map(asset => [asset.id, asset]));
  if (tile.w === 1 && tile.h === 1) {
    const data = signature(tile, catalog);
    return data ? [{ x: tile.x, y: tile.y, local: [0, 0], data }] : [];
  }
  const profile = profiles.find(profile => profile.id === tile.asset);
  if (!profile) return [];
  if (profile.digest !== catalog.get(tile.asset)?.digest || profile.w !== tile.w || profile.h !== tile.h) {
    throw new Error(`Stale cell geometry: ${tile.asset}`);
  }
  return profile.cells.map(cell => {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= tile.w || cell.y >= tile.h) {
      throw new Error('Invalid macro cell coordinate.');
    }
    const data = parseOrganicSignature(cell.signature);
    if (!data) throw new Error('Invalid macro cell signature.');
    const [x, y] = cellAnchor(tile, cell.x, cell.y);
    return { x, y,
      local: [cell.x, cell.y], data: transformOrganicSignature(data, tile.turn, tile.flipX, tile.flipY) };
  });
}

export function learnAdjacentTiles(source, assets, options = {}) {
  const sources = Array.isArray(source) ? source : [source];
  const catalog = new Map(assets.map(asset => [asset.id, asset]));
  const tables = { edge: new Map(), diagonal: new Map() }, fullTables = { edge: new Map(), diagonal: new Map() };
  const examples = [], primitives = [];
  for (const [sourceIndex, scene] of sources.entries()) {
    const cells = indexPlacements(scene.placements);
    const studyCenters = scene.placements.filter(tile => tile.id.startsWith('study-'));
    const centers = studyCenters.length ? studyCenters : options.includeAuthoredTiles ? scene.placements.filter(tile =>
      isOrganicAsset(catalog.get(tile.asset) || { name: '' }) && tile.x > 0 && tile.y > 0 &&
      tile.x + dimensions(tile)[0] < scene.width && tile.y + dimensions(tile)[1] < scene.height) : [];
    for (const center of centers) {
      const geometry = studyCellGeometry(center, catalog, options.cellProfiles); if (!geometry.length) continue;
      for (const cell of geometry) for (const [kind, offsets] of [['edge', EDGE_OFFSETS], ['diagonal', CORNER_OFFSETS]]) {
        const data = cell.data;
        for (const [index, [dx, dy]] of offsets.entries()) {
          if (kind === 'diagonal' && (center.w > 1 || center.h > 1)) {
            const [w, h] = dimensions(center), x = cell.x + dx, y = cell.y + dy;
            // A macro's outside edge cells are cardinal joins, not diagonal corner examples.
            if ((x >= center.x && x < center.x + w) || (y >= center.y && y < center.y + h)) continue;
          }
          const layers = cells.get(`${cell.x + dx},${cell.y + dy}`) || [];
          if (layers.some(tile => tile.w !== 1 || tile.h !== 1 || !catalog.has(tile.asset) || !isOrganicAsset(catalog.get(tile.asset)))) continue;
          const turns = (4 - index) % 4, normalizedData = transformOrganicSignature(data, turns);
          const normalized = normalizedLayers(layers, turns);
          const fingerprint = JSON.stringify(normalized.map(tile => geometryKey(tile, catalog)));
          for (const [table, key] of [[tables[kind], featureKey(normalizedData, kind)], [fullTables[kind], topologyKey(normalizedData)]]) {
            if (!table.has(key)) table.set(key, { total: 0, options: new Map() });
            const bucket = table.get(key); bucket.total++;
            if (!bucket.options.has(fingerprint)) bucket.options.set(fingerprint, { layers: normalized, count: 0, examples: [] });
            const option = bucket.options.get(fingerprint); option.count++;
            // The latest inspected example supplies the art and annotations for an equivalent shape.
            option.layers = normalized;
            option.examples.push({ sourceIndex, study: scene.study, family: organicAssetFamily(catalog.get(center.asset)),
              center: center.id, x: cell.x, y: cell.y, localCell: cell.local, index });
          }
        }
      }
      examples.push(center.id);
    }
    primitives.push(...scene.placements.filter(tile => !tile.id.startsWith('study-') && tile.w === 1 && tile.h === 1 &&
      catalog.has(tile.asset) && isOrganicAsset(catalog.get(tile.asset)) && !tile.movement && signature(tile, catalog)));
  }
  return { tables, fullTables, catalog, primitives, examples };
}

function geometryFallback(learned, key, kind) {
  if (kind === 'edge' ? key === 'xxx' : key[0] === 'x') return { layers: [], confidence: .5, method: 'geometry fallback', evidence: [] };
  const candidates = new Map();
  for (const primitive of learned.primitives) {
    for (const pose of STUDY_TRANSFORMS) {
      const tile = { ...primitive, ...pose }, data = signature(tile, learned.catalog);
      const actual = kind === 'edge' ? [data.sides.south, data.corners.sw, data.corners.se].join('') : data.corners.se;
      const wanted = kind === 'edge' ? key : 'o';
      const mismatch = [...wanted].reduce((n, value, index) => n + (value !== actual[index] ? index === 0 ? 3 : 2 : 0), 0);
      const filled = [...Object.values(data.sides), ...Object.values(data.corners)].filter(value => value === 'o').length;
      const fingerprint = `${tile.asset}:${pose.turn}:${Number(pose.flipX)}`;
      if (!candidates.has(fingerprint)) candidates.set(fingerprint, { tile, score: mismatch * 20 + filled, count: 0 });
      candidates.get(fingerprint).count++;
    }
  }
  const best = [...candidates.values()].sort((a, b) => a.score - b.score || b.count - a.count || a.tile.asset.localeCompare(b.tile.asset))[0];
  return { layers: best ? [best.tile] : [], confidence: .35, method: 'geometry fallback', evidence: [] };
}
function predict(learned, data, kind, index, family) {
  const normalizedData = transformOrganicSignature(data, (4 - index) % 4);
  const reflection = { turn: kind === 'edge' ? 0 : 3, flipX: true };
  const reflectedData = transformOrganicSignature(normalizedData, reflection.turn, reflection.flipX);
  const key = featureKey(normalizedData, kind), topology = topologyKey(normalizedData);
  let bucket = learned.fullTables[kind].get(topology), mirrored = false, specificity = 'full topology';
  if (!bucket) { bucket = learned.fullTables[kind].get(topologyKey(reflectedData)); mirrored = Boolean(bucket); }
  if (!bucket) {
    specificity = 'edge/corner'; bucket = learned.tables[kind].get(key);
    if (!bucket) { bucket = learned.tables[kind].get(featureKey(reflectedData, kind)); mirrored = Boolean(bucket); }
  }
  let result;
  if (bucket) {
    const allEvidence = [...bucket.options.values()].flatMap(option => option.examples);
    const sameFamily = specificity === 'full topology' && allEvidence.some(example => example.family === family);
    const relevant = allEvidence.filter(example => !sameFamily || example.family === family);
    const latest = Math.max(...relevant.map(example => example.sourceIndex));
    const options = [...bucket.options.values()].map(option => ({ ...option, evidence:
      specificity === 'full topology' ? option.examples.filter(example => example.sourceIndex === latest &&
        (!sameFamily || example.family === family)) : option.examples }));
    const option = options.sort((a, b) => b.evidence.length - a.evidence.length || a.layers.length - b.layers.length)[0];
    const total = options.reduce((n, item) => n + item.evidence.length, 0);
    result = { layers: option.layers, confidence: option.evidence.length / total,
      evidenceScope: sameFamily ? 'asset family' : specificity,
      method: specificity === 'full topology' ? `${mirrored ? 'mirrored ' : ''}observed full topology` :
        mirrored ? 'mirrored observed pattern' : 'observed pattern', evidence: option.evidence };
  } else result = geometryFallback(learned, key, kind);
  const layers = result.layers.map(tile => {
    let pose = tile;
    if (mirrored) pose = composeStudyPose(pose, reflection);
    return { ...tile, ...composeStudyPose(pose, { turn: index }) };
  });
  return { ...result, key, topology, specificity, layers };
}

function matchingVariants(layer, learned) {
  const original = learned.catalog.get(layer.asset), family = organicAssetFamily(original);
  const data = parseOrganicSignature(original.name);
  if (!data) return [original];
  const expected = topologyKey(data);
  return [...learned.catalog.values()].filter(asset => asset.w === 1 && asset.h === 1 && organicAssetFamily(asset) === family &&
    topologyKey(parseOrganicSignature(asset.name)) === expected).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
}

function cryptPrototype(example) {
  if (!example?.placements) return null;
  for (const tile of example.placements.filter(tile => /^crypt \d+\.png$/i.test(tile.asset) && tile.w === 1 && tile.h === 2)) {
    const [outsideX, outsideY] = cellAnchor(tile, 0, -1), [insideX, insideY] = cellAnchor(tile, 0, 0), [w, h] = dimensions(tile);
    const exterior = example.placements.find(candidate => candidate.asset === 'door-closed.png' && candidate.x === outsideX && candidate.y === outsideY);
    const door = exterior || example.placements.find(candidate => candidate.asset === 'door-closed.png' && candidate.x === insideX && candidate.y === insideY);
    const walls = example.placements.filter(candidate => candidate.asset === '1-black.png' &&
      candidate.x >= tile.x - 1 && candidate.x <= tile.x + w && candidate.y >= tile.y - 1 && candidate.y <= tile.y + h);
    if (door && walls.length >= 4) return { center: tile.id, asset: tile.asset, door: door.id,
      entranceLocal: exterior ? [0, -1] : [0, 0], wallExamples: walls.map(wall => wall.id) };
  }
  return null;
}

function addCryptChamber(center, scene, learned, occupied, predictions, prototype) {
  if (!prototype || center.w !== 1 || center.h !== 2) return false;
  const black = learned.catalog.get('1-black.png'), door = learned.catalog.get('door-closed.png');
  const approach = learned.catalog.get('org-free-NWoNEoSEoSWoNxEoSxWo.png');
  if (!black || !door || !approach) throw new Error('Crypt chamber assets unavailable.');
  const pose = composeStudyPose({}, center);
  const place = (asset, localX, localY, kind, overlay = false) => {
    const [x, y] = cellAnchor(center, localX, localY), key = `${x},${y}`;
    if (x < 0 || y < 0 || x >= scene.width || y >= scene.height) return;
    if (!overlay && occupied.has(key)) return;
    if (overlay && indexPlacements(scene.placements).get(key)?.some(tile => tile.id !== center.id)) return;
    const tile = createPlacement(asset, x, y, `prediction-${center.id}-crypt-${kind}-${localX}-${localY}`);
    Object.assign(tile, pose); scene.placements.push(tile); occupied.add(key);
    predictions.push({ center: center.id, localCell: [localX, localY], x, y, kind: `crypt ${kind}`,
      method: 'crypt chamber example', evidenceScope: 'crypt layout example', confidence: null,
      assets: [asset.id], placementIds: [tile.id], evidence: [prototype] });
  };
  for (let y = -1; y <= center.h; y++) for (let x = -1; x <= center.w; x++) {
    if ((x >= 0 && x < center.w && y >= 0 && y < center.h) || (x === 0 && y === -1)) continue;
    place(black, x, y, 'wall');
  }
  const [doorX, doorY] = prototype.entranceLocal;
  place(door, doorX, doorY, 'entrance', doorY === 0);
  if (doorY === 0) place(approach, 0, -1, 'approach');
  return true;
}

export function buildAdjacencyDraft(source, target, assets, id, options = {}) {
  const learned = learnAdjacentTiles(source, assets, options), scene = structuredClone(target), predictions = [], unsupportedTargets = [];
  const centers = target.placements.filter(tile => tile.id.startsWith('study-'));
  const occupied = new Set(indexPlacements(target.placements).keys());
  const sources = Array.isArray(source) ? source : [source];
  const cryptExample = [...sources].reverse().map(cryptPrototype).find(Boolean) || cryptPrototype(options.cryptExample);
  for (const center of centers) {
    if (/^crypt \d+\.png$/i.test(center.asset) && addCryptChamber(center, scene, learned, occupied, predictions, cryptExample)) continue;
    const geometry = studyCellGeometry(center, learned.catalog, options.cellProfiles);
    if (!geometry.length) { unsupportedTargets.push(center.id); continue; }
    // Complete all cardinal joins before considering diagonals around a macro.
    for (const [kind, offsets] of [['edge', EDGE_OFFSETS], ['diagonal', CORNER_OFFSETS]]) for (const cell of geometry) {
      for (const [index, [dx, dy]] of offsets.entries()) {
        const x = cell.x + dx, y = cell.y + dy;
        if (x < 0 || y < 0 || x >= scene.width || y >= scene.height || occupied.has(`${x},${y}`)) continue;
        const prediction = predict(learned, cell.data, kind, index, organicAssetFamily(learned.catalog.get(center.asset))), placementIds = [];
        for (const [layerIndex, layer] of prediction.layers.entries()) {
          const variants = options.varyAssets === false ? [] : matchingVariants(layer, learned);
          const asset = variants.length ? variants[scene.placements.length % variants.length] : learned.catalog.get(layer.asset);
          const tile = createPlacement(asset, x, y, `prediction-${center.id}-${cell.local.join('-')}-${kind}-${index}-${layerIndex}`);
          Object.assign(tile, { turn: layer.turn, flipX: layer.flipX, flipY: false,
            movement: layer.movement, lightShape: layer.lightShape, annotations: structuredClone(layer.annotations) });
          for (const rule of Object.values(tile.annotations)) { rule.editedMovement = false; rule.editedLight = false; }
          scene.placements.push(tile); placementIds.push(tile.id);
        }
        if (placementIds.length) occupied.add(`${x},${y}`);
        predictions.push({ center: center.id, localCell: cell.local, x, y, kind, key: prediction.key, method: prediction.method,
          topology: prediction.topology, specificity: prediction.specificity,
          evidenceScope: prediction.evidenceScope,
          confidence: prediction.confidence, assets: placementIds.map(placementId => scene.placements.find(tile => tile.id === placementId).asset),
          placementIds, evidence: prediction.evidence });
      }
    }
  }
  const pageNumber = options.pageNumber ?? (target.study?.page ?? 1) + 1;
  scene.name = `[Draft] Page ${pageNumber} adjacent tiles`; scene.notes = `Draft ${id}; based on ${sources.length} inspected export(s).`;
  scene.study = { id, page: 0 };
  return { study: { version: 1, id, name: `Page ${pageNumber} predicted neighbors`, scope: ['organic', 'crypt'], pages: [scene] },
    report: { tentative: true, sourceStudies: sources.map(scene => scene.study), targetStudy: target.study,
      cryptExample,
      sourceExamples: learned.examples.length, targetTiles: centers.length, unsupportedTargets,
      addedPlacements: scene.placements.length - target.placements.length,
      edgePatterns: learned.tables.edge.size, cornerPatterns: learned.tables.diagonal.size, predictions } };
}
