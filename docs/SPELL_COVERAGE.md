# Spell Coverage

Audit: November 8, 2026. Coverage means defined and integrated game rules, not
merely a description in a JSON catalog or a successful generic casting check.

## Current Boundary

Tier 2 is the highest fully defined tier for both wizard and priest spells.
Wizard tiers 1 and 2 each contain twelve spells; priest tiers 1 and 2 each
contain six. Dedicated handlers, existing shared spell systems, and their tests
cover those lists. This is not a claim that every interaction is bug-free.

Wizard Tier 3 has twelve spells in the rulebook. Ten now have integrated effects:
Animate Dead, Dispel Magic, Fireball, Fly, Gaseous Form, Illusion, Lightning Bolt,
Magic Circle, Protection From Energy, and Speak With Dead. Fabricate and Sending
are explicitly unfinished by user decision and cannot be selected at level-up
or cast through the generic fallback. Thus Tier 2 remains the highest complete
tier. Higher-tier mishap tables do not imply corresponding spell coverage.

Protection From Energy was absent from the extracted catalog. The printed
wizard list includes it on page 53; its description is on page 68, beside
Protection From Evil. The November 8 correction restores its distinct Tier 3
record. Catalog presence alone must not be reported as implemented behavior.

## November 8 Tier 3 Decisions

| Spell | Approved Implementation |
| --- | --- |
| Animate Dead | Intact humanoid remains, skeleton or zombie, one party slot and game day. Separate controlled turns immediately after caster, even if caster sleeps, is dying, or dies. Caster-only multiplayer ownership and matching color. No equipment is created: inherit unlooted corpse gear; skeletons equip as fighters, zombies cannot equip. All carried gear drops with grave dust on expiry/dispel. Critical: two bodies or two days. Ancestry retains original type plus Skeleton/Zombie. |
| Fabricate | Unfinished; revisit with artwork and material/geometry rules. |
| Fly | Self, five rounds, six-square flight; melee immunity, normal attacks/gear, passes creatures, ignores ground hazards and water slowdown. Critical: ten rounds or twelve-square movement. |
| Gaseous Form | Self, ten rounds, six-square flight/sensing through darkness but not walls. Ordinary door gaps, not solid walls/force walls. No gear, attacks or casting; cannot be directly targeted, area damage halves, Web does not restrain. Critical: twenty rounds. Tint gaseous_form.png with token color. |
| Magic Circle | Fixed centered 7x7 Focus area, supplied artwork. Approved broad creature tags, not humanoid/species picks. Matching creatures cannot cross in either direction, including leaving if caught inside; cannot harm or mentally control anyone inside. Critical: two tags. |
| Protection From Energy | Focus; touch; immunity to fire, cold, or electricity. Critical: two creatures/one energy or one creature/two energies. |
| Sending | Unfinished; excluded from advancement and casting until messaging rules are defined. |
| Speak With Dead | INT modifier >= -2 corpse, three menu questions; critical six. Truth covers the current whole dungeon, with follow-ups for monster/treasure types and weighted authored memories. Repeated casting within 24 game hours makes any failure critical. |

Flight expiry above a pit causes a normal fall, never an adjacent-rim escape;
otherwise occupied landings use the nearest free square. Underpass routes remain
separate. Damage types now have canonical tags including lightning/electricity
aliases; the five random treasure elements remain a separate unchanged list.

The canonical damage tags are fire, cold, lightning (electricity), acid, poison,
thunder (sound), necrotic, radiant (holy), psychic, force (magic), bludgeoning,
piercing, and slashing. Explicit damage metadata takes precedence over prose.
Current energy immunity covers its chosen fire/cold/lightning tags; elemental
weapon damage is tracked separately so immunity does not erase mundane damage.

These user decisions supersede the earlier open proposals. Use existing
DC 13 casting, tier-3 mishaps, ownership, save/load, Focus, effect tracking,
underpass-route separation, and initial-casting-only critical conventions.

`tests/js/spell-catalog-coverage.test.mjs` checks the complete Tier 1-3 class
lists against the printed spell lists. It guards catalog extraction, not effect
implementation; keep these distinct in future progress reports.

## November 9 Animate Dead Clarifications

Undead act independently after the caster, never using the caster's action or
movement. They remain with their caster's player and keep the caster's color;
death or removal of the caster does not remove their turns or transfer ownership.
They may open/smash doors, climb, and carry gear up to their strength capacity.
They cannot wake creatures, stealth, pick locks, or search. Zombies cannot equip
anything; skeletons use fighter equipment rules. No normal-monster starting gear
is generated. A naked skeleton has AC 10 and Claw +1 for one damage; retained
corpse weapons/armor and subsequent equipment replace that fallback normally.
Corpse equipment is transferred, not copied, and all held gear drops on collapse.
