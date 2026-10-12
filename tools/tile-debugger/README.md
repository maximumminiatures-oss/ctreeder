# Local Tile Workbench

Start with `C:\SD_game\.dev\tools\start-tile-workbench.ps1 -Port 5059`.
This loopback-only tool is independent of the game preview, accounts and saves.
Artist exports and study books live under
`C:\SD_game\.dev\design-examples\organic-tiles`.

## Current Review

The current organic/crypt asset review is complete. All 170 organic lighting
profiles are reviewed, and all 178 organic/crypt assets have demonstrated fit
evidence. The final three exports settled the last asset and supplied ten more
shadow corrections. No additional review pages are needed for the current art.

The completion report is
`.dev/design-examples/organic-tiles/studies/organic-review-complete-20261011-inference.json`.
Earlier study IDs and their browser autosaves remain available, including
<http://127.0.0.1:5059/tools/tile-debugger/?study=organic-final-check-20261011&page=1>.
Old pages may retain explicit unconfirmed-rule flags; browser history is not
cleared merely because compiled lighting and fit evidence is complete.

Red picker dots indicate placement gaps. Amber dots indicate remaining
movement/light rule gaps. Placement confidence and rule confidence are separate.
The current provenance, archive manifest and evidence reports are documented in
`.dev/design-examples/organic-tiles/STUDY_EVIDENCE.md` at the workspace root.

## Reusable Shadow Pen

Select a tile, select Shadow Pen, and draw an open polyline. The browser's
primary click adds points; secondary click finishes. One point is cancelled.
Tile-owned points use native asset coordinates, even outside the tile's bounds.
With no selected tile, a pen line uses fixed map coordinates.

Tile shadows are shared by exact asset name, digest and dimensions. Every
matching copy receives the same native geometry, transformed by its own pose.
Newly placed copies and other study pages inherit it. Browser-local definitions
take precedence over compiled evidence; outputs include the shared definitions.
Empty definitions explicitly suppress inherited lines after deletion.

Repeated artist traces retain the fewest-point version. Distinct wall contours
and interior lines are preserved. Artist corrections always beat inferred
traces, even when the artist uses more points. Drawing never changes movement.
Precise pen geometry replaces coarse automatic light geometry, while explicit
light annotations and locked solid black tiles remain authoritative.

Unchanged drafts remain tagged `inferred` through output and reload; they do not
become training evidence. Confirmed accepts the current tile rules and contours.
Reviewed draft acceptance is separate from authorship. An edited rule is pinned
even if its remaining paths are inferred: deleting one contour cannot let a new
draft revision restore it. Legacy revision-less draft edits receive the same
protection. The October 11 reconciliation recovered three such deletions from
earlier snapshots instead of treating their later automatic restoration as art.
For organic art, only a completely black edge gets an automatic full-edge light
blocker. Partial walls use inset pen contours instead. Explicit artist edits are
preserved. The current artist examples typically use 6-11 points per contour
(median 9 in the latest batch), with a 1-2 pixel inset; drafts emulate that complexity.

## Evidence Pipeline

- `scripts/build_placement_knowledge.mjs`: learns demonstrated placement shape
  families separately from movement/light confirmation.
- `scripts/build_shadow_rules.mjs`: normalizes tile-owned paths and conservatively
  associates legacy map paths with nearby organic artwork. Unresolved paths stay
  map-specific; inspect inferred associations before changing game runtime rules.
- `scripts/build_review_gap_study.mjs`: creates a fresh, non-overwriting study ID
  for current placement gaps and adds the latest room map plus a blank page.
- `scripts/organic_shadow_analysis.py`: calibrates simple inset contours against
  artist brush examples and measures completely black native grid edges.
- `scripts/build_lighting_review.mjs`: creates separate lighting and tile-fit
  pages without overwriting earlier studies or artist exports. With no remaining
  gaps and `--omit-room-map`, writes a completion report instead of an empty book.
- `scripts/reconcile_tile_review.mjs`: reconciles corrected snapshots with their
  actual baseline; explicit review acceptance never changes inferred authorship.
- `shadow-paths.mjs`: reusable merge, validation guards and inheritance helpers.

The local game now consumes `S3_content/src/reviewed-tile-data.js`: all 170
reviewed organic lighting profiles, movement annotations and ten large hall
shapes. Its asset manifest includes all reviewed variants. Large halls keep
native artwork, transformed movement edges/vertices and exact shadow paths;
floor-aligned token/light centers do not change tile-to-tile movement. Crypts
remain tiny enclosed rooms with undead-only encounters and protected artwork.
This is local integration, not a production deployment.

Rebuild the runtime data after updating reviewed evidence:

```powershell
python scripts/build_tile_edge_profiles.py http://127.0.0.1:5059/api/catalog <new-profile.json> --all-cells
node scripts/build_runtime_tile_rules.mjs <new-profile.json> S3_content/src/reviewed-tile-data.js C:\SD_game\.dev\design-examples\organic-tiles S3_content/data/organic-assets.json
```

The compiler verifies current PNG and source-export hashes, refuses stale or
unreviewed lighting, and checks connectivity of native corridor ports. Use the
game-tools environment for the first command. Keep original exports immutable. Older exports/studies can be
archived with a hash manifest and study archive index; never overwrite old IDs
or remove browser autosaves as part of cleanup.

Run `npm test`. Run `tests/test_organic_shadow_analysis.py` with the game-tools
environment and `--noconftest` (Pillow is not installed in the website environment).
The current browser regression check is
`C:\SD_game\.dev\tests\check-completed-tile-review-20261011.py`; it uses a
private Playwright context and intercepts output, leaving artist drafts intact.
The runtime integration check is
`C:\SD_game\.dev\tests\check-runtime-tiles-20261011.py`; seed 72 at level 1
includes organic rooms, a seven-tile-long hall and crypt chambers.
