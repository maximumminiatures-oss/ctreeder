# ShadowSpawner Style and Consistency

This guide covers player-facing language and presentation. A copy edit must not
change game rules, imported data, saved identities, or the effects of an ability.

## Authority

1. Follow explicit user decisions, including approved wording and house rules.
2. Follow the project's canonical terms and the supplied Shadowdark rulebook PDF
   for meanings and mechanics. Established house rules override the PDF.
3. Use Chicago style as the fallback for unresolved prose, punctuation, and
   capitalization questions, not as a source of game mechanics.

If these disagree or a rule is unclear, ask. Do not infer a mechanical change from
shortened text, lore, a tooltip, or an editorial convention. Existing code helps
locate a rule but is not proof that a reported bug is the intended rule.

## Fields and Labels

- Attack buttons have no border, including on mouse hover. Retain a separate
  keyboard-focus indicator and existing disabled styling.

- Use title case for field labels, headings, command labels, and standalone field
  values: `Dungeon Level`, `Save Party`, `Elf`, `Wizard`, and `Warhammer`.
- `Warhammer` is the canonical spelling, one word. Do not display `War Hammer`.
  This spelling rule does not authorize changing inventory identifiers or stats.
- Keep standard abbreviations uppercase: `AC`, `HP`, `XP`, `STR`, and `DEX`.
- Preserve established branding: `ShadowSpawner`, `Shadowdark`, and
  `ShadowDarklings` where those names are used. Do not recase proper names with a
  generic title-case function.
- Keep punctuation out of short labels unless it conveys structure, such as
  `Talents:`, `Spells:`, or `Save / Load`.

## Messages

Use full sentences and sentence case. Common nouns are lowercase in prose:
`warhammer`, `goblin`, `wizard`, `torch`, and `gold`. A common noun at the beginning
of a sentence still takes an initial capital.

Preserve character names, unique names, and the canonical names of spells. Do not
lowercase an entire message or a substituted name. For example, use `Kragol` for a
named individual and `the giant wasp` for an ordinary creature description. Use
`Mage Armor` when referring to that spell, even in the middle of a sentence.

Preferred roll narrative:

> Dor attacks Kragol with a warhammer. 21 hits for 4 damage.

Other examples:

> Dor attacks the giant wasp with a warhammer. 8 misses.
>
> Dor casts Mage Armor.
>
> Import or load a character to pick up treasure.

Keep the action, target, and outcome clear. Use natural articles (`a warhammer`,
`an axe`) and correct singular/plural forms. Do not prepend `Status:` to status
messages. Do not turn common item names into proper nouns merely because their
GEAR field uses title case.

Detailed die rolls, modifiers, advantage sources, and damage dice belong in the
existing roll hover details when the concise narrative is used. Condensing the
visible message must not remove those details, alter the calculation, or conceal
information the game is meant to reveal. Preserve established token-name colors
and minimum/maximum die indicators.

## Ancestry Invariants

These are immutable presentation and behavior invariants, not optional copy:

- Ancestry is the first entry in the character sheet's Talents section, before
  class talents, with its applicable mechanical abilities displayed.
- Keep ancestry mechanics available even when narrative ancestry lore is shown
  in a tooltip. A lore tooltip is not a substitute for the rules entry.
- Never remove, suppress, or replace ancestry abilities because a tooltip was
  rewritten or shortened, or because lore does not mention those abilities.
- Importing, saving/loading, leveling up, normalizing, and rendering a character
  must preserve their ancestry and its mechanical benefits and resource state.
  For example, a goblin's never-surprised rule cannot disappear after a lore edit.
- Abilities whose use and recovery are tracked must retain those restrictions;
  changing prose must not recharge an ability or change its duration/action cost.
- Do not infer mechanics from stereotypes in narrative text. The approved game
  rules and explicit project decisions define each ancestry's effects.
- Intentional, rule-authorized temporary transformations or impersonations remain
  exceptions governed by their own mechanics. Copy changes cannot introduce such
  an exception or overwrite the character's original ancestry.

The exact tooltip text reviewed by the user is approved narrative copy. Preserve
it unless the user requests a revision; do not silently polish it, use it to
replace a mechanics row, or treat an omitted benefit as a revoked benefit. Keep
narrative lore and mechanical data separate in implementation and review.

The October 21 regression audit found three independent causes: gear-derived
attacks omitted ancestry modifiers, import-choice filters matched bonus text
without respecting its source, and sheet rendering depended on optional imported
records and suppressed all spell-learning rows. None was an authorized removal
of ancestry rules. Canonical ancestry rows and source-aware mechanical adapters
must remain covered by the ancestry, runtime, and popup-sheet tests.

## Backgrounds and Names

The October 21 background decisions override older review-copy entries:

- Display legacy `Minstrel` as `Entertainer`; retain the alias when loading old data.
- Orphan/Orphaned history is assigned once from eligible recorded monster types
  with Intelligence modifier greater than -1. Store that choice, use normal noun
  order and a grammatical `a`/`an`, and never reroll on hover or save/load.
- Noble names use the exact user-supplied spellings, accents, case, positions,
  joiners, and two-stage culture/title weights in `data/noble-titles.json`.
  Common suffixes remain lowercase even inside the Name field. This explicit
  rule overrides generic field title case. A noble decoration is not the class
  progression `title` and must not affect ancestry or combat mechanics.
- Preserve fixed sheet dimensions. Noble names may wrap and shrink within the
  existing Name field. Do not remove part of the title to fit it.
- The class Title field has no hover description, including generic fallback or
  truncation tooltips. Its value and progression mechanics remain intact.

## Spelling

Use standard American English for ordinary copy. Check dictionary-unknown game
words against the supplied Shadowdark PDF, with page evidence for exceptions.
Preserve explicitly user-authored proper names and custom terms, including the
noble table. A dictionary rejection alone is not proof of a misspelling.

Do not autocorrect identifiers, asset paths, protocol values, ability IDs, or
non-English source records as if they were English prose. Fixing visible copy
must not rename semantic keys. Record ambiguous terms rather than silently
inventing a replacement, and keep full licensed PDF extracts outside Git.

## Browser Icon

`S3_content/assets/browser-spawner.png` is the canonical ShadowSpawner browser
icon. It is a 72 x 72, 8-bit RGBA PNG. Reference this original file from the game,
Flask game/account templates, local Tile Workbench, and retained game pages.
Do not duplicate or modify the artwork to create per-page copies. Portfolio
projects with their own branding retain their own icons. No web-app manifest or
installable-app icon set is implied by the tab-icon addition.

Standards checked October 21, 2026:

- The existing 72 x 72 PNG is suitable. [Google Search Central's current
  guidelines](https://developers.google.com/search/docs/appearance/favicon-in-search)
  accept square PNGs at least 8 x 8 and recommend dimensions larger than
  48 x 48; they do not require multiples of 48. Search uses one favicon per
  hostname, not a separate one for `/site/`. This browser-tab change does not
  replace the portfolio homepage's Search identity.
- Optional 32 x 32 and 48 x 48 exports would be project choices for smaller
  browser surfaces, not mandatory sizes. Keep accurate `type` and `sizes`
  metadata; [MDN explains how browsers choose among icon
  candidates](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/rel#icon).
- An optional 180 x 180 `apple-touch-icon` serves Apple home-screen use,
  separately from the tab icon; see [MDN's icon
  examples](https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Webpage_metadata#adding_custom_icons_to_your_site).
- Optional future PWA work would need 192 x 192 and 512 x 512 manifest icons for
  Chromium's installation-promotion requirements, among other requirements;
  see [MDN's installability
  guide](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable#required_manifest_members).

Do not generate these optional exports without approval. Prefer a higher-resolution
original for larger exports; enlarging the 72 x 72 file cannot restore detail.

## Review Checklist

- Check a field value and its corresponding sentence: `Warhammer` / `warhammer`.
- Check proper names and canonical spell names remain unchanged.
- Read messages as full sentences, including hits, misses, errors, and plurals.
- Confirm ancestry appears first in Talents with mechanics, not only lore.
- Confirm a tooltip-only edit leaves mechanics, save data, and resource tracking
  unchanged; add a regression check if the renderer or normalization is touched.
- Retain existing sheet geometry, text-fitting behavior, and typography when
  editing copy. Do not repair overflow by removing abilities or spell entries.
- Verify icon references resolve to the same original PNG without changing its
  bytes, and leave unrelated page branding alone.
