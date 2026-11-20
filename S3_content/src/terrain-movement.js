export {isSlowWaterPlacement,isSlowWaterTile,isLegacyWaterMovementSegment} from './water-terrain.js';
import {isSlowWaterTile} from './water-terrain.js';
import {waterMovementExempt} from './water-rules.js';

export const movementStepCost=(state,x,y,creature=null)=>
  !waterMovementExempt(state,creature,x,y)&&isSlowWaterTile(state,x,y)?2:1;
export const WATER_STEP_DURATION_MS=320;
export const movementOverlayRadius=(state,x,y,points,creature=null)=>points/movementStepCost(state,x,y,creature);
