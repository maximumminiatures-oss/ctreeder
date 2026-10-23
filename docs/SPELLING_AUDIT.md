# English Gameplay Spelling Audit

Snapshot: October 21, 2026, 19:48 UTC. This is a bounded static-copy audit,
not a claim that every runtime variation or every dictionary unknown has been
human-verified. The checkout is shared and changing; private results include
per-source SHA-256 hashes identifying the exact snapshot.

## Scope and Evidence

Fixes are restricted to active English ShadowSpawner gameplay. Portfolio pages,
the retired About page, German supplemental monster records, user-approved noble
titles, identifiers, and saved-data keys were not rewritten. Parent-owned main,
character, background, noble, and sheet-lore modules were report-only.

The inventory covers HTML text and accessibility attributes, JavaScript string
literals and template fragments, JSON string values and human-looking keys, CSS
`content` strings, and top-level backend Python AST strings. It includes hidden
menus, original monster records, spell descriptions and paragraphs, and unused
or technical strings as a conservative superset. It is not a reachability proof.
Asset filenames, comments, regular expressions, generated substitutions, arbitrary
CSS values, third-party libraries, artwork, and external live imports are not an
exhaustive prose inventory. Traversal skips junctions/symlinks and asset folders.

Dictionary: `nspell@2.1.5` with `dictionary-en@4.0.0` (English US Hunspell).
Parser: `acorn@8.19.0`; existing `jsdom@30.0.1` handles HTML. Audit-only packages
are installed under `C:\SD_game\.dev\environments\spelling-audit`, not added to
production dependencies. See [nspell](https://www.npmjs.com/package/nspell) and
the [dictionary source](https://github.com/wooorm/dictionaries/blob/main/dictionaries/en/readme.md).

Dictionary SHA-256:
`f0b1a234bd178bdd01875b2a392a9647f888b8fe879f79c52aae62c2759b3647`.
Affix SHA-256:
`8ae1f19d4840d957728ad90555d5a8dff6cc5c046279c95ff0c00fc0a0136c7b`.

Unknown words are compared with the supplied 332-page Shadowdark PDF, SHA-256
`1999fcd97f796251fd6939643a1edaecc043483d41b646f8fde0f2d27c042082`.
Page references below are one-based PDF pages, not printed folios. Text-layer
extraction can contain OCR faults; PDF attestation alone does not approve damaged
glyphs. A separate pre-normalization scan checks decoded strings for broken
ligature placeholders, replacement glyphs, private-use characters, presentation
ligatures, and known mojibake sequences. This is not every possible encoding error.

Full PDF text remains outside Git at
`C:\SD_game\.dev\maintenance\spelling-20261021\shadowdark-pages.json`.
Source PDF: `C:\SD_game\.dev\history\legacy-websites\SD-website\Shadowdark.pdf`.
The private extraction script is `.dev\tools\extract-spelling-reference.py`.

## Results

166 files; 42,311 extracted string records; 6,648 distinct checked word types;
15,126 technical-only records excluded from dictionary checking; no extraction
errors; no remaining flagged glyph sequences in inventoried decoded strings.

| Inventory scope | String records | Unresolved word types |
| --- | ---: | ---: |
| Active gameplay candidates | 28,688 | 114 |
| Supplemental language/source review | 4,492 | 314 |
| Portfolio, excluded from fixes | 6,633 | 187 |
| Retired About page, excluded | 49 | 1 |
| Supporting code/pages | 2,362 | 46 |
| Workbench, inventory only | 87 | 1 |

Unresolved types overlap between scopes. The global total is 653, **not 653
confirmed spelling mistakes**. Checked token occurrences include 66,421 dictionary
matches, 2,118 exact PDF-attested tokens, 29 separately labeled PDF-base
inflections, 278 custom-title exceptions, 2,976 acronyms, 41 approved proper-name
tokens, and 53 technical-term tokens. Inflection evidence is not an exact PDF
match. Noble exceptions apply only to the approved data file, not globally.

## Corrections Applied

| Source | Correction | Evidence |
| --- | --- | --- |
| `src/treasure.js` | Saint Terrangis -> Saint Terragnis | PDF pp. 32, 302; canonical deity |
| `data/shadowdark-content.json` | Dessicated -> Desiccated | PDF p. 240, Mummy |
| Same | broken `flowing` ligature placeholder -> flowing | PDF p. 318, Shield of the Lion Lord |
| Same | broken `flanges` ligature placeholder -> flanges | PDF p. 319, Silver Mace of Wrath |
| `monsters-2.json`, Zombie prose | Four damaged smart-quote/dash sequences repaired | PDF pp. 271-272; punctuation only |
| `src/rest.js` | Visible Rest canceled message | Requested American spelling |
| `src/multiplayer.js` | Visible request canceled message | Same; `request_cancelled` unchanged |
| `src/save-menus.js` | Visible confirmation canceled message | Same; status `cancelled` unchanged |
| `src/treasure.js` instrument nouns | coronet -> cornet; sludra removed | User confirmed both typos on October 21; existing saved items unchanged |

No IDs, tags, numerical rules, prices, source metadata, or ability keys changed.
Parent independently handles main/sheet-lore display copy and the GitHub label.
Temporary portfolio corrections were reverted before completion.

## Remaining Review, Not Automatic Corrections

- `chainmal`, `data/shadowdark-content.json`, `loot/magicItems/43/tags/1`:
  likely `chainmail` (PDF p. 311), but it is a mechanical tag. Leave unchanged
  pending compatibility/ingestion review, not an unannounced key migration.
- Many instrument/armor words are specialist vocabulary absent from this
  dictionary and core PDF: for example `angklung`, `crwth`, `guqin`, `qanun`,
  `shakuhachi`, `brigandine`, and `lamellar`. These remain review candidates,
  not a blanket allowlist and not evidence that the data is misspelled.
- `polearm` has no extracted core-PDF match, including line-wrap joining; no
  concrete spelling correction established. `platemail` aliases, `underdark`,
  `lycanthrope` tags, UI selectors, and protocol values remain unchanged.
- Zombie abilities in `monsters-2.json` contain unrelated treasure-section
  narrative from PDF pp. 271-272, including story text appended to Relentless.
  This is an ingestion-boundary defect. Only punctuation was repaired; removing
  ability records or changing source structure is outside this spelling task.
- German `srd5e` records are preserved, not translated. Portfolio-only
  `Commisar`/`Refridgeration` are report-only. MCC names and stylized weapons
  need their own source, not the Shadowdark PDF.

Small examples of validated fantasy terms: Terragnis (32), Ramlaat (33),
mithral (26), duergar (217), viperian (266), grick (227), darkmantle (207),
Shune (33), and haruspex (34). Private findings retain occurrence/page evidence.

## Reproduce and Test

From `C:\SD_game\ShadowSpawner\.source`:

```powershell
node tools/text-spelling-audit.mjs --deps C:\SD_game\.dev\environments\spelling-audit --pdf-text C:\SD_game\.dev\maintenance\spelling-20261021\shadowdark-pages.json --out C:\SD_game\.dev\tests\spelling-audit-20261021 --python C:\SD_game\.dev\environments\website\Scripts\python.exe
node --test tests/js/text-spelling-audit.test.mjs tests/js/rest.test.mjs tests/js/save-menus.test.mjs tests/js/multiplayer-light.test.mjs tests/js/fire-damage.test.mjs
```

All 53 focused tests pass. Private `inventory.json`, `results.json`, and
`unresolved.tsv` retain occurrences, scope, ownership, classifications, and source
hashes. Optional `--suggest` enables dictionary suggestions but is much slower;
suggestions never trigger automatic edits. These private inventories include
source copy and must not be committed. No deployment or commits were performed.
