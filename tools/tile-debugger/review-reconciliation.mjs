const geometry = rule => JSON.stringify(rule?.paths.map(path => path.points) || []);

export function reconcileShadowReview(baseline, snapshots, assets, { acceptBaseline = false } = {}) {
  const catalog = new Map(assets.map(asset => [asset.id, asset]));
  const rules = {}, changes = [], recovered = new Set();
  const valid = (name, rule) => {
    const asset = catalog.get(name);
    return asset && rule.digest === asset.digest && rule.w === asset.w && rule.h === asset.h;
  };
  for (const [name, rule] of Object.entries(baseline)) if (valid(name, rule)) {
    rules[name] = { ...structuredClone(rule), source: rule.source || 'artist',
      ...(acceptBaseline ? { reviewed: true } : {}) };
  }
  for (const { name: filename, scene } of snapshots) for (const [name, rule] of Object.entries(scene.shadowRules || {})) {
    if (!valid(name, rule)) continue;
    const different = geometry(rule) !== geometry(baseline[name]);
    const explicit = rule.edited || rule.source !== 'inferred' || (!rule.revision && different);
    if (!explicit) {
      if (rules[name]?.edited && geometry(rule) !== geometry(rules[name])) recovered.add(name);
      continue;
    }
    if (geometry(rule) !== geometry(rules[name])) changes.push({ asset: name, source: filename,
      before: rules[name]?.paths.map(path => path.points.length) || [], after: rule.paths.map(path => path.points.length) });
    rules[name] = { ...structuredClone(rule), source: rule.source || 'artist',
      ...(different || rule.edited ? { edited: true } : {}),
      ...(acceptBaseline || rule.reviewed ? { reviewed: true } : {}) };
  }
  return { rules, changes, recoveredDeletions: [...recovered],
    pending: Object.entries(rules).filter(([,rule]) => rule.source === 'inferred' && !rule.reviewed).map(([name]) => name) };
}
