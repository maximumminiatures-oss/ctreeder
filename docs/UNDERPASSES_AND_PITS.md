# Underpasses and pits

## Route topology

`src/underpasses.js` indexes each underpass as a separate lower route. The
ordinary upper route has ID `""`; characters, monsters, dropped equipment and
movement frames retain `routeId`. A crossing has two independent nodes at the
same coordinates. Only the two stair portals connect them. Lower tokens render
at 50% opacity, without changing their underlying character color.

Navigation, following, Floating Disc, monster pursuit, occupancy, current
visibility, light sources, targeted spells, area effects and touch interactions
respect the route. Incorporeal creatures may phase through walls but do not
silently change elevation. Personal-character imports start upstairs in the
starting room rather than retaining a route from a different saved dungeon.

Exploration is retained per route in saved runs and per-player multiplayer
history. Shared movement remains server-authoritative and sends route IDs with
the existing interpolated movement frames.

## Generation

The generator can add one lower passage beneath a straight upper corridor when
there is a valid pair of existing floor approaches. It avoids occupied artwork,
reviewed rooms and organic geometry. Ordinary passage sections use the exported
`stairs-down-straight-1x1` and `stairs-down-straight-1x2` artwork. Only the crossing
uses `tunnel-below`; `tunnel-below-wall` is reserved for a necessary room-perimeter
wall, with candidates needing no such wall preferred. Both orientations work.
Room entrances retain a normal doorway tile before the descending stairs, so
stair artwork never occupies a room or its doorway. Existing route artwork is
upgraded on load without changing navigation or character positions.

The new passage adds a loop rather than replacing an existing connection. A
route-aware flood fill verifies that every previously reachable upper node,
every lower node and both stair entrances remain reachable from the starting
stairs. Invalid candidates are rolled back. A seed with no valid candidate
keeps its original dungeon.

## Pit damage

An unsuccessful pit save or successful push applies 3d6 falling damage to a
non-flying, corporeal monster. Pushed monsters do not receive a second save.
Lethal falls defeat the monster. Climbing, combat initialization, normalization
and saving do not restore this damage. The push result reports the three dice
and HP before/after; `lastPitFall` retains the result for diagnosis.

The local review Orc intentionally starts at 30 HP, so an 18-damage fall leaves
12 HP. A normal low-HP Orc can die from the same fall.

## Local checks

- `/site/?test-party=three&pit-test=one`: pit, rescue and push scene.
- `/site/?test-party=three&underpass-test=one`: connected crossing scene.
- `tests/js/underpasses.test.mjs`: topology, both orientations, lighting, spells,
  occupancy, darkness, saving and generated-map reachability.
- `tests/test_underpasses.py`: authoritative commands, motion frames, validation,
  multiplayer round trips and per-player exploration.

These fixture URLs are loopback-only and do not modify the original character
exports. The tile workbench remains a flat artwork/geometry authoring surface;
the running game interprets crossings using the route graph.

## Pit tunnels and deliberate descent

Pits support arbitrary cell footprints, including narrow or rotated rectangles.
Room pits can be any room-fitting size; hallway pit traps remain 1x1. Uncommon
pit networks connect two pits through a separate lower route, sometimes adding
a room that has no ordinary hallway entrance. These are physical connections
within this dungeon, not stairs to a new generated dungeon level.

A conscious character carrying rope at an open pit's rim receives a Climb down?
Yes/No prompt. Confirming spends their combat action if applicable and descends
without falling damage. Rope is retained. The lower passage can be explored
normally, with no sight, targeting, occupancy, or lighting shared with the floor
above. Returning to the floor from either pit uses DC 15 STR (STR Grit grants
advantage), unless an adjacent ally rescues the character with rope. Carrying
rope does not automatically bypass the unassisted ascent check at another pit.
Falling into a connected pit still deals 3d6 and leaves the victim prone.

Generation verifies lower-route and bonus-room reachability before accepting a
network, restoring all changes if it fails. Reachability includes the deliberate
climbing connections; ordinary arrow movement cannot change floors at a pit.
Optional networks use a 20% candidate chance, subject to a safe fit, rather than
forcing one into every dungeon. Standalone pits use separate uncommon rolls.

Local review: `/site/?test-party=three&pit-tunnel-test=one` starts beside a 1x1
pit linked to a larger pit in an otherwise disconnected room.

## Statues

All four `statue-1x1` directional assets block movement like a central pillar.
They cast the same inset, one-third-tile shadow rather than making their entire
tile opaque. This applies in the workbench, newly applied layouts, and older
saved placements missing movement/light annotations. Upper-level statues do not
block the separate passage below. The underpass fixture includes two examples.
