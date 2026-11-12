import { routeOf, routeStep, routeKey } from './underpasses.js';

export const monsterIntelligence = monster => Number(monster?.I ?? monster?.['**I**'] ?? 0) || 0;
const randomEntry = (entries, random) => entries[Math.min(entries.length - 1, Math.floor(random() * entries.length))] || null;

// Plans are supplied by the runtime so targeting uses its real terrain, sight and attack rules.
export function selectMonsterAiTarget({ intelligence, targets, attacks, planAttack, distance, random = Math.random }) {
  if (!targets.length) return null;
  const nearest = () => {
    const closest = Math.min(...targets.map(distance));
    return randomEntry(targets.filter(target => distance(target) === closest), random);
  };
  const ranked = attacks.slice().sort((a, b) => b.averageDamage - a.averageDamage);
  if (intelligence < -1) return { target: nearest(), attack: ranked[0] || null, plan: null };
  if (intelligence < 1) return null;
  const candidates = targets.flatMap(target => {
    for (const attack of intelligence <= 2 ? ranked.slice(0, 1) : ranked) {
      const plan = planAttack(target, attack);
      if (plan) return [{ target, attack, plan }];
    }
    return [];
  });
  const wizards = intelligence > 2 ? candidates.filter(({ target }) => /\bwizard\b/i.test(target.className || target.class || '')) : [];
  const pool = wizards.length ? wizards : candidates;
  if (!pool.length) return { target: nearest(), attack: ranked[0] || null, plan: null };
  const hp = Math.min(...pool.map(({ target }) => Number(target.hp)));
  return randomEntry(pool.filter(({ target }) => Number(target.hp) === hp), random);
}

// Search beyond this turn, then return only the affordable prefix towards genuine cover.
export function planMonsterCover(state, monster, { movement, canStep, isCover, stepCost = () => 1, maxNodes = 2048 } = {}) {
  if (!(movement > 0) || !Number.isFinite(movement)) return null;
  const start = { x: Number(monster.x), y: Number(monster.y), routeId: routeOf(state, monster), cost: 0, steps: [] };
  const queue = [start], cheapest = new Map([[routeKey(start), 0]]);
  const directions = [[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  for (let visited = 0; queue.length && visited < maxNodes; visited++) {
    queue.sort((a, b) => a.cost - b.cost);
    const point = queue.shift();
    if (point.cost !== cheapest.get(routeKey(point))) continue;
    if (isCover(point)) {
      const steps = point.steps.filter(step => step.cost <= movement);
      return steps.length ? { ...steps.at(-1), steps, reachesCover: point.cost <= movement } : null;
    }
    const cost = Number(stepCost(point.x, point.y, point));
    if (!(cost > 0) || !Number.isFinite(cost)) continue;
    for (const [dx, dy] of directions) {
      const x = point.x + dx, y = point.y + dy;
      if (x < 0 || y < 0 || x >= state.map.width || y >= state.map.height) continue;
      const next = routeStep(state, point, { x, y });
      if (!next || (cheapest.get(routeKey(next)) ?? Infinity) <= point.cost + cost || !canStep(point, next)) continue;
      const step = { ...next, cost: point.cost + cost };
      cheapest.set(routeKey(next), step.cost);
      queue.push({ ...step, steps: [...point.steps, step] });
    }
  }
  return null;
}
