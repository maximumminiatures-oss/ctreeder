# Ancestry Regression Review

Review date: October 21, 2026. Repository: `maximumminiatures-oss/ctreeder`.
Scope: historical ancestry attack calculations, import-choice resets, and
Talents/Spells presentation. This review changes documentation only.

## Summary

This was not one recent deletion of ancestry rules. The verified history shows
an older incomplete attack-synthesis path and two recent changes that could
remove or hide ancestry information:

- June 12: gear-generated attacks did not compose ancestry modifiers. Imported
  attack strings could still preserve those modifiers, making the defect
  dependent on which calculation path was used.
- October 19: class-choice import resets filtered bonus records by their text
  without checking their source. An ancestry record matching a class-selection
  pattern could be removed and the result persisted.
- October 19-20: presentation separated source labels from visible talent text,
  but deduplication still used visible text alone. October 20 also suppressed
  every `Learn:` row without distinguishing ancestry from class bookkeeping.

Missing ancestry mechanics on a sheet, missing bonus records in saved character
data, and incorrect attack arithmetic are different failures. A fix to one does
not establish that the other two are fixed. The ancestry identity field itself
was not removed by these changes.

There is no evidence here that the user authorized removing ancestry benefits,
or that rewriting lore required doing so. Git establishes code changes and
recorded attribution, not a person's or agent's intent or reasoning.

## Recorded Timeline

All timestamps below include the recorded UTC offset. In each row the author
and committer names, email addresses, and timestamps match; there is no
author/committer date discrepancy. These are commit metadata, not verified
production deployment times or the exact time a defect first affected a player.

| Commit | Author date | Committer date | Recorded author and committer | Subject |
| --- | --- | --- | --- | --- |
| `7570ff79b85cd78c1b22a5863a30fcc85f7877d1` | 2026-06-12T14:16:58-07:00 | 2026-06-12T14:16:58-07:00 | maximumminiatures-oss, ctr37@uw.edu | Add ShadowSpawner frontend equipment and light updates |
| `978b7973e37ca6767238543717abbe472d2ea03a` | 2026-06-17T23:38:49-07:00 | 2026-06-17T23:38:49-07:00 | maximumminiatures-oss, ctr37@uw.edu | Improve character sheets, saved characters, gear, and lighting |
| `dcc48e077533be70241c4a211c659b2d277f5a92` | 2026-10-19T13:09:24-07:00 | 2026-10-19T13:09:24-07:00 | maximumminiatures-oss, maximumminiatures@gmail.com | Release spells, rest, character progression, and connected pit routes |
| `c45e512bd0318c622848ecbb23a8c3027ab598d4` | 2026-10-20T17:32:52-07:00 | 2026-10-20T17:32:52-07:00 | maximumminiatures-oss, maximumminiatures@gmail.com | Release party systems, Tier 2 spells, and reviewed sheet UX |

## Evidence and Impact

### 1. Older gear-derived attack omission

In [7570ff79, main.js](https://github.com/maximumminiatures-oss/ctreeder/blob/7570ff79b85cd78c1b22a5863a30fcc85f7877d1/S3_content/src/main.js#L1254),
`getWeaponDamageExpression` selects item/profile damage and
`buildWeaponAttackText` selects an explicit item attack bonus or an ability
modifier. Neither composes an ancestry attack/damage benefit.

```js
const bonus = Number.isFinite(Number(item?.attackBonus))
  ? Number(item.attackBonus)
  : abilityScoreModifier(character?.stats?.[profile.ability || "STR"]);
```

`rebuildCharacterAttacks` at line 1303 combines imported `baseAttacks` with
gear-generated attacks. It can keep a non-versatile imported attack string,
while rebuilding versatile attacks and generating attacks for gear not already
represented. Consequently, a correct imported attack could mask the incomplete
local calculation. The omission is proven in this synthesis path, not a claim
that every ancestry bonus stopped working everywhere on June 12.

This is older than the October presentation work. Displaying an ancestry talent
does not itself feed that talent into synthesized attack math.

### 2. Recent import reset crossed source boundaries

In [dcc48e07, class-progression.js](https://github.com/maximumminiatures-oss/ctreeder/blob/dcc48e077533be70241c4a211c659b2d277f5a92/S3_content/src/class-progression.js#L52),
`initializeImportChoices` removes fighter mastery/Grit selections by matching
`WeaponMastery`, `Grit`, or `AdvantageOnStatChecks`. Caster choices are detected
and removed using `Spell:`, tier/spell markers, and spell-advantage/extra-spell
text. Those filters do not require a class source.

For example, this ancestry record matches the caster filter:

```js
{
  sourceType: "Ancestry", sourceName: "Elf",
  name: "Advantage", bonusName: "AdvOnCastOneSpell",
  bonusTo: "casting Magic Missile spell"
}
```

A historical-code reproduction removed that record, reset the wizard's known
spells, and created class spell-choice tasks including a spell-advantage task.
The function's `save(character)` also copies the resulting bonuses to `raw`.
This is a data mutation, not merely a missing tooltip.

The legitimate requirement was to replace imported class choices with player
choices. The implementation's matching boundary was broader: it could also
match Ancestry or Ambition records with similar effect text. Effect similarity
is not proof of common ownership or permission to replace a record.

### 3. Source extraction made existing deduplication unsafe

[978b797, main.js](https://github.com/maximumminiatures-oss/ctreeder/blob/978b7973e37ca6767238543717abbe472d2ea03a/S3_content/src/main.js#L3492)
introduced the normalized `displayLine` deduplication key on June 17. At that
point the display line generally retained its source prefix, such as `Elf:` or
`Wizard 1:`.

[dcc48e07, main.js](https://github.com/maximumminiatures-oss/ctreeder/blob/dcc48e077533be70241c4a211c659b2d277f5a92/S3_content/src/main.js#L6828)
changed that flow to extract `presentation.text` before computing the key.
`talentPresentation` separates the prefix into `presentation.source`, used as a
hover title. The identity comparison nevertheless remained:

```js
const displayKey = displayLine.toLowerCase().replace(/\s+/g, " ").trim();
```

Two distinct sources with identical visible effects could now collide. The
second row would be skipped even though its source differed. This can erase
provenance and imply a missing benefit without actually deleting its data.

[c45e512, main.js](https://github.com/maximumminiatures-oss/ctreeder/blob/c45e512bd0318c622848ecbb23a8c3027ab598d4/S3_content/src/main.js#L7102)
retained that text-only key. It did not introduce deduplication from scratch;
the distinction matters when assigning dates and corrective scope.

### 4. Recent learning-row suppression ignored source

The same October 20 rendering block added:

```js
const presentation = talentPresentation(formatTalentSpellTextForSheet(line));
let displayLine = presentation.text;
if (/^Learn(?: Extra Spell)?:/i.test(displayLine)) continue;
```

The condition does not inspect `presentation.source`. A record producing
`Human: Learn: Magic Missile` becomes `{ text: "Learn: Magic Missile",
source: "Human" }` and is skipped, just like redundant class learning text.

The global spell summary can still show Magic Missile in this example. Thus
this finding proves suppression of the source-specific talent row, not that
this rendering operation removed the known spell or its casting capability.

### 5. A separate representation gap made missing rows easier

The historical `buildTalentSpellLines` derives talent entries from imported
`levels` and `bonuses`; it does not guarantee a canonical ancestry-mechanics row
from the ancestry identity alone. A character can therefore still say `Goblin`
in its identity fields while having no ancestry talent row if its export lacks
the corresponding bonus records. This is a latent data/presentation contract
gap, not evidence that a recent lore edit deleted the ancestry name.

## Why Tests Did Not Protect the Contract

The inspected coverage tested individual features, but not their composition:

- At `7570ff79`, the tracked `tests` tree contained Python/backend/e2e tests and
  no JavaScript unit-test directory. A search for ancestry, half-orc,
  `RangedWeapons`, and `AdvOnCastOneSpell` in that tree found no matches. This
  supports a specific missing regression check; it is not proof there was no
  manual testing.
- At `dcc48e07`, `tests/js/import-talents.test.mjs` checks that imported class
  spells/mastery/Grit are discarded and replaced. Its reset fixtures omit
  source-tagged ancestry/Ambition records that match those same patterns.
  `class-progression.test.mjs` does cover a dwarf HP case, so ancestry was not
  wholly absent from testing; that case does not exercise these filters.
- At `c45e512`, `tests/js/popup-spell-summary.test.mjs` covers level-two spell
  visibility/clickability, tier/name sorting, fixed row dimensions, and
  tooltips. Its caster fixture has empty `bonuses`, and its synthetic talent
  rows do not test ancestry/class text collisions or ancestry learning rows.

The engineering failure was an unenforced cross-feature contract: ancestry
needed to survive import, local arithmetic, source-to-text transformation, and
fixed-size rendering. Tests for each new feature did not assert that preserved
behavior across those boundaries. Describing this only as an LLM forgetting
would not explain the concrete failure modes or prevent recurrence.

Historical full test suites were not rerun for this documentation review. These
coverage findings come from reading the committed tests and relevant code;
they are not a claim that every historical suite passed or failed.

## Prevention Contract

Suggested acceptance rules for future changes:

1. Preserve stable ancestry identity, semantic ability IDs, source metadata,
   and tracked resources through import, normalize, save/load, level-up, party
   transfer, and rendering. Presentation strings are not ability identifiers.
2. Restrict class-choice resets to explicitly class-owned records. Preserve
   Ancestry/Ambition records even when their effect text resembles class text.
3. Compose attack/casting modifiers from all applicable sources in one tested
   calculation path. Verify both precomputed imported attacks and newly
   synthesized gear attacks. Do not double-add starting HP/stat bonuses already
   included in imported totals.
4. Give ancestry its own first Talents entry with mechanics intact. Keep lore
   separate. Deduplicate only truly duplicate records using semantic identity
   plus source, not a normalized visible sentence.
5. Keep fixed sheet dimensions without silently deleting abilities. Spell
   summary reservation, truncation, and hover details must retain access to
   the complete mechanical information.
6. Make copy-only changes behavior-neutral: no bonus filtering, resource reset,
   recalculation, or save-schema mutation as an incidental consequence.

## Focused Regression Checklist

- Exercise all six core ancestries with at least one mechanical assertion and
  a sheet assertion; a tooltip snapshot alone is insufficient.
- Include an elf's ranged/casting benefit and a half-orc's attack/damage benefit
  in locally generated attacks, not only imported attack text.
- Include a source-tagged ancestry spell/advantage record during caster reset,
  and an Ambition record matching a class filter.
- Give ancestry and a class talent identical visible text and require both
  sources to remain represented; keep an ancestry `Learn:` row while hiding
  only genuinely redundant class bookkeeping.
- Render an import with an ancestry name but no optional ancestry bonus rows.
- Save/load and level the same character, then check identity, effects, rows,
  and spent/recovered ancestry resources remain consistent.
- Cover a full Talents field so overflow handling cannot conceal the regression.
- Run focused ancestry/import/progression/popup tests and the broader runtime
  suite before release. Review the diff for negative assertions: what must
  remain unchanged, not merely what new UI appeared.

Small, feature-scoped commits and recorded release/deployment revisions make
regressions easier to isolate. They complement these contracts; they do not
replace behavioral tests. A future feature-contract table can record each
ability's source, calculation hook, display row, persistence fields, and tests.

## Practical User Guidance

The user should not need to repeat every existing rule whenever requesting a
copy edit. Preserving existing mechanics is the implementer's responsibility.
For unusually sensitive changes, a compact request can make review easier:

> This is a presentation-only change. Preserve all ancestry mechanics, imported
> bonuses, save data, and ability-use/recovery state. Keep ancestry first in
> Talents. Show the exact changed paths and regression tests, including one
> affected character before and after import and save/load. Ask before changing
> mechanics; do not infer such changes from lore or shorter text.

For feature changes, add the intended exception explicitly, then require tests
for both the changed behavior and the preserved behavior. Request a short
evidence-based explanation when a regression is reported: first bad commit,
actual calculation/data/display path, missing test, and corrective test.

## Verification and Limits

The metadata and diffs can be reproduced without changing the worktree:

```powershell
git show --no-patch --format=fuller 7570ff79 978b797 dcc48e07 c45e512
git show 7570ff79 -- S3_content/src/main.js
git show 978b797 -- S3_content/src/main.js
git show dcc48e07 -- S3_content/src/class-progression.js S3_content/src/main.js S3_content/src/sheet-lore.js
git show c45e512 -- S3_content/src/main.js tests/js/popup-spell-summary.test.mjs
git show dcc48e07:tests/js/import-talents.test.mjs
git show dcc48e07:tests/js/class-progression.test.mjs
```

These commits establish the identified historical code paths, not the first
production occurrence of every symptom or a complete ancestry audit across all
history. October 21 repairs and tests in the shared working tree are separate
from the immutable release evidence above. This review does not certify those
ongoing repairs, change approved sheet-field lore, or edit `AGENTS.md`.
