const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const closed = points => distance(points[0], points.at(-1)) < .08;

function distanceToPath(point, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, distance(point, [a[0] + t * dx, a[1] + t * dy]));
  }
  return best;
}

function traceSamples(points) {
  return [...points, ...points.slice(1).map((point, index) =>
    point.map((value, axis) => (value + points[index][axis]) / 2))];
}

export function sameShadowTrace(a, b) {
  const aa = a.points, bb = b.points;
  if (closed(aa) !== closed(bb)) return false;
  if (!closed(aa) && !(
    (distance(aa[0], bb[0]) < .12 && distance(aa.at(-1), bb.at(-1)) < .12) ||
    (distance(aa[0], bb.at(-1)) < .12 && distance(aa.at(-1), bb[0]) < .12))) return false;
  return traceSamples(aa).every(point => distanceToPath(point, bb) < .15) &&
    traceSamples(bb).every(point => distanceToPath(point, aa) < .15);
}

export function mergeShadowPaths(paths, { single = false } = {}) {
  const result = [];
  for (const path of paths) {
    if (!Array.isArray(path.points) || path.points.length < 2) continue;
    const candidate = { ...structuredClone(path), points: path.points.map(point => point.map(value => Math.round(value * 10000) / 10000)) };
    const index = result.findIndex(prior => single || sameShadowTrace(prior, candidate));
    if (index < 0) result.push(candidate);
    else {
      const priorArtist = result[index].source !== 'inferred', candidateArtist = candidate.source !== 'inferred';
      if (candidateArtist && !priorArtist || candidateArtist === priorArtist && candidate.points.length <= result[index].points.length) result[index] = candidate;
    }
  }
  return result;
}

export function setAssetShadowPaths(scene, tile, paths, options = {}) {
  scene.shadowRules ||= {};
  const merged = mergeShadowPaths(paths, options), sources = new Set(merged.map(path => path.source || 'artist'));
  const rule = { digest: tile.digest, w: tile.w, h: tile.h, paths: merged,
    source: sources.size > 1 ? 'mixed' : sources.values().next().value || 'artist', edited: true,
    ...(scene.shadowRules[tile.asset]?.revision ? { revision: scene.shadowRules[tile.asset].revision } : {}) };
  scene.shadowRules[tile.asset] = rule;
  for (const placed of [tile, ...scene.placements]) if (placed.asset === tile.asset && placed.digest === tile.digest &&
    placed.w === tile.w && placed.h === tile.h) {
    placed.shadowPaths = structuredClone(rule.paths);
    placed.shadowSource = rule.source;
  }
  return rule;
}

export function applyAssetShadowRule(scene, tile) {
  const rule = scene.shadowRules?.[tile.asset];
  if (rule?.digest !== tile.digest || rule.w !== tile.w || rule.h !== tile.h) return false;
  tile.shadowPaths = structuredClone(rule.paths);
  tile.shadowSource = rule.source || 'artist';
  return true;
}

export function applyShadowRules(scene, assets, learned = {}, options = {}) {
  scene.shadowRules ||= {};
  let changed = 0;
  for (const asset of assets) {
    let rule = scene.shadowRules[asset.id];
    const candidate = learned[asset.id];
    const inherited = candidate?.digest === asset.digest && candidate.w === asset.w && candidate.h === asset.h ? candidate : null;
    // Older pen deletions kept inferred provenance but dropped the draft revision.
    if (rule?.source === 'inferred' && !rule.revision && inherited?.revision) rule.edited = true;
    const upgradedDraft = rule?.source === 'inferred' && !rule.edited && inherited?.digest === asset.digest &&
      (inherited.source !== 'inferred' || inherited.revision !== rule.revision);
    if (rule?.digest !== asset.digest || rule.w !== asset.w || rule.h !== asset.h || upgradedDraft) {
      const paths = upgradedDraft ? [] : scene.placements.filter(tile => tile.asset === asset.id && tile.digest === asset.digest).flatMap(tile =>
        (tile.shadowPaths || []).map(path => ({ ...path, ...(path.source ? {} : { source: tile.shadowSource || 'artist' }) })));
      if (inherited?.digest === asset.digest && inherited.w === asset.w && inherited.h === asset.h) paths.push(...inherited.paths);
      if (!paths.length && !inherited) continue;
      const merged = mergeShadowPaths(paths, options), sources = new Set(merged.map(path => path.source || inherited?.source || 'artist'));
      rule = { digest: asset.digest, w: asset.w, h: asset.h, paths: merged,
        source: sources.size > 1 ? 'mixed' : sources.values().next().value || inherited?.source || 'artist',
        ...(inherited?.edited ? { edited: true } : {}),
        ...(inherited?.reviewed ? { reviewed: true } : {}),
        ...(inherited?.revision ? { revision: inherited.revision } : {}) };
      scene.shadowRules[asset.id] = rule;
    }
    for (const tile of scene.placements.filter(tile => tile.asset === asset.id && tile.digest === asset.digest)) {
      if (JSON.stringify(tile.shadowPaths) !== JSON.stringify(rule.paths)) changed++;
      applyAssetShadowRule(scene, tile);
    }
  }
  return changed;
}
