import { TILE_SIZE_PX } from './constants.js';
import { visualTilePoint } from './tile-positions.js';
import { isGaseousForm } from './conditions.js';

export const GASEOUS_FORM_ASSET = './assets/gaseous_form.png';
const tintedImages = new WeakMap();

export function tintedGaseousImage(image, color, createCanvas) {
  if (!image) return null;
  let colors = tintedImages.get(image);
  if (!colors) { colors = new Map(); tintedImages.set(image, colors); }
  if (colors.has(color)) return colors.get(color);
  const canvas = createCanvas(image.naturalWidth || image.width, image.naturalHeight || image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  // Use the supplied cloud alpha as a mask, without darkening the character's token color.
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'source-over';
  colors.set(color, canvas);
  return canvas;
}

export function drawGaseousToken(state, ctx, character, { image, createCanvas, isActive = false } = {}) {
  if (!isGaseousForm(character)) return false;
  const color = character.colorValue || '#174a9c';
  const tinted = image && createCanvas ? tintedGaseousImage(image, color, createCanvas) : null;
  if (!tinted) return false;
  const [cx, cy] = visualTilePoint(state, character.visualX ?? character.x, character.visualY ?? character.y)
    .map(value => value * TILE_SIZE_PX);
  const size = TILE_SIZE_PX;
  ctx.save();
  ctx.drawImage(tinted, cx - size / 2, cy - size / 2, size, size);
  if (isActive) {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(cx, cy, size * .42, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.restore();
  return true;
}
