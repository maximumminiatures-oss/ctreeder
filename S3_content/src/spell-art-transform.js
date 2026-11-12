// Visual entropy is separate from injected gameplay dice/random streams.
export function createSpellArtTransform(random = null) {
  const values = random ? [random(), random(), random()] :
    Array.from(crypto.getRandomValues(new Uint32Array(3)), value => value / 0x100000000);
  return { rotation: Math.floor(values[0] * 4) * 90, flipH: values[1] < .5, flipV: values[2] < .5 };
}

export function drawSpellArtImage(ctx, image, rect, transform, tileSize) {
  const x = rect.x * tileSize, y = rect.y * tileSize;
  const width = rect.width * tileSize, height = rect.height * tileSize;
  const rotation = [0, 90, 180, 270].includes(transform?.rotation) ? transform.rotation : 0;
  if (!rotation && !transform?.flipH && !transform?.flipV) {
    ctx.drawImage(image, x, y, width, height);
    return;
  }
  ctx.save();
  ctx.translate(x + width / 2, y + height / 2);
  ctx.rotate(rotation * Math.PI / 180);
  ctx.scale(transform?.flipH ? -1 : 1, transform?.flipV ? -1 : 1);
  ctx.drawImage(image, -width / 2, -height / 2, width, height);
  ctx.restore();
}
