import { areaSpellVisuals } from './area-spells.js';
import { canTargetAtRange } from './targeting.js';
import { routeOf } from './underpasses.js';

export const SPELL_TEMPLATE_ART = Object.freeze({
  web: { path: './assets/web.png', size: 6 },
  silence: { path: './assets/silence.png', size: 6 },
  'magic circle': { path: './assets/mqgic-circle.png', size: 7 },
  fireball: { path: './assets/fireball.png', size: 7 },
  'burning hands': { path: './assets/burning-hands.png', size: 3 }
});

export function spellTemplateFits(spell, rect) {
  const template = SPELL_TEMPLATE_ART[spell];
  return Boolean(template && rect?.width === template.size && rect?.height === template.size);
}

export function ongoingSpellTemplates(state, { now = Date.now() } = {}) {
  const visuals = areaSpellVisuals(state, { now });
  // Retain support for generic source-owned area records as well as live
  // Magic Circle areas supplied by areaSpellVisuals.
  for (const owner of [state, ...(state.characters || []), ...(state.entities || [])]) {
    for (const effect of owner.spellEffects || []) {
      if (String(effect.spell || '').toLowerCase() !== 'magic circle' || effect.kind !== 'area' ||
          effect.active === false || effect.ended || effect.rounds != null && !(effect.rounds > 0)) continue;
      visuals.push({ id: effect.id, spell: 'magic circle', routeId: effect.routeId || '', artTransform: effect.artTransform,
        rect: { x: effect.x, y: effect.y, width: effect.width, height: effect.height }, opacity: 1 });
    }
  }
  return visuals.filter(visual => visual.spell !== 'fireball' && spellTemplateFits(visual.spell, visual.rect));
}

export function burningHandsArtPreview(state, caster) {
  const pending = caster?.pendingSpell;
  if (pending?.spell !== 'burning hands' || pending.phase !== 'targeting') return null;
  const radius = pending.radius, routeId = routeOf(state, caster), cells = [];
  for (let y = Math.max(0, caster.y - radius); y <= Math.min(state.map.height - 1, caster.y + radius); y++)
    for (let x = Math.max(0, caster.x - radius); x <= Math.min(state.map.width - 1, caster.x + radius); x++) {
      const cell = { x, y, routeId };
      if (canTargetAtRange(state, caster, cell, radius, { requireLight: false, areaEffect: true })) cells.push(cell);
    }
  return { spell: pending.spell, cells, routeId, color: caster.colorValue, artTransform: pending.artTransform,
    rect: { x: caster.x - radius, y: caster.y - radius, width: radius * 2 + 1, height: radius * 2 + 1 } };
}
