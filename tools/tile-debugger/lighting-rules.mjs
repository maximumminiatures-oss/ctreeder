export function applyOrganicLightingRules(scene, assets, profiles) {
  let changed = 0;
  const catalog = new Map(assets.map(asset => [asset.id, asset]));
  for (const tile of scene.placements) {
    const rule = profiles[tile.asset], asset = catalog.get(tile.asset);
    if (!rule || !asset || tile.locked || rule.digest !== asset.digest || tile.digest !== asset.digest ||
      rule.w !== tile.w || rule.h !== tile.h) continue;
    const filled = new Set(rule.lightEdges);
    for (const [key,annotation] of Object.entries(tile.annotations)) {
      if (annotation.editedLight) continue;
      const value = rule.explicitLight?.[key] ?? filled.has(key);
      if (annotation.light !== value || !annotation.profileLight) changed++;
      annotation.light = value; annotation.profileLight = true;
    }
  }
  return changed;
}
