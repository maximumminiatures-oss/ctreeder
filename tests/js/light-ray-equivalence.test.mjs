import test from 'node:test';
import assert from 'node:assert/strict';
import {computeLightPolygonFromSegments} from '../../S3_content/src/light-geometry.js';
const ANGLE_EPSILON = 0.00008, RADIUS_RAY_COUNT = 96, TILE_SIZE_PX = 54;
// Keep the former per-intersection algorithm as an independent exact oracle.
// The optimized path must preserve every vertex, tolerance and first-hit tie.
function normalizeAngle(angle) {
  const twoPi = Math.PI * 2;
  const normalized = angle % twoPi;
  return normalized < 0 ? normalized + twoPi : normalized;
}

function cross(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

function raySegmentIntersection(origin, angle, segment, radiusPx) {
  const rayX = Math.cos(angle);
  const rayY = Math.sin(angle);
  const [a, b] = segment;
  const segX = b[0] - a[0];
  const segY = b[1] - a[1];
  const denom = cross(rayX, rayY, segX, segY);
  if (Math.abs(denom) < 0.000001) {
    return null;
  }
  const toSegmentX = a[0] - origin[0];
  const toSegmentY = a[1] - origin[1];
  const rayDistance = cross(toSegmentX, toSegmentY, segX, segY) / denom;
  const segmentDistance = cross(toSegmentX, toSegmentY, rayX, rayY) / denom;
  if (rayDistance < 0 || rayDistance > radiusPx || segmentDistance < -0.0001 || segmentDistance > 1.0001) {
    return null;
  }
  return {
    point: [origin[0] + rayX * rayDistance, origin[1] + rayY * rayDistance],
    distance: rayDistance
  };
}

function castRay(origin, angle, radiusPx, segments) {
  let closest = null;
  for (const segment of segments) {
    const hit = raySegmentIntersection(origin, angle, segment, radiusPx);
    if (!hit) {
      continue;
    }
    if (!closest || hit.distance < closest.distance) {
      closest = hit;
    }
  }
  if (closest) {
    return closest.point;
  }
  return [
    origin[0] + Math.cos(angle) * radiusPx,
    origin[1] + Math.sin(angle) * radiusPx
  ];
}

function collectRayAngles(sourcePoint, radiusPx, segments) {
  const angles = new Map();
  for (let index = 0; index < RADIUS_RAY_COUNT; index += 1) {
    const angle = (index / RADIUS_RAY_COUNT) * Math.PI * 2;
    angles.set(angle.toFixed(7), angle);
  }
  for (const segment of segments) {
    for (const point of segment) {
      if (Math.hypot(point[0] - sourcePoint[0], point[1] - sourcePoint[1]) > radiusPx + TILE_SIZE_PX) {
        continue;
      }
      const base = Math.atan2(point[1] - sourcePoint[1], point[0] - sourcePoint[0]);
      for (const offset of [-ANGLE_EPSILON, 0, ANGLE_EPSILON]) {
        const angle = normalizeAngle(base + offset);
        angles.set(angle.toFixed(7), angle);
      }
    }
  }
  return [...angles.values()].sort((a, b) => a - b);
}

test('prepared light rays exactly match the former algorithm for walls, diagonals, endpoints and near-parallel segments',()=>{
 let randomState=108742;
 const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
 for(let i=0;i<64;i++){
  const origin=i<5?[0,0]:[random()*1800,random()*1800],radius=[.001,54,351,675][i%4];
  const segments=Array.from({length:i%40},(_,j)=>{
   const a=[origin[0]+(random()-.5)*radius*3,origin[1]+(random()-.5)*radius*3];
   return [a,j%3===0?[a[0],a[1]+random()*radius]:j%3===1?[a[0]+random()*radius,a[1]]:[a[0]+(random()-.5)*radius,a[1]+(random()-.5)*radius]];
  });
  segments.push([[origin[0]-radius,origin[1]],[origin[0]+radius,origin[1]]]);
  segments.push([[origin[0],origin[1]],[origin[0]+radius,origin[1]+1e-9]]);
  const expected=collectRayAngles(origin,radius,segments).map(angle=>castRay(origin,angle,radius,segments));
  assert.deepEqual(computeLightPolygonFromSegments(origin,radius,segments),expected,'case '+i);
 }
});
