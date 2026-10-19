# Concealment and encounters

Local implementation added October 13, 2026. No production deployment is
implied by this document.

## Invisibility and surprise

- Halfling invisibility is a free, once-per-beneficial-rest activation lasting
  three rounds. A rest that grants no recovery does not restore it.
- Invisible tokens are hollow rings. Invisibility grants stealth, attack
  advantage, eligible backstab, and incoming attack disadvantage. Invisible
  creatures are excluded from direct ranged targeting and encounter detection;
  area effects can still hit them.
- Surprise is a separate initiative round. The initiator, currently hidden
  participants, and goblins act; other participants wait for normal round one.
  Mimic pickup and doppelganger ambushes explicitly surprise non-goblin party
  members. Attacking a disguised mimic surprises the mimic instead.
- Monster hiders keep one d20 + D roll. Each nearby character's passive Wisdom
  can reveal them later. Ordinary hidden monster tokens and cards are omitted.
  Native invisibility is activated once during the initial hiding attempt.

October 15 refinements: hiding compares that one total against the highest
10 + WIS modifier among awake, living party members within fourteen squares.
An equal passive score detects the monster. A new high-Wisdom arrival can still
detect it without rerolling. Successful hiders remain absent from both ordinary
map tokens and the monster list while approaching, including native invisible
monsters until detected or revealed.

Melee ambushes start when a legal attack position is reachable with the monster's
full movement (normally six movement plus one-square reach). Faster creatures
can initiate from farther away. Ranged ambushers plan to a visible firing square
and may open ordinary doors. Held, locked and unknown secret doors cannot be
silently crossed to qualify an ambush. The surprise round includes combat
monsters and goblin party members, not other party members.

Exploration never keeps a monster visible: its current square must be lit and
in a living awake observer's line of sight. Local multiplayer ownership still
limits observers. Direct attacks and targeted spells use the same visibility
check, while area effects can strike hidden creatures. Unseen attackers gain
advantage. Ranged monsters seek the farthest legal circular-range firing square
reachable on their turn, preferring darkness when distance is equal and charging
terrain costs. The previously requested monster-turn cards/rings remain visible
during their brief turn presentation even when their map token is hidden.

Selected invisible party tokens keep a white outside outline and a wider
colored inner ring. Floating Discs are round with fixed RGB 27, 62, 66 and have
no color control. Their outer rim uses their caster's current token color;
selection temporarily replaces that rim with white.

## Reactions and companions

Appearance pauses actions and time while an eligible speaker's owner or the
host answers the reaction prompt. The highest-CHA character sharing a language
within 16 squares can add their modifier to 2d6. Otherwise 2d6 is unmodified.
The requested hostile/suspicious/neutral/curious/friendly table is used.

Curious monsters follow for one active in-game hour and halve wandering-check
frequency. Friendly monsters use the existing party controls and assignment
system. Their native statistics are retained; carried gear consumes slots.
Cumulative damage, not current missing HP, determines departure. Departures
wait until combat ends, drop carried gear, then walk out of party visibility.

Doppelgangers keep real mechanics separate from copied appearance. They retain
their dagger, 12 slots, darkvision, and inability to use copied powers. A dead
victim's inventory is placed in the dungeon, with a read-only corpse sheet.
At the 16-character cap the corpse frees the party slot; otherwise the dead
mini-sheet remains until buried. Rest completion, torch expiry/snuffing, and
dismissal can trigger betrayal.

Morale is a collective DC 15 Wisdom check at the requested half-HP and group
loss thresholds. Undead, oozes, demons, devils, and golems are immune. Fleeing
uses the same directional rules as Turn Undead.

## Defaults awaiting design confirmation

These were raised in the task's questions. They are explicit defaults, not
claims that the user has confirmed them:

- Halfling invisibility survives offense for its full three rounds; wizard
  Invisibility ends on attacking or casting. Wizard critical choices are
  twenty rounds or one target within ten feet.
- Missing ability scores are represented by `10 + 2 * modifier` (minimum 1).
  Explicit monster statistics take priority over catalog recovery.
- Missing languages fall back to Common for speaking humanoids, and no shared
  language for animals and mindless creatures. Explicit languages take priority.
- The INT-below-10 automatic-hostility threshold applies to devils, fiends,
  and undead. Demons always attack.
- Morale flight lasts five rounds. Native monster invisibility defaults to
  three rounds and ends on offense, matching the Duergar entry.
- Either the chosen speaker's owner or the host can answer reactions.

The user confirmed that trap damage remains manual for this release. Trigger
records identify the affected character and mark disadvantage when that
character is invisible. No automated trap attack bonuses were invented.

## Implementation and verification

Pure rules: `concealment.js`, `encounters.js`, `companions.js`, `invisibility.js`.
Browser/server coordination: `main.js`; authoritative ownership: `rooms.py`.
Save normalization retains concealment, companion identity, and surprise state.
Companion ownership is assigned only from server-produced transitions.

Focused tests are in `concealment-encounters.test.mjs`, `spell-runtime.test.mjs`,
`rest.test.mjs`, and `test_rooms.py`. Private desktop/mobile screenshot checks
are under the workspace's `.dev/tests`, not shipped with the website.
