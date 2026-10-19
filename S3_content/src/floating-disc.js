import { routeOf, routeStep, routeKey, sameRoute } from './underpasses.js';
export const isFloatingDisc = character => character?.summon?.kind === 'floating-disc';
export const FLOATING_DISC_COLOR = '#1b3e42';
export const DISC_HOUR_MS = 60 * 60 * 1000;
export const floatingDiscSlotsAvailable = (state, casterId = null) => Math.max(0, 16 - state.characters.length -
  state.characters.filter(character => character.id !== casterId && character.pendingSpell?.spell === 'floating disc' && character.pendingSpell.phase === 'critical').length);

export function createFloatingDiscs(state, caster, { count = 1, hours = 1 } = {}) {
  if (![1, 2].includes(count) || ![1, 2].includes(hours)) throw new Error('Invalid Floating Disc effect.');
  if (floatingDiscSlotsAvailable(state, caster.id) < count) throw new Error(`Floating Disc needs ${count} free party ${count === 1 ? 'slot' : 'slots'}.`);
  const created = [];
  for (let index = 0; index < count; index++) {
    const disc = {
      id: `floating-disc-${caster.id}-${Date.now()}-${Math.floor(Math.random() * 1e9)}-${index}`,
      name: 'Floating Disc', hp: 0, maxHitPoints: 0, armorClass: 0, gear: [],
      colorId: 'floating-disc', colorValue: FLOATING_DISC_COLOR,
      gearSlotsTotal: 20, stats: { STR: 20 }, ancestry: '', className: '',
      equipmentInitialized: true, armorEquipmentInitialized: true,
      x: Number(caster.x), y: Number(caster.y), roomId: caster.roomId, routeId: routeOf(state, caster),
      summon: { kind: 'floating-disc', casterId: caster.id, remainingMs: hours * DISC_HOUR_MS,
        lastCasterX: Number(caster.x), lastCasterY: Number(caster.y), lastCasterRouteId: routeOf(state, caster), trail: [] }
    };
    state.characters.push(disc);
    created.push(disc);
  }
  return created;
}

export function advanceFloatingDiscTime(state, milliseconds) {
  const expired = [];
  for (const disc of state.characters.filter(isFloatingDisc)) {
    const caster = state.characters.find(character => character.id === disc.summon.casterId);
    disc.summon.remainingMs = Math.max(0, disc.summon.remainingMs - Math.max(0, Number(milliseconds) || 0));
    if (!caster || caster.dead || caster.slain || Number(caster.hp) <= 0 || !disc.summon.remainingMs) expired.push(disc);
  }
  return expired;
}

const directions = [[0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]];
const distance = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export function followFloatingDiscs(state, canStep) {
  const moves = [];
  if (state.combat?.active) return moves;
  const discs = state.characters.filter(isFloatingDisc);
  for (const disc of discs) {
    const caster = state.characters.find(character => character.id === disc.summon.casterId);
    if (!caster || caster.dead || caster.slain || Number(caster.hp) <= 0 || !Number.isFinite(Number(caster.x)) || !Number.isFinite(Number(caster.y))) continue;
    const summon = disc.summon;
    const changed = caster.x !== summon.lastCasterX || caster.y !== summon.lastCasterY || routeOf(state, caster) !== (summon.lastCasterRouteId || '');
    if (changed) {
      summon.trail.unshift({ x: summon.lastCasterX, y: summon.lastCasterY, routeId: summon.lastCasterRouteId || '' });
      summon.trail = summon.trail.slice(0, 12);
      summon.lastCasterX = Number(caster.x); summon.lastCasterY = Number(caster.y);
      summon.lastCasterRouteId = routeOf(state, caster);
    }
    const rank = discs.filter(other => other.summon.casterId === caster.id).indexOf(disc);
    if (!changed && sameRoute(state, disc, caster) && distance(disc, caster) <= rank + 1) continue;
    let target = changed ? summon.trail[Math.min(rank, summon.trail.length - 1)] || caster : caster;
    if (distance(disc, target) === 0 && (distance(disc, caster) > rank + 1 || !sameRoute(state, disc, caster))) target = caster;
    const queue = [{ x: Number(disc.x), y: Number(disc.y), routeId: routeOf(state, disc), first: null }];
    const seen = new Set([routeKey(queue[0])]);
    const scoreAt = point => distance(point, target) + (sameRoute(state, point, target) ? 0 : 24);
    let best = queue[0], bestDistance = scoreAt(best);
    for (let index = 0; index < queue.length && index < 625; index++) {
      const point = queue[index], score = scoreAt(point);
      if (score < bestDistance) { best = point; bestDistance = score; }
      if (!score) break;
      for (const [dx, dy] of directions) {
        const x = point.x + dx, y = point.y + dy, next = routeStep(state, point, { x, y });
        if (!next) continue;
        const key = routeKey(next);
        if (seen.has(key) || !canStep(point.x, point.y, x, y, point)) continue;
        seen.add(key); queue.push({ ...next, first: point.first || [dx, dy] });
      }
    }
    if (!best.first) continue;
    const before = { x: Number(disc.x), y: Number(disc.y), roomId: disc.roomId, routeId: routeOf(state, disc) };
    const next = routeStep(state, disc, { x: disc.x + best.first[0], y: disc.y + best.first[1] });
    Object.assign(disc, next);
    disc.roomId = state.tiles[disc.y * state.map.width + disc.x]?.roomId || null;
    moves.push({ disc, before });
  }
  return moves;
}
