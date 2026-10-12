import { blankScene, createPlacement, dimensions, sortAssets, isReviewableAsset } from './model.mjs';
import { STUDY_TRANSFORMS } from './study.mjs';

function packReviewTiles(assets, poses, id, label) {
  const pages = [];
  let page, x, y, rowHeight;
  const next = () => {
    page = blankScene(); page.token = { ...page.token, x: 0, y: 0 };
    page.name = `${label} ${pages.length + 1}`; page.study = { id, page: pages.length };
    pages.push(page); x = 3; y = 3; rowHeight = 0;
  };
  for (const asset of assets) for (const pose of poses) {
    const tile = createPlacement(asset, 0, 0, `study-${id}-${asset.id}-${pose.turn}-${Number(pose.flipX)}`);
    Object.assign(tile, pose);
    const [w,h] = dimensions(tile);
    if (w+6>32 || h+6>24) throw Error(`Study tile too large: ${asset.id}`);
    if (!page) next();
    if (x+w+3>page.width) { x=3; y+=rowHeight+4; rowHeight=0; }
    if (y+h+3>page.height) next();
    tile.x=x; tile.y=y; page.placements.push(tile); x+=w+4; rowHeight=Math.max(rowHeight,h);
  }
  return pages;
}

export function buildPlacementGapPages(assets, knowledge, id) {
  const unknown = sortAssets(assets).filter(asset => isReviewableAsset(asset) && knowledge[asset.id]?.digest !== asset.digest);
  return { unknownAssets: unknown.map(asset=>asset.id), pages: packReviewTiles(unknown,STUDY_TRANSFORMS,id,'Placement gaps') };
}

export function buildLightingReviewPages(assets, profiles, id) {
  const pending = sortAssets(assets).filter(asset => profiles[asset.id]?.digest === asset.digest && profiles[asset.id].reviewReasons.length);
  return { lightingAssets: pending.map(asset=>asset.id), pages: packReviewTiles(pending,[STUDY_TRANSFORMS[0]],id,'lighting') };
}
