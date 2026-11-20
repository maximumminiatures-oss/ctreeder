// Movement coordinates do not change sheet contents. Normalization mirrors them in raw too.
function withoutVisualPosition(record){
  const {x,y,visualX,visualY,visualRouteId,...display}=record;
  return display;
}
export function characterViewSignature(character,context){
  const display=withoutVisualPosition(character);
  if(character.raw&&typeof character.raw==='object')display.raw=withoutVisualPosition(character.raw);
  return JSON.stringify([display,context]);
}
