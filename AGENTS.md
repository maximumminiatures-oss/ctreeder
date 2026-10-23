# ctreeder.com working instructions

This is `maximumminiatures-oss/ctreeder`, the personal repository for the live
site. Read `docs/DIGITALOCEAN_DEPLOYMENT.md` before production work.

- Local checkout: `C:\SD_game\ShadowSpawner\.source`.
- The server retains `/opt/SD-Dungeon-Generator` for path compatibility, but its
  origin is `https://github.com/maximumminiatures-oss/ctreeder.git`.
- Current portfolio source: `portfolio/`. The older `S3_content/portfolio/`
  must not replace it. Game frontend and tables: `S3_content/`, at `/site/`.
- Keep database contents, saved games, environment secrets, TLS keys, and
  backups outside Git. Never print or upload production `.env` or dumps.
- Preserve Compose project `sd-dungeon-generator` and existing named volumes.
  Changing the project name can attach empty volumes. Never use `down -v` on
  production.
- Native nginx owns ports 80/443. Do not start the Compose nginx service on the
  host or replace the native configuration with the local Docker template.
- Push ctreeder.com work to this personal repository. Group-repository links
  in historical documents are provenance, not deployment targets. Do not use
  legacy AWS deployment scripts for ctreeder.com.
- Preserve unrelated working-tree changes. A Git push alone does not deploy.

## UI conventions

Do not use the `JBlack` display font for new interface text unless requested.
Default to `"Times New Roman", Georgia, serif`, matching the GEAR heading.

Read `docs/STYLE_AND_CONSISTENCY.md` before editing player-facing copy or sheet
presentation. Field values use title case (`Warhammer`, one word); messages use
sentence case and lowercase common nouns while preserving proper names and spell
names. Ancestry must appear first in Talents with its mechanics intact. Approved
tooltip prose is narrative, never permission to delete or replace ancestry rules.
Use the supplied rulebook PDF and project decisions before Chicago-style fallback.

Ancestry integration lives in `S3_content/src/ancestry.js`. Keep it connected to
attack synthesis, spellcasting, progression, and ancestry-first sheet rows.
Never deduplicate ancestry against a class talent just because their text/effect
matches. Import-choice resets may replace class selections, not Ancestry/Ambition
bonuses. Imported HP/stat totals already include their starting bonuses; do not
add them again while rendering or normalizing. Run `ancestry.test.mjs` and
`ancestry-runtime.test.mjs` when changing these paths or character-sheet copy.

Background history is assigned once by `backgrounds.js` and saved in
`backgroundDetails`; never reroll it while rendering, normalizing, or loading.
Noble culture/title weights and exact capitalization are user-authored data in
`data/noble-titles.json`. Keep these decorations separate from the class `title`
field and preserve all ancestry/combat mechanics. Legacy Minstrel maps to
Entertainer. Title field hover descriptions are deliberately disabled.
These October 21 background decisions supersede the older Title/Orphan/Minstrel
entries in `Hover Text Review.txt`; do not restore obsolete copy from that file.

For character changes, read `docs/ANCESTRY_REGRESSION_REVIEW.md` and identify the
existing contracts that must stay unchanged. Test import -> normalize -> equip
-> save/load -> render, not just a new button or isolated function. Copy-only
tasks must not change mechanical data. Ask before making an unrequested rule
change; do not solve limited field space by suppressing a talent or bonus.

## Verification

The Buy popup uses one shared catalog in `S3_content/src/shop-catalog.js` for
both UI tabs and authoritative `buy_gear` commands. Keep its legacy supply IDs
stable and do not add a second item list. Core prices, quantities and slots
come from printed rulebook pages 35-37. Coins and gems are deliberately omitted;
both mithral armor variants are included at four times cost and one fewer slot.
Purchases stay in the current tab, use personal coins before Party Assets, and
must not spend XP. Run `shop-catalog.test.mjs` and `shop-runtime.test.mjs`.

Run checks appropriate to the change: `pytest -q --ignore=tests/e2e` for backend
tests and `npm test` for runtime tests. Database fixtures recreate tables, so
tests must use an isolated database and never production. Preview at `/site/`.
Before deployment, verify a protected backup and retain a rollback image.
Afterward, check the changed functionality and service health.

## Local test party

Monster companion labels normalize through `monster-terms.js` (C/L/N expand to
full alignment names; Leather becomes Leather Armor). Preserve stats and item
metadata. `ensureMonsterGear` in `companions.js` is the shared current inventory
for recruitment, stealing, and death loot. An explicit empty inventory must stay
empty; never regenerate stolen gear from the stat block. Native monster attack
totals must not become intrinsic weapon bonuses when loot transfers to a hero.
Run `monster-gear.test.mjs` and `local-test-party.test.mjs` for these boundaries.

Use `http://127.0.0.1:5057/site/?test-party=three` for local gameplay testing
with Shrigark (Goblin Thief), Badzog (Half-Orc Wizard), and Ad (Halfling Fighter).
Their original user-provided exports are stored outside this repository at
`C:\SD_game\.dev\fixtures\shadowspawner\three-characters.json`.
The preview script alone serves this fixture; production has no fixture route.
The opt-in URL loads a fresh party after generation, never into a shared room
or over an existing party. Do not alter the originals to grant test equipment
or spells; make temporary derived copies for specialized tests.

Append `&background-test=one` to preview an orphan raised by an oni, a noble with
a deliberately long decorated name, and an Entertainer. This only changes the
loopback derived fixture, never the original character JSON.

For the current magic-spell work, append `&magic-test=one` to the local test-party
URL. This loopback-only opt-in gives Badzog Detect Magic, Feather Fall and sample
magic gear from a fresh derived copy; the original exports remain unchanged.

For utility-spell testing, append `&utility-test=one` instead. This grants Badzog
Alarm, Floating Disc, Mage Armor, Hold Portal and Sleep, three party rations, a lantern and oil in a
derived copy.

For Tier 2 Wizard testing, append `&tier-two-test=one` instead. Badzog receives
the implemented Tier 2 list at level 4; the derived party receives 60 HP and one
Luck Token each. This loopback-only fixture does not change the original exports.

For Tier 2 priest testing, append `&priest-test=two` instead. The derived Badzog
becomes a level-four priest with the six implemented Tier 2 spells, Light,
Cure Wounds, Holy Weapon, a mace, and a holy symbol. Original character HP and
the stored source exports remain unchanged.

Tier 2 priest mechanics belong in `priest-tier-two.js`: DC 12 WIS checks,
source-tracked blindness/deafness, initial-casting critical choices only, and
ordinary Focus failure ending the effect without losing the spell. A Focus
natural one still requires priest penance and successful rest. Cleansing Weapon
and Smite deal radiant damage, never fire; keep radiant bonus dice separate from
elemental resistance and fire-trigger hooks, including Luck replay.

Zone of Truth only targets a language-sharing monster outside combat. One
question is available after initial targeting and after each successful round
of Focus, not after damage/distraction checks. Closing questions preserves
Focus and must not block movement or other actions. Divination reads current
uncollected treasure and living monsters; Augury is a health-adjusted encounter
heuristic with stated limitations, not a simulated promise of safety.

`stealth-awareness.js` owns thief proximity checks: geometry-aware circular
six-square entry restriction, three-square outside-combat reveal, and deaf-only
nearby observers granting success. Deaf observers do not trigger either
restriction. Ordinary stealth changes must not delete invisibility. Run the
priest-tier-two, priest-tier-two-runtime, divination, stealth-awareness,
stealth-awareness-runtime, and blindness-support tests when changing these contracts.

Append `&initial-choices=one` to test the fresh-import spell/mastery/Grit pickers
with the same local fixture, without contacting ShadowDarklings. This flag also
uses a derived copy and never changes the original fixture or production imports.

For higher-mishap previews, append `&mishap-test=shred` or `&mishap-test=balance`
to the loopback-only three-character URL. Shred grows naturally on the ten-second
exploration clock; Balance opens the sacrifice picker on the derived wizard.

Append `&pit-test=one` to the loopback three-character URL for a small pit/rescue
test room. It gives the derived party 40 HP, rope, a trapped ally, an adjacent
monster and an undiscovered pit trap. The original fixture is unchanged.

Append `&underpass-test=one` for two independent crossing routes, connected by
stairs and an upper loop. Badzog starts below; Shrigark starts above. Lower
tokens use 50% opacity. Route IDs are saved and used by authoritative movement,
visibility, targeting and occupancy; do not flatten their coordinates.
