import { blankScene, createPlacement, dimensions, isOrganicAsset, sortAssets } from './model.mjs';

export const STUDY_TRANSFORMS = Array.from({ length: 8 }, (_, i) => ({ turn: i % 4, flipX: i >= 4, flipY: false }));

export function buildTileStudy(assets, learned, id) {
  const unknown = sortAssets(assets).filter(asset => (isOrganicAsset(asset) || /^crypt \d+\.png$/i.test(asset.id)) &&
    learned[asset.id]?.digest !== asset.digest);
  const pages = [];
  const addPages = (items, label) => {
    let scene, x, y, rowHeight, pageNumber = 0;
    const nextPage = () => {
      scene = blankScene(); scene.token.x = 0; scene.token.y = 0;
      scene.name = `${label} ${++pageNumber}`;
      scene.notes = `Study ${id}; template page ${pages.length + 1}.`;
      scene.study = { id, page: pages.length }; pages.push(scene);
      x = 2; y = 2; rowHeight = 0;
    };
    for (const { asset, transform } of items) {
      const tile = createPlacement(asset, 0, 0, `study-${id}-${pages.length}-${asset.id}-${transform.turn}-${Number(transform.flipX)}`);
      Object.assign(tile, transform);
      const [w, h] = dimensions(tile);
      if (w + 4 > 32 || h + 4 > 24) throw new Error(`Study tile too large: ${asset.id}`);
      if (!scene) nextPage();
      if (x + w + 2 > scene.width) { x = 2; y += rowHeight + 4; rowHeight = 0; }
      if (y + h + 2 > scene.height) nextPage();
      tile.x = x; tile.y = y; scene.placements.push(tile);
      x += w + 4; rowHeight = Math.max(rowHeight, h);
    }
  };
  // Every art variant gets context before repeated orientations consume space.
  addPages(unknown.map(asset => ({ asset, transform: STUDY_TRANSFORMS[0] })), 'All variants');
  const complex = unknown.filter(asset => (isOrganicAsset(asset) && (asset.w > 1 || asset.h > 1 ||
    !/NW[ox]NE[ox]SE[ox]SW[ox]N[ox]E[ox]S[ox]W[ox]/i.test(asset.id))) || ['crypt 1.png', 'crypt 7.png'].includes(asset.id));
  const blockFamilies = new Map();
  for (const asset of unknown.filter(asset => /^org-blocks-/.test(asset.id))) {
    const signature = asset.id.match(/NW[ox]NE[ox]SE[ox]SW[ox]N[ox]E[ox]S[ox]W[ox]/i)?.[0] || asset.id;
    if (!blockFamilies.has(signature)) blockFamilies.set(signature, asset);
  }
  const blockExamples = [...blockFamilies.values()].slice(0, 3);
  for (const asset of [...complex, ...blockExamples]) {
    addPages(STUDY_TRANSFORMS.map(transform => ({ asset, transform })), `Orientations: ${asset.id.replace(/\.png$/, '')}`);
  }
  return { version: 1, id, name: 'Organic and crypt context study', clearance: 2,
    scope: ['organic', 'crypt'], unknownAssets: unknown.map(asset => asset.id), pages };
}
