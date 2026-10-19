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

## Verification

Run checks appropriate to the change: `pytest -q --ignore=tests/e2e` for backend
tests and `npm test` for runtime tests. Database fixtures recreate tables, so
tests must use an isolated database and never production. Preview at `/site/`.
Before deployment, verify a protected backup and retain a rollback image.
Afterward, check the changed functionality and service health.

## Local test party

Use `http://127.0.0.1:5057/site/?test-party=three` for local gameplay testing
with Shrigark (Goblin Thief), Badzog (Half-Orc Wizard), and Ad (Halfling Fighter).
Their original user-provided exports are stored outside this repository at
`C:\SD_game\.dev\fixtures\shadowspawner\three-characters.json`.
The preview script alone serves this fixture; production has no fixture route.
The opt-in URL loads a fresh party after generation, never into a shared room
or over an existing party. Do not alter the originals to grant test equipment
or spells; make temporary derived copies for specialized tests.

For the current magic-spell work, append `&magic-test=one` to the local test-party
URL. This loopback-only opt-in gives Badzog Detect Magic, Feather Fall and sample
magic gear from a fresh derived copy; the original exports remain unchanged.

For utility-spell testing, append `&utility-test=one` instead. This grants Badzog
Alarm, Floating Disc, Mage Armor, Hold Portal and Sleep, three party rations, a lantern and oil in a
derived copy.

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
