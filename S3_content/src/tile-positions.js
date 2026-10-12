function center(state,x,y) {
  const tile=x>=0 && y>=0 && x<state.map.width && y<state.map.height ? state.tiles[y*state.map.width+x] : null;
  const point=tile?.meta?.visualCenter;
  return [x+(point?.[0] ?? .5),y+(point?.[1] ?? .5)];
}

// Keep curved-corridor tokens and light on the floor, including interpolated peer movement.
export function visualTilePoint(state,x,y) {
  x=Number(x); y=Number(y);
  const left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top;
  const a=center(state,left,top);
  if(!fx && !fy) return a;
  const b=center(state,left+1,top),c=center(state,left,top+1),d=center(state,left+1,top+1);
  return a.map((v,i)=>(v*(1-fx)+b[i]*fx)*(1-fy)+(c[i]*(1-fx)+d[i]*fx)*fy);
}
