import { areaSpellVisuals } from './area-spells.js';

export const SPELL_TEMPLATE_ART = Object.freeze({
  web: { path: './assets/web.png', size: 6 },
  silence: { path: './assets/silence.png', size: 6 },
  'magic circle': { path: './assets/mqgic-circle.png', size: 7 },
  fireball: { path: './assets/fireball.png', size: 7 }
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
      visuals.push({ id: effect.id, spell: 'magic circle', routeId: effect.routeId || '',
        rect: { x: effect.x, y: effect.y, width: effect.width, height: effect.height }, opacity: 1 });
    }
  }
  return visuals.filter(visual => visual.spell !== 'fireball' && spellTemplateFits(visual.spell, visual.rect));
}
