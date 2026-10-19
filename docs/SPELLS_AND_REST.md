# Spells and rest

## Import choices, talents and combat history

Fresh ShadowDarklings imports initialize choices separately from saved-character
loads. Wizards and priests choose two distinct tier-one spells; priests always
retain Turn Undead. Imported spell selections are discarded, while other rolled
talents are retained. Fighter mastery and Grit are chosen again, with the selected
mastery weapon added to gear (or dropped nearby if full). Additional imported
masteries remain additional choices, never duplicate masteries. Saved characters
keep their existing selections and pending choices.

The gold NAME-box button opens the same choice system for initial selections and
level gains. Spell descriptions may be opened without invalidating later picks,
even across state normalization. Wild talents choose either a talent or two stat
points, assigned one at a time. Scores may exceed 18 but player modifiers cap at
+4. Duplicate initiative advantage is rerolled. Armor mastery uses the mundane
base AC category, never the item's enchantment bonus.

Thief backstab uses two weapon dice initially, plus one weapon die per backstab
talent. Sleep, blindness, paralysis, surprise, invisibility and stealth qualify.
Elemental weapon dice are added once, not once per backstab die. Attack history
shows the short narrative, total to hit and damage; focusable hover values retain
the complete checks, reasons, individual damage dice and colored extremes.

Party order is local. The reorder/follow handle supports dragging above or below
another card and is protected from background card rebuilds during the drag.

## Wizard-created items and elemental resistance

Wizard talents can create weapons, armor, wands, potions or scrolls. Weapon, armor
and wand tables use d80, d75 and d91 respectively. Overlaps belong to the earlier
range: weapon elemental entries start at 72, armor resistance at 67, and tier-four
wands at 86. Elemental effects add 50 percent to the complete pre-elemental item
value, including any +1/+2/+3 premium. Wands cost ten times the equivalent scroll.

Crafted weapons add their elemental damage once per successful attack. Equipped
resistance armor halves matching damage, rounded down, and grants advantage on
matching saves. Common elemental synonyms are recognized. Existing manual trap
damage remains manual; future typed effects should use the shared resistance
helpers rather than duplicating their logic.

Wands use the normal class spell list and DC 10 + spell tier, even for unknown or
higher-tier spells. Ordinary failure does not lose the caster's known spell or
consume the wand, but disables that wand until a rest that grants recovery.
Natural 1 destroys the wand and invokes the appropriate Wizard Mishap table. Spell
effects not implemented yet still require manual resolution. Crafted scrolls are
above the wizard's currently unlocked tier, or tier five at the highest tier.
Learning from scrolls keeps the confirmed next-completed-rest DC 15 INT attempt;
the scroll is consumed on success or failure.

## Higher-tier Wizard Mishaps

The table is selected from the failed spell's tier, including wand and scroll
casts. Devastation samples two non-Devastation results from that same table.
All results, permanent losses, recovery restrictions and dungeon phenomena are
saved. Player-owned recovery commands are checked by the authoritative runtime.

- Tier 3-4 blast deals 2d6 to the caster and nearby creatures with line of effect.
  Duplicate refraction targets the caster and nearest ally. Incantation substitutes
  a random known spell, without another casting roll or action. Two gear units
  disappear on Ethereal Bandersnatch. Stat collapse sets one score to 3 until a
  successful rest, retaining later stat increases when restoring the original.
- Sinkholes have a six-square radius and 30-foot depth. Corporeal, non-flying
  creatures check DC 15 DEX or fall, become prone and take 3d6 damage. Eligible
  wizards receive Feather Fall before damage is applied. Existing sinkholes also
  catch later entrants; successful saves let a creature keep a foothold. Climb Out
  is a DC 15 STR action and moves the character to an available visible rim.
  Constrained maps without a usable outside square preserve a safe ledge instead
  of trapping the character permanently. Pit art is intentionally not invented.
- Petrification chooses 1d4 distinct limbs from two arms and two legs for 24 game
  hours. Each leg halves movement, rounded down; each arm removes one available
  hand. One-handed equipment replaces the other held item with one usable hand;
  two-handed equipment needs both. Torches released this way use normal dropping
  and extinguishing rules. Rest does not remove petrification early.
- Stupefaction blocks that spell tier until successful rest. Failed WIS checks
  cause raving for 1d10 rounds (tier 3-4) or 1d4 game hours (tier 5); raving blocks
  movement, actions and Focus. Radioactive enemies prioritize the visible caster
  for 1d4 rounds. Uncontained Channeling penalizes the failed tier and lower.
- Tier 5 Pyroclastic Extrusion deals 3d8 fire damage to nearby creatures, respecting
  resistance. Astral Incision permanently removes a random known spell. Grimlow
  is an actual hostile monster with a 2d4-round lifetime and no expiry corpse.
  Dark Plasma doubles weapon/monster attack damage for 2d6 rounds.
- Gate gives the caster 1d4 rounds to spend an action and pass DC 18 INT. Otherwise
  one random level-8+ source monster appears on free nearby floor; a crowded map
  retries rather than silently losing the summon. Closing and spawning are
  one-shot results. The summon retains its ordinary monster statistics.
- Runaway Arcana checks the original spell at each subsequent caster turn. A
  failure retargets a random visible creature without consuming an action or
  losing a known spell; success ends the loop. Tier bans and all-tier casting
  disadvantage expire according to their specific rest/round rules.
- Ord's Balance opens an owned sacrifice picker. Eligible magic gear or known
  tier-3+ spells can be permanently sacrificed. Only when neither qualifies does
  the picker offer highest-tier known spells instead. If absolutely nothing is
  available, the debt persists until an eligible choice exists.
- Shred begins as a token-sized black circle at the caster's original square,
  growing one square of radius per combat round or ten exploration seconds. It
  masks all map art and objects except party tokens, without deleting exploration,
  moving with the caster, stopping traps, or impairing monster sight. Covered
  targets cannot be directly selected through the darkness.

Forced spell effects reuse existing implemented effects where available. Spells
whose effects are not implemented yet retain a persistent, explicit forced-cast
event with target IDs and a history message; they do not substitute unrelated
damage or pretend to resolve the spell. Higher-tier spell implementations should
consume this same forced-resolution path when added.

## Mage Armor

Mage Armor uses the normal Wizard DC 11 check and one combat action. It targets
only the caster and sets their final AC to exactly 14, or automatically 18 on a
natural 20, for ten rounds. There is no critical-choice popup, DEX addition,
minimum-AC comparison, armor/shield bonus or extra Shield of Faith bonus. Future
magic gear may define explicit exceptions; none are invented here.

The effect is not Focus and grants no invisibility. It uses the existing round
clock (ten seconds per round outside combat) and advances during rest/search.
AC hover text shows the value and remaining rounds. Expiry immediately restores
the ordinary equipment/DEX calculation. A successful recast replaces the old
effect and resets its ten rounds; a failed recast leaves the old effect intact.
Dungeon saves retain the effect, but importing a separately saved character into
a dungeon clears it like other temporary beneficial spell effects.

## Alarm and Floating Disc

Alarm is an optional Cast button in the Rest confirmation, also available from
Spellcasting. It uses the normal Wizard DC 11 casting and failure rules. One
successful cast prevents party surprise and halves hourly wandering checks for
one unfinished rest, including interruptions and resumes. Natural 20 quarters
the chance instead. A new rest after completion needs a new casting. Rest in the
starting room remains encounter-free. Other rest interruptions still use CON.

Floating Disc creates a temporary, owned party entry with 20 gear slots. It
counts toward the 16-entry cap, is reorderable and always follows its caster
outside combat, including through darkness. In combat it stays still, takes no
turn and blocks nobody. Its gear-only sheet has no creature statistics. Only
lanterns can equip; their light and fuel use the normal system. Inventory pickup,
equipment and lighting use the caster's action and turn restrictions in combat.
Discs do not eat, watch, recover, receive damage or trigger monster encounters.
Their carried supplies can contribute to a gathered party's rest.

Duration is one game hour, including searching and rest time; critical choices
are two one-hour discs or one two-hour disc. Pending criticals reserve a party
slot so another import cannot strand the choice. Two discs requires two slots.
Expiration or a missing, dying or dead caster drops all cargo and coins on each
disc's tile, preserving stacks and lit lanterns. Temporary summons cannot be
saved or imported as independent characters; dungeon saves retain their state.
Ownership follows the caster and cannot be assigned separately. Any Focus spell
also ends when its caster becomes dying or dead.

Cure Wounds is the first targeted spell effect. Light retains its existing
implementation. Magic Missile and Burning Hands are implemented offensive spells.

- The caster must know the spell, be able to act, own its multiplayer command,
  and have a combat action available. An attempted cast spends one action.
- Targets are party characters, including the caster and another player's
  character. Touch includes diagonals but cannot cross closed doors, walls,
  or blocked corners. Dead characters cannot be healed.
- The casting check is d20 + WIS modifier + applicable imported casting bonuses
  against DC 11. Natural 1 fails; natural 20 opens a persisted critical choice.
- Healing is (1 + floor(caster level / 2))d6, capped at maximum HP. Positive HP
  ends dying. Critical choices are double dice or double rolled total; choosing
  does not reroll the casting check or consume another action.
- Ordinary failure loses the spell until successful rest. Natural 1 additionally
  requires a 5 Gold sacrifice, paid from the caster's coins then Party Assets.
  The sacrifice remains paid if a later rest fails. It never awards XP.

## Party rest

- All living party characters must gather in one room. Dying characters must be
  healed first. Every connected multiplayer member, including spectators, must
  approve before supplies are consumed. Approval identity is server supplied.
- Each eight-hour attempt costs one ration per character and three torches
  total. Rations can be bought in bundles of three for five silver in the
  starting room. The paid campfire illuminates sleep and interruptions until
  the unfinished rest is completed.
- Each in-game hour takes one real second. The starting room has no resting
  encounters; elsewhere the existing wandering encounter chance is checked
  once per hour. The UI warns about the danger before resting.
- Watch shifts last two hours: positions 1/5/9/13 cover hours 1-2, positions
  2/6/10/14 cover 3-4, positions 3/7/11/15 cover 5-6, and positions 4/8/12/16
  cover 7-8. In multiplayer the order cycles one character per owner, starting
  with the rest initiator and preserving their preferred order within each owner.
  A new four-shift cycle returns to the initiator if they have another character.
  Server-owned membership data determines owners; the watch order is frozen
  for that unfinished rest and survives save/load.
- Combat pauses rest. Each sleeping character rolls a DC 12 CON interruption
  check. Any failure marks that character as gaining no benefit from the entire
  eight-hour attempt; the character still keeps accumulated hours and does not
  consume another ration when resuming. Passing does not immediately heal.
  Awake watchers skip the check and still qualify for full rest benefits.
  A rest ambush grants surprise-round turns to the monsters, watchers and
  goblins; other sleeping characters do not act until the next round.
- The party can resume after combat, with fresh multiplayer approval. Saved
  hours, failure flags, paid rations and the unfinished campfire are retained.
  Resuming the same party does not charge supplies again.
- At eight hours, characters who passed all interruptions regain maximum HP
  and ordinary lost spells. Priest spells requiring unpaid penance stay lost.
  Characters with any failed interruption gain neither HP nor spell recovery.
  The next eight-hour attempt starts fresh and needs fresh supplies.
- Completion displays "You were able to sleep peacefully" for uninterrupted
  rest, or "You've gotten what rest you can." after interruptions, followed by
  a separate no-benefit message for every character who failed recovery.

## Magic Missile

- Cast first, with INT plus applicable casting bonuses against DC 11. The spell
  inherently has advantage. No attack roll or AC comparison follows success.
- Success stores one pending 1d4 missile, then prompts "Pick target". Clicking
  a living, illuminated enemy with caster line of sight applies damage and
  turns the cream marker black. Walls and closed doors prevent targeting.
- Natural 20 prompts A: two 1d4 missiles, or B: one 1d8 missile. A can hit the
  same enemy twice or two different enemies. Each click resolves one missile.
- Pending missiles and their spent markers survive saves and multiplayer state
  updates. The casting action is spent once, never once per missile. Pending
  missiles block other actions but allow remaining combat movement. Auto-end-turn
  waits for resolution; End Turn explicitly forfeits unused missiles. Invalid
  targets spend nothing. Closing a completed
  popup does not apply another effect. Room receipts make retries idempotent.

## Targeting and ready spells

- Clicking an equipped weapon aims before rolling. Its red ring shows circular
  range, and illuminated targets within range and caster line of sight can be
  clicked. Aiming alone spends no action. This works from mini and popup sheets.
- Offensive spell buttons open a compact aiming popup with a cream ring. Near
  range is six squares and Far is twelve. Close range includes all eight adjacent
  cells; its circular outline accommodates diagonal neighbors.
- Range fill uses the token color at 20 percent opacity, clipped to lit,
  walkable floor. The thin range outline may extend into darkness without
  revealing anything there. Server targeting checks use the same range geometry.
- In combat, clicking unoccupied, lit floor walks a legal path using remaining
  movement, avoiding monsters and revealed traps. Characters can be passed
  through but cannot be the destination. Arrow/numpad movement remains immediate.
- Moving hides the aiming overlay but retains a successfully cast offensive
  spell. Selecting that spell again resumes it without rolling or spending
  another action. Partially fired Magic Missiles retain only their unused shots.
- Prepared effects expire on End Turn or can be explicitly discarded without
  refunding the casting action. A personal-character import never brings a
  prepared action into a new dungeon; full dungeon saves retain the current turn.

## Burning Hands

- Tier 1 wizard, INT plus casting bonuses vs DC 11. Casting spends the action
  and success prepares the flames, allowing repositioning before release.
- Release deals one shared 1d6 roll to nearby allies and enemies, sparing the
  caster. Walls and closed doors block the area. It can be released with the
  popup button or by clicking an enemy inside the ring.
- Critical choices are 2d6 damage, 1d12 damage, or 1d6 with double radius.
- Exposed instruments, wooden/leather items, and soft armor char once and lose
  half their original value. Wooden objects in the jewels category also char.
  Explicit metal clothing remains protected. All instruments char, even metal.
- Herbs, clothing, books, scrolls and rope become an ash pile with zero value
  and no usable equipment payload. Carried gear is outside the fire area.
- Magical items, weapons, gems, coins, metal jewelry/armor, bone armor, rations,
  and oil flasks are protected. Backpacks and sacks are otherwise unchanged
  unless explicitly described as wooden or leather.
- Damage names, values and provenance survive pickup, dropping and saves.
  Other fire-area effects should reuse fire-damage.js; Fireball is not yet
  implemented. Explicitly flammable non-treasure scenery is marked burning;
  ongoing fire damage, illumination, spread and explosion rules are not added.

## Canal water movement

- Canal water that formerly blocked movement is now slow terrain, including old
  saved runs and rotated/reflected reviewed layouts. Bridges, walls, pillars,
  wells, doors and unrelated movement annotations keep their collision rules.
- Movement is charged on departure: dry to water costs one point; water to
  water or dry costs two. Insufficient points prevent the step, with no movement
  or charge. Keyboard movement, click-path planning, multiplayer authority and
  monster movement use this rule. A character cannot spend its final two-point
  step ending on another character.
- Outside combat, departure from water animates over 320 ms. Repeated keypresses
  cannot outrun the animation. Local followers and remote peers animate too.
  Lights track the interpolated token. Dry-floor responsiveness is unchanged.
- The movement circle retains its normal radius over dry floor and half radius
  over slow water. Weapon and spell range rings are not reduced by water.

## Faith spells and Focus

- General spell rule: Self range always means caster only.
- Shield of Faith grants the caster +2 AC for five rounds. Critical: +4 AC or
  ten rounds. Recasting replaces rather than stacks the bonus, and derived AC
  includes it exactly once.
- Holy Weapon casts before selecting a living character's equipped weapon at
  Close range (self or a reachable adjacent token, including diagonals). The
  weapon is magical and gains +1 attack/damage for five rounds. Critical: ten
  rounds, +2 attack/damage, or one target within a circular two-square range.
  The blessing stays on that weapon if stowed or dropped and expires normally;
  it does not bless replacement weapons. The target need not belong to caster.
- Protection from Evil is a house-rule aura centered on the caster, with a thin
  light-blue persistent ring. Within Close range and line of sight, chaotic
  beings have disadvantage on attack/spellcasting checks; caster is exempt.
  A chaotic priest displays Protection from Good instead, opposing lawful and
  neutral beings. Critical success doubles the radius to two squares.
- Focus gets a free spellcasting check at each subsequent caster turn, without
  using its action. Damage immediately checks focus via the shared HP setter.
  Normal failure ends the effect but does not lose the spell. Natural 1 applies
  priest penance or wizard mishaps. A first natural 20 on a later focus check
  upgrades the aura; the upgrade is retained until the spell ends. Another Focus
  spell replaces the old focus. Sleeping ends focus.
- Confirmed: round effects use the existing ten-second round clock outside combat. Full
  dungeon saves preserve effects; personal imports discard active encounter
  blessings/focus and prepared actions. Failure/recovery restrictions persist.
- Confirmed: wizard refraction/ally-redirection centers this non-damaging aura on the
  redirected target while the wizard maintains focus; it never deals the
  default Magic Missile damage.
- Charm, beguile, possess, compel/compulsion, domination, hypnosis, mind control,
  enslavement, enthrallment, suggestion and command effects can use
  `blocksMindControl(state, target, description)`. Recognized monster attacks
  already use it. Full possession/charm systems are not implemented yet.
- Future traps/spells explicitly causing distraction must invoke a focus check.
  Ask the designer when an effect's distraction behavior is ambiguous; do not
  treat ordinary attacks, movement, stealth, or non-Focus casting as distractions.

## Turn Undead

- Requires a holy symbol. Every explicitly undead-tagged creature within Near
  (six squares), with line of sight, rolls CHA against the actual casting total.
  A failed check causes five rounds of fleeing, without Focus. Failure by ten
  or more destroys creatures at or below caster level. Ash replaces corpse
  pieces, retains its name on pickup, and is worth 1 copper (0.01 Gold).
- Critical options are ten rounds of fleeing, double range (twelve squares), or
  destruction on failure by five or more (same caster-level restriction).
- Turned creatures spend movement moving away or perpendicular, preferring a
  reachable hallway without approaching the caster. Walls, doors, other tokens
  and water costs still apply; traps are not avoided or triggered by monsters.
  A cornered creature only uses a legal ranged attack, at disadvantage; it does
  not switch to melee. New turning replaces the prior turning duration.

## Wizard Mishaps

Natural 1 loses the implemented wizard spell until rest and rolls the entire tier 1-2 table:

1. Devastation: apply two independent 2-12 results, including repeated results.
2. Explosion: 1d8 damage to the caster.
3. Refraction: the missile hits the caster for 1d4.
4. Slipped hand: 1d4 to a random living ally; no ally means no target.
5. Mind wound: one in-game week of spell loss, plus successful rest. Those two
   requirements may be satisfied in either order.
6. Discorporation: one actual gear unit disappears. If equipped or lit, its
   hand, AC and light effects are removed too; other units in a stack remain.
7. Spell worm: each caster turn loses a random known spell, then rolls DC 12
   CON to end the worm. Those spell losses still require successful rest.
8. Harmonic failure: lose a random known spell until successful rest.
9. Poof: suppress all light in a six-square radius following the caster for
   ten rounds. This does not extinguish sources or stop their normal timer.
   Outside lights cannot reveal tiles inside this area; explored tiles dim.
10. Horror: scream in Primordial for three rounds, making one wandering check
    per screaming round even in darkness or the starting room.
11. Energy surge: purple token outline for ten rounds; enemy attacks against
    that character have advantage. It does not create an extra light source.
12. Unstable conduit: disadvantage on tier 1 casting for ten rounds. Advantage
    and disadvantage cancel, including Magic Missile's inherent advantage.

Combat rounds advance short effects once per complete initiative round. Outside
combat, one round is ten real seconds, matching the existing dying timer. The
week restriction advances with active exploration, combat rounds, ten-minute
searches and each completed resting hour; offline time does not count. Resting
does not give spell-worm turns. Effects, locks, and mishap history are saved.
Magic Missile redirects for 1d4 on results 3 and 4. Burning Hands redirects its
normal fire area to the caster or random ally and includes the original caster
in the mishap area. Future wizard spells need their own redirected effects;
this release invokes the table for Magic Missile and Burning Hands.

Rules live in `spell-effects.js`, `magic-missile.js`, `burning-hands.js`, `fire-damage.js`,
`targeting.js`, `wizard-mishaps.js` and `rest.js`, with browser/server coordination
in `main.js`. Pending critical choices and character rest progress survive
normalization and saves. Room command receipts prevent duplicate application.

## October 13 UI and equipment follow-up

Rest is disabled when party supplies are insufficient. The tooltip states the
three-torch and one-ration-per-living-member requirement. The confirmation uses
Yes/No before supplies are spent. Rations may be pooled across party members;
interrupted rests retain previously paid supplies and progress. Normal wandering
encounter probability is halved in the entrance/stairs room; safe starting-room
rest still makes no encounter checks.

Armor is explicitly equipped, one proficient suit at a time, and cannot be
changed during combat. Existing armor migrates once without changing its former
best-suit benefit. Hand-held items never unequip worn armor. Shield and weapon
controls are omitted for nonproficient characters.

Attacks are rebuilt in gear order, with identical names sharing one attack and
the equipped copy providing its values. Differently named variants remain
separate. The popup has seven attack lines, including the first spellcasting
line for priests/wizards. Mini-sheets show equipped attacks only. Thief weapon
tooltips include backstab dice. Reordering uses an owned-character command and
does not change gear quantities or statistics.

Popup fields retain fixed geometry and clipped text exposes a full-value tooltip.
The Talents stripe holds the close control and character-options menu. Nearby
followers no longer require each path tile to be lit, and full local breadth-first
paths can escape corners; following stops at twelve squares from the selected
character. Revealed traps, creatures, walls, and combat still block following.

## October 14 magic spells and items

Talent labels omit their class/level prefixes; those prefixes remain as hover
provenance. Deity and alignment fields use the designer's supplied lore text.

Charm Person has Near range, affects one humanoid of level 2 or less, and uses
friendly-companion ownership. It lasts 1d8 days, not the ordinary companion's
damage threshold. Party-inflicted damage breaks the charm; enemy damage
does not. Critical choices are 2d8 days, two distinct humanoids, or level 4 or
less. A full party leaves the charmed creature friendly on the map rather than
exceeding 16 members. Expiry returns the creature to a suspicious attitude;
party harm makes it hostile. Time advances during play, combat and rest, not
while a saved run is closed.

Detect Magic uses Focus, Near range and line of sight. It reveals magical traps,
magic-carrying stealthed creatures, Mimics and Doppelgangers. A detected invisible
target can be attacked by the observing wizard without invisibility disadvantage.
Two focused rounds reveal general properties, not the item's exact identity.
Critical choices double range or immediately reveal general properties.
Identification is a separate one-action attempt with two DC 11 casting checks;
either failure loses Detect Magic until recovery, with normal natural-1 mishaps.

Feather Fall is a free, self-only reaction prompted by tagged falling events;
natural 20 has no extra benefit. Existing traps still resolve damage manually.
Future features can queue an authoritative damage amount. A usable Feather Fall
scroll can provide the reaction when the known spell is unavailable.

Magic treasure replaces approximately 20 percent of treasure items after normal
value balancing. Its fixed prices are deducted from the existing budget; mundane
treasure absorbs the remaining value. +1 equipment dominates low levels, while
+3 is rare there. Healing I is selected on approximately 15 percent of magic
draws and starts identified. Other healing tiers become progressively rarer.
Weapons/ammunition add 200/500/900 Gold and armor adds 150/300/900 Gold for
+1/+2/+3. Ammunition prices cover 20 projectiles, and the first matching gear
stack is used. Weapon and ammunition bonuses stack and one projectile is spent
on each attack. Unidentified bonuses work but are omitted from roll explanations.
Identification reveals the true name and bonus without removing the Magic tag.

Potion drinking is free on the owner's combat turn. It replaces the potion with
an empty flask. Healing, ten-round Giant Strength, ten-round Invisibility and
permanent Vitality effects are implemented. A repeated Vitality potion requires
DC 18 CON or causes instant death. Duration and consumption count survive saves.

Scrolls cover the spell catalog with prices 80/140/200/260/360 Gold by tier plus
any explicit `costGp`. Their casting uses the appropriate class's spell list,
not its known-spell list, and DC 10 + tier. Attempts consume the scroll into
Blank paper worth 1 Gold. Failure does not directly lose the corresponding known
spell; natural-1 Wizard Mishaps still apply. Spell effects not yet implemented
remain manual, as they do when casting those spells normally.

An identified wizard scroll can be queued for learning on the next completed
eight-hour rest. The DC 15 INT check consumes the scroll on success or failure;
successful spells are also recorded in `learnedScrollSpells` for exclusion from
future ordinary known-spell limits. Interrupted rest postpones the check until
the same rest completes. Learning is checked even if that character's rest
recovery benefit was forfeited, provided the character is still alive.

Unidentified magic items sell for 100 Gold; identified ones sell for their fixed
treasure value. Partial ammunition bundles prorate that value. Sales and all item
actions are owned-character server commands with idempotent receipts.

## Hold Portal, Sleep, and conditions

Hold Portal uses the original successful casting total as the door's STR DC.
It closes and holds one known door within six squares for ten rounds. A natural
20 offers twenty rounds, two doors, or twelve-square range. Forcing it takes an
action, and success opens the door and removes the effect. Expiry removes only
the magic; it does not open the door. Knock is a future tier-two integration.
Ordinary opening and closing is free on the adjacent actor's turn, including
after that actor has spent their action. A deliberately selected melee weapon
can smash a door; a dagger rolls that STR check at disadvantage.

Sleep immediately affects living level-two-or-lower creatures in a seven-by-seven
square centered on its caster. The caster is immune, allies are not, and walls
and closed doors block it. Critical choices are level four or a thirteen-by-thirteen
square. Sleeping creatures cannot act, move, or see, and are prone. Injury wakes
them; an adjacent awake creature can also spend an action to wake one. Waking
leaves prone. Standing costs half the full movement budget, rounded up, without
spending an action. Prone grants melee advantage and ranged disadvantage beyond
close range. A sleeping target also qualifies for a thief's backstab.

Rest sleepers use the same sleeping condition, with the existing watch schedule.
Interrupted sleepers wake prone. Revive is a free, once-per-turn d20 attempt:
natural twenty restores one HP, clears dying, and leaves prone. Other results
advance the existing death timer. Outside combat, the ten-second round clock
provides the same opportunity automatically if the button was not already used.

Ghost, Wraith, and Void Spider can become incorporeal with an action and spend
another action becoming corporeal. While incorporeal they cross solid dungeon
tiles, may stop inside them, see through walls, and render at half opacity. They
must reach a legal floor position and become corporeal before attacking or
physically interacting. Monster pursuit uses bounded shortest-path search and
can open ordinary doors for free. Ranged monsters do not stop behind a closed
door merely because the target is within range. A pursuer within twelve squares
with a route keeps combat active despite losing sight. All monsters see in
darkness; hostile monsters can approach before party illumination reveals them.

## Controls, lights, and roll history

Mini-sheet body clicks select; the heading stripe changes color; the sheet icon
or I key opens the full sheet. The active turn's mini-sheet moves over the map
with End Turn beneath it. Monster turn cards and half-second attack rings are
shown even for unseen monsters, by explicit design choice. Ordinary character
turn rings use the equipped attack. Escape cancels weapon or Steal targeting.
Multiplayer commands retain a bounded sequence of monster-turn presentation
events so peers can show the half-second card/ring even when the server resolved
that turn between polls. Joining seeds that sequence without replaying old turns.

Deliberate weapon targeting supports attacks at empty squares and confirmed
attacks on another party member. Server ownership always applies to the actor,
not the victim. Steal requires a hidden thief, one advantage DEX roll against
DC 15, then reuses that result against 10 plus monster WIS. One eligible gear
item is taken, or dropped in an adjacent square when inventory is full. Equipped
armor cannot be stolen. The original roll and selected target survive multiplayer
commands; no second roll is allowed when choosing an item.
Failing the initial DC 15 check ends ordinary stealth, but never invisibility.

Reset Torch Timer Yes removes burning torches, including dropped torches,
extinguishes every lantern including stowed ones, and resets the shared hour.
Unused torches and magical Light remain. No preserves old lights and elapsed
time. Reset visuals show one second without illumination followed by two seconds
of growth from token size. Unequipping a torch drops it with a fifty-percent
extinguish chance; no remaining burning source pauses the shared timer. Relighting
with No resumes that timer. Changing lights with No drops an old held torch
without extinguishing it, honoring the explicit preserve-lights choice.

Attacks store structured, safe text segments for colored actor names, selected
advantage/disadvantage dice, and damage. Maximum die values are green and minima
red. Common check and damage logs also retain these values without an expand
control. No imported name or log content is inserted as HTML.

## Pits and sinkholes

Pit traps reveal the new pit artwork when sprung. A hidden pit defaults to one
square; explicit multi-square footprints and magical sinkholes affect every
creature in their footprint. DEX DC 15 avoids the fall and relocates the creature
to a distinct, safe adjacent rim square. Dexterity Grit grants advantage. With
no legal rim square, a successful saver stays on a safe ledge rather than being
teleported into a wall or onto another token. Failed saves cause 3d6 falling
damage and prone; eligible Feather Fall is offered before damage. Only actual
damage triggers a Focus check. Other trap damage remains manual.

Discovered pits block ordinary movement and pathfinding, not sight or torchlight.
Flying, incorporeal creatures and Floating Discs can cross them. A fallen creature
uses an action and STR DC 15 to climb to a free adjacent rim square; Strength Grit
grants advantage. Monsters use the same damage and climb rules. Sleeping or
paralyzed monsters cannot climb until able to act.

An adjacent, conscious party member carrying rope is prompted to help a conscious,
non-dying fallen ally. Rescue is automatic, uses the helper's combat action,
preserves the rope, and places the rescued ally on a free safe rim square. The
helper may rescue another player's character, but only the helper's owner can
authorize the command. The target cannot be substituted for an arbitrary token.

A fighter adjacent to a monster that is adjacent to an open pit gets Push.
It spends an action and checks STR against the monster's AC, with Strength Grit
advantage. Any character can automatically push a sleeping or paralyzed monster,
still spending an action. Flying and incorporeal monsters are immune. A successful
push causes the fall directly, without a second DEX save. Pit cells use corner
and edge art around black interiors; black pit cells are not ordinary wall tiles.

The loopback-only `?test-party=three&pit-test=one` fixture demonstrates rescue,
pushing, a two-by-two pit and a hidden one-square trap without altering source
character exports. Underpass artwork remains in review; separate-route gameplay
is not enabled by this pit integration.

## Campsite and Alarm presentation

Paid rest gathers living party members around `campfire.png` in the explored,
walkable part of their shared room. Every trap tile and living monster tile is
excluded. Characters receive the nearest distinct squares first; Floating Discs
receive the remaining outer squares. A room without enough safe explored space
cannot start a new camp. The campsite is saved with the unfinished rest.

Rest leaves the map unblurred, uses maximum zoom, and keeps its popup clear of
the camera focus. After successful Alarm, its caster visually walks a shared,
trap-avoiding route through discovered room-side exits, nearest unvisited exit
first, and returns to their camp square. Hidden secret doors and unexplored exits
are excluded. Markers use N/E/S/W rotations of 0/90/180/270 degrees. The rest clock
starts after this tour; resuming the paid rest does not replay the tour.

## Character advancement

XP earned from treasure sales makes a gold Level Up button available in the
character's NAME box and mini-sheet. Pressing it outside combat/rest claims one
level, subtracts the old level times ten XP, and retains overflow. Progression
stops at level ten while preserving additional XP. Pending choices survive saves
and cannot reroll HP or talents. Multiplayer checks character ownership.

Each level rolls the class HP die plus CON modifier (minimum one); dwarves take
the higher of two dice. Titles update in two-level bands. Levels 3/5/7/9 roll the
class's 2d6 talent table, including player choices. Weapon mastery, Backstab,
attack/armor bonuses, initiative advantage, casting bonuses, and carrying
capacity use the resulting level and selected talents.

At level two, wizards learn one tier-one spell; priests learn two, reaching four
ordinary tier-one spells without counting Turn Undead. Thereafter each learns
one spell of tier 2 at levels 3/4, tier 3 at 5/6, tier 4 at 7/8, and tier 5 at
9/10. Choices list only eligible, unknown spells of that tier. Clicking a name
opens a read-only description; Pick learns it. Scroll-learned spells remain
separately tracked and are never offered as duplicates.
