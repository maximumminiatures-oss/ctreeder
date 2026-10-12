import { ORGANIC_ASSET_SIGNATURES } from "./organic-asset-geometry.js";
import { getReviewedTileRule, movementIntersects, reviewedTileMovementSegments } from "./reviewed-tile-rules.js";

const ORGANIC_SIGNATURE_PATTERN = /(NW[ox]NE[ox]SE[ox]SW[ox]N[ox]E[ox]S[ox]W[ox])/i;
const reviewedSignatures = new Map();
const tileDataCache = new WeakMap();
const movementCache = new WeakMap();

export const ORGANIC_SIDES = Object.freeze(["north", "east", "south", "west"]);
export const ORGANIC_OPPOSITE_SIDE = Object.freeze({
  north: "south",
  east: "west",
  south: "north",
  west: "east"
});

const SIDE_TO_VECTOR = Object.freeze({
  north: [0, -1],
  east: [1, 0],
  south: [0, 1],
  west: [-1, 0]
});
const CORNER_TO_VECTOR = Object.freeze({
  nw: [-1, -1],
  ne: [1, -1],
  se: [1, 1],
  sw: [-1, 1]
});

function normalizeFilledValue(value) {
  const text = String(value ?? "").trim().toLowerCase();
  if (value === true || text === "o" || text === "filled" || text === "blocked" || text === "closed") {
    return "o";
  }
  return "x";
}

export function normalizeOrganicAssetName(asset) {
  if (!asset) {
    return "";
  }
  const fileName = String(asset || "").split(/[\\/]/).pop();
  return fileName.endsWith(".png") ? fileName : `${fileName}.png`;
}

export function parseOrganicSignature(value) {
  const asset = normalizeOrganicAssetName(value);
  const rule = getReviewedTileRule(asset);
  if(rule?.w===1 && rule?.h===1) {
    if(reviewedSignatures.has(asset)) return reviewedSignatures.get(asset);
    const cell=rule.cells[0];
    const parsed={ signature: asset, sides:Object.fromEntries(ORGANIC_SIDES.map((side,i)=>[side,cell.sides[i]?'o':'x'])),
      corners:Object.fromEntries(['nw','ne','se','sw'].map((corner,i)=>[corner,cell.corners[i]?'o':'x'])) };
    reviewedSignatures.set(asset,parsed);
    return parsed;
  }
  const match = String(ORGANIC_ASSET_SIGNATURES[asset] || value || "").match(ORGANIC_SIGNATURE_PATTERN);
  if (!match) {
    return null;
  }
  const signature = match[1];
  const pairs = [...signature.matchAll(/(NW|NE|SE|SW|N|E|S|W)([ox])/gi)];
  const data = {
    signature,
    corners: {},
    sides: {}
  };
  for (const [, key, rawValue] of pairs) {
    const normalizedKey = key.toLowerCase();
    const filled = normalizeFilledValue(rawValue);
    if (normalizedKey === "n") data.sides.north = filled;
    if (normalizedKey === "e") data.sides.east = filled;
    if (normalizedKey === "s") data.sides.south = filled;
    if (normalizedKey === "w") data.sides.west = filled;
    if (normalizedKey.length === 2) data.corners[normalizedKey] = filled;
  }
  return data;
}

export function parseOrganicKind(value) {
  const text = String(value || "").toLowerCase();
  const rule = getReviewedTileRule(value);
  if(rule) return rule.kind;
  if (text.includes("org-blocks-")) return "blocks";
  if (text.includes("org-free-")) return "free";
  return null;
}

function vectorToSide(x, y) {
  if (x === 0 && y === -1) return "north";
  if (x === 1 && y === 0) return "east";
  if (x === 0 && y === 1) return "south";
  if (x === -1 && y === 0) return "west";
  return null;
}

function vectorToCorner(x, y) {
  if (x === -1 && y === -1) return "nw";
  if (x === 1 && y === -1) return "ne";
  if (x === 1 && y === 1) return "se";
  if (x === -1 && y === 1) return "sw";
  return null;
}

function transformVector(vector, rotationTurns = 0, flipX = false, flipY = false) {
  let [x, y] = vector;
  if (flipX) x = -x;
  if (flipY) y = -y;
  const turns = ((Number(rotationTurns) || 0) % 4 + 4) % 4;
  for (let index = 0; index < turns; index += 1) {
    [x, y] = [-y, x];
  }
  return [x, y];
}

export function transformOrganicSignature(signatureData, rotationTurns = 0, flipX = false, flipY = false) {
  if (!signatureData) {
    return null;
  }
  const transformed = {
    signature: signatureData.signature || null,
    corners: {},
    sides: {}
  };
  for (const [side, vector] of Object.entries(SIDE_TO_VECTOR)) {
    const [x, y] = transformVector(vector, rotationTurns, flipX, flipY);
    const target = vectorToSide(x, y);
    if (target) {
      transformed.sides[target] = normalizeFilledValue(signatureData.sides?.[side]);
    }
  }
  for (const [corner, vector] of Object.entries(CORNER_TO_VECTOR)) {
    const [x, y] = transformVector(vector, rotationTurns, flipX, flipY);
    const target = vectorToCorner(x, y);
    if (target) {
      transformed.corners[target] = normalizeFilledValue(signatureData.corners?.[corner]);
    }
  }
  return transformed;
}

function normalizeOrganicMeta(tile) {
  const raw = tile?.meta?.organic || tile?.organic || null;
  if (!raw) {
    return null;
  }
  if (typeof raw === "string") {
    return { asset: raw };
  }
  if (typeof raw === "object") {
    return raw;
  }
  return null;
}

function sidesFromMeta(meta) {
  const source = meta?.sides || meta?.edges || null;
  if (!source || typeof source !== "object") {
    return null;
  }
  return {
    north: normalizeFilledValue(source.north ?? source.n),
    east: normalizeFilledValue(source.east ?? source.e),
    south: normalizeFilledValue(source.south ?? source.s),
    west: normalizeFilledValue(source.west ?? source.w)
  };
}

function cornersFromMeta(meta) {
  const source = meta?.corners || null;
  if (!source || typeof source !== "object") {
    return null;
  }
  return {
    nw: normalizeFilledValue(source.nw ?? source.NW),
    ne: normalizeFilledValue(source.ne ?? source.NE),
    se: normalizeFilledValue(source.se ?? source.SE),
    sw: normalizeFilledValue(source.sw ?? source.SW)
  };
}

export function getOrganicTileData(tile) {
  const meta = normalizeOrganicMeta(tile);
  if (!meta) {
    return null;
  }
  const cacheKey=[meta.asset,meta.kind,meta.signature,meta.rotationTurns,meta.rotation,meta.flipX,meta.flippedX,meta.flipY,meta.flippedY].join(':');
  const cached=tileDataCache.get(meta);
  if(cached?.key===cacheKey && (getReviewedTileRule(meta.asset) || (!meta.sides && !meta.edges && !meta.corners))) return cached.data;
  const asset = meta.asset ? normalizeOrganicAssetName(meta.asset) : "";
  const kind = meta.kind || parseOrganicKind(asset) || parseOrganicKind(meta.signature);
  const directSides = sidesFromMeta(meta);
  const directCorners = cornersFromMeta(meta);
  const pixelSignature = getReviewedTileRule(asset) ? asset : ORGANIC_ASSET_SIGNATURES[asset];
  const parsed = pixelSignature ? parseOrganicSignature(pixelSignature) : directSides
    ? { signature: meta.signature || null, corners: directCorners || {}, sides: directSides }
    : parseOrganicSignature(meta.signature || asset);
  if (!parsed) {
    return null;
  }
  const rotationTurns = Number(meta.rotationTurns ?? meta.rotation ?? 0) || 0;
  const flipX = meta.flipX === true || meta.flippedX === true;
  const flipY = meta.flipY === true || meta.flippedY === true;
  const transformed = directSides && !pixelSignature ? parsed : transformOrganicSignature(parsed, rotationTurns, flipX, flipY);
  const data = {
    kind,
    asset,
    rotationTurns,
    flipX,
    flipY,
    corners: transformed.corners,
    sides: transformed.sides
  };
  tileDataCache.set(meta,{key:cacheKey,data});
  return data;
}

export function createOrganicTileMeta(asset, options = {}) {
  const normalizedAsset = normalizeOrganicAssetName(asset);
  const signature = options.signature || parseOrganicSignature(normalizedAsset)?.signature || null;
  return {
    kind: options.kind || parseOrganicKind(normalizedAsset) || parseOrganicKind(signature),
    asset: normalizedAsset,
    signature,
    rotationTurns: Number(options.rotationTurns ?? options.rotation ?? 0) || 0,
    flipX: options.flipX === true || options.flippedX === true,
    flipY: options.flipY === true || options.flippedY === true,
    ...(options.sides || options.edges ? { sides: sidesFromMeta(options) } : {}),
    ...(options.corners ? { corners: cornersFromMeta(options) } : {})
  };
}

export function setOrganicTileMeta(tile, asset, options = {}) {
  if (!tile) {
    return null;
  }
  if (!tile.meta || typeof tile.meta !== "object") {
    tile.meta = {};
  }
  tile.meta.organic = createOrganicTileMeta(asset, options);
  return tile.meta.organic;
}

export function clearOrganicTileMeta(tile) {
  if (tile?.meta?.organic) {
    delete tile.meta.organic;
  }
}

export function isOrganicTile(tile) {
  return getOrganicTileData(tile) !== null;
}

export function isOrganicBlockingTile(tile) {
  return getOrganicTileData(tile)?.kind === "blocks";
}

export function isInvalidOrganicFreeTile(tile) {
  const data = getOrganicTileData(tile);
  return data?.kind === "free" && ORGANIC_SIDES.every((side) => data.sides?.[side] === "o");
}

export function isOrganicMovementBlockingTile(tile) {
  return isOrganicBlockingTile(tile) || isInvalidOrganicFreeTile(tile);
}

export function organicBlocksSide(tile, side) {
  const data = getOrganicTileData(tile);
  if (!data) {
    return false;
  }
  return data.sides?.[side] === "o";
}

export function getOrganicBlockedSides(tile) {
  return ORGANIC_SIDES.filter((side) => organicBlocksSide(tile, side));
}

export function isOrganicPillarTile(tile) {
  return isOrganicMovementBlockingTile(tile) && getOrganicBlockedSides(tile).length === 0;
}

export function directionToOrganicSide(dx, dy) {
  if (dx === 0 && dy === -1) return "north";
  if (dx === 1 && dy === 0) return "east";
  if (dx === 0 && dy === 1) return "south";
  if (dx === -1 && dy === 0) return "west";
  return null;
}

export function canCrossOrganicEdge(fromTile, toTile, dx, dy) {
  if(fromTile && toTile) {
    const a=[fromTile.x+.5,fromTile.y+.5],b=[toTile.x+.5,toTile.y+.5];
    for(const tile of [fromTile,toTile]) {
      const data=getOrganicTileData(tile);
      if(!data) continue;
      let cached=movementCache.get(tile);
      if(cached?.data!==data || cached.x!==tile.x || cached.y!==tile.y) {
        const pose={x:tile.x,y:tile.y,w:1,h:1,turn:data.rotationTurns,flipX:data.flipX,flipY:data.flipY};
        cached={data,x:tile.x,y:tile.y,segments:reviewedTileMovementSegments(data.asset,pose)};
        movementCache.set(tile,cached);
      }
      if(cached.segments.some(([c,d])=>movementIntersects(a,b,c,d))) return false;
    }
  }
  const side = directionToOrganicSide(dx, dy);
  if (!side) {
    return true;
  }
  const opposite = ORGANIC_OPPOSITE_SIDE[side];
  return !organicBlocksSide(fromTile, side) && !organicBlocksSide(toTile, opposite);
}
