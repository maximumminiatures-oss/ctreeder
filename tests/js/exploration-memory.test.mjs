import clipping from '../../S3_content/src/vendor/polygon-clipping.js';
import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyDungeonState } from "../../S3_content/src/state-schema.js";
import {
  createExplorationMemory,
  rememberLightPolygons,
  isTileFullyExplored,
  isPointExplored,
  hydrateExplorationMemory,
  explorationChunks,
  migrateExplorationHistory,
} from "../../S3_content/src/exploration-memory.js";
import {
  serializeDungeonState,
  hydrateDungeonState,
} from "../../S3_content/src/persistence.js";
import { recomputeVisibility } from "../../S3_content/src/visibility.js";
import {
  setInnerWallTileMeta,
  getInnerWallConnectedSides,
} from "../../S3_content/src/inner-walls.js";

function scene() {
  const s = createEmptyDungeonState(3);
  s.map = { width: 4, height: 4 };
  s.tiles = Array.from({ length: 16 }, (_, i) => ({
    x: i % 4,
    y: Math.floor(i / 4),
    type: "floor",
    roomId: i === 5 ? "room" : null,
    hallId: i === 6 ? "hall" : null,
    meta: {},
  }));
  s.visibility.explorationMemory = createExplorationMemory();
  s.visibility.exploredInnerWallInteriors = new Set();
  return s;
}
const rect = (x, y, w, h) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
function remember(s, ring, source = { routeId: "" }) {
  rememberLightPolygons(s, [
    { source, polygon: ring.map((p) => p.map((v) => v * 54)) },
  ]);
}
test("partial diagonals stay precise; only complete union coverage removes geometry", () => {
  const s = scene();
  remember(s, [
    [1, 1],
    [2, 1],
    [1, 2],
  ]);
  assert.equal(isTileFullyExplored(s, 1, 1), false);
  assert.equal(isPointExplored(s, 1.1, 1.1), true);
  assert.equal(isPointExplored(s, 1.9, 1.9), false);
  remember(s, [
    [2, 1],
    [2, 2],
    [1, 2],
  ]);
  assert.equal(isTileFullyExplored(s, 1, 1), true);
  assert.equal(
    s.visibility.explorationMemory.routes[""].partial["1,1"],
    undefined,
  );
  assert.equal(s.visibility.explorationMemory.routes[""].rooms.room, true);
});
test("lit corners do not hide an unseen hole, even if the hole is very small", () => {
  const s = scene(),
    gap = 0.000001;
  remember(s, rect(1, 1, 1, 0.5 - gap));
  remember(s, rect(1, 1.5 + gap, 1, 0.5 - gap));
  remember(s, rect(1, 1, 0.5 - gap, 1));
  remember(s, rect(1.5 + gap, 1, 0.5 - gap, 1));
  assert.equal(isTileFullyExplored(s, 1, 1), false);
  assert.equal(isPointExplored(s, 1.5, 1.5), false);
  remember(s, rect(1, 1, 1, 1));
  assert.equal(isTileFullyExplored(s, 1, 1), true);
});
test("fully explored tiles never revert or accumulate more geometry on revisits", () => {
  const s = scene();
  remember(s, rect(1, 1, 1, 1));
  const memory = s.visibility.explorationMemory,
    chunk = explorationChunks(memory, "").get("0,0"),
    revision = chunk.revision;
  for (let i = 0; i < 500; i++)
    remember(s, [
      [1, 1],
      [2, 1],
      [1, 2],
    ]);
  assert.equal(isTileFullyExplored(s, 1, 1), true);
  assert.equal(chunk.revision, revision);
  assert.deepEqual(memory.routes[""].partial, {});
});
test("rooms and halls summarize only when every member tile is complete", () => {
  const s = scene();
  s.tiles[9].roomId = "room";
  s.tiles[10].hallId = "hall";
  remember(s, rect(1, 1, 2, 1));
  assert.equal(s.visibility.explorationMemory.routes[""].rooms.room, undefined);
  assert.equal(s.visibility.explorationMemory.routes[""].halls.hall, undefined);
  remember(s, rect(1, 2, 2, 1));
  assert.equal(s.visibility.explorationMemory.routes[""].rooms.room, true);
  assert.equal(s.visibility.explorationMemory.routes[""].halls.hall, true);
});
test("internal walls complete only after all transparent, unconnected sides have been lit", () => {
  for (const turns of [0, 1, 2, 3])
    for (const flipX of [false, true]) {
      const s = scene();
      setInnerWallTileMeta(s.tiles[5], "inner-wall", {
        kind: "run",
        rotationTurns: turns,
        flipX,
      });
      const vertical = turns % 2 === 0;
      remember(s, vertical ? rect(1, 1, 0.25, 1) : rect(1, 1, 1, 0.25));
      assert.equal(isTileFullyExplored(s, 1, 1), false);
      remember(s, vertical ? rect(1.75, 1, 0.25, 1) : rect(1, 1.75, 1, 0.25));
      assert.equal(isTileFullyExplored(s, 1, 1), true);
      assert.equal(s.visibility.exploredInnerWallInteriors.has("1,1"), true);
    }
});
test("both remembered door sides complete a door tile; one side stays partial", () => {
  const s = scene();
  s.entities = [
    {
      id: "door",
      type: "feature",
      subtype: "door",
      x: 1,
      y: 1,
      orientation: "vertical",
      doorState: "closed",
    },
  ];
  s.visibility.closedDoorExploredSides.set("door", new Set(["left"]));
  remember(s, rect(1, 1, 0.25, 1));
  assert.equal(isTileFullyExplored(s, 1, 1), false);
  s.visibility.closedDoorExploredSides.get("door").add("right");
  remember(s, rect(1.75, 1, 0.25, 1));
  assert.equal(isTileFullyExplored(s, 1, 1), true);
});
test("save/load preserves partial geometry and completed tiles without treating them as live light", () => {
  const s = scene();
  remember(s, [
    [1, 1],
    [2, 1],
    [1, 2],
  ]);
  remember(s, rect(2, 1, 1, 1));
  s.visibility.lightGeometryVersion = 13;
  const saved = serializeDungeonState(s),
    loaded = hydrateDungeonState(JSON.parse(JSON.stringify(saved)));
  assert.equal(isPointExplored(loaded, 1.1, 1.1), true);
  assert.equal(isPointExplored(loaded, 1.9, 1.9), false);
  assert.equal(isTileFullyExplored(loaded, 2, 1), true);
  loaded.player.torchLit = false;
  recomputeVisibility(loaded);
  assert.equal(loaded.visibility.visibleNow.size, 0);
  assert.equal(isTileFullyExplored(loaded, 2, 1), true);
  remember(loaded, [
    [2, 1],
    [2, 2],
    [1, 2],
  ]);
  assert.equal(isTileFullyExplored(loaded, 1, 1), true);
  assert.equal(
    isTileFullyExplored(s, 1, 1),
    false,
    "loaded memory must not alias the original save",
  );
});
test("legacy polygons migrate once without inventing full coverage from old coarse tile flags", () => {
  const s = scene();
  delete s.visibility.explorationMemory;
  s.visibility.lightGeometryVersion = 13;
  s.player.torchLit = false;
  s.visibility.exploredEver.add("1,1");
  s.visibility.exploredLightPolygons = [
    [
      [54, 54],
      [108, 54],
      [54, 108],
    ],
  ];
  recomputeVisibility(s);
  assert.equal(s.visibility.exploredLightPolygons.length, 0);
  assert.equal(isTileFullyExplored(s, 1, 1), false);
  assert.equal(isPointExplored(s, 1.9, 1.9), false);
  const before = JSON.stringify(s.visibility.explorationMemory);
  recomputeVisibility(s);
  assert.equal(JSON.stringify(s.visibility.explorationMemory), before);
});
test("imported region summaries cannot claim completion without complete tiles", () => {
  const memory = hydrateExplorationMemory({
    version: 1,
    routes: {
      "": {
        complete: {},
        partial: {},
        rooms: { room: true },
        halls: { hall: true },
      },
    },
  });
  assert.deepEqual(memory.routes[""].rooms, {});
  assert.deepEqual(memory.routes[""].halls, {});
});

test("complete regions replace individual tile flags in saves and restore exactly", () => {
  const s = scene();
  remember(s, rect(1, 1, 1, 1));
  remember(s, [
    [2, 1],
    [3, 1],
    [2, 2],
  ]);
  const saved = serializeDungeonState(s);
  assert.equal(saved.visibility.explorationMemory.compactRegions, true);
  assert.equal(saved.visibility.explorationMemory.routes[""].rooms.room, true);
  assert.equal(
    saved.visibility.explorationMemory.routes[""].complete["1,1"],
    undefined,
  );
  const loaded = hydrateDungeonState(saved);
  assert.equal(isTileFullyExplored(loaded, 1, 1), true);
  assert.equal(isTileFullyExplored(loaded, 2, 1), false);
  assert.equal(isPointExplored(loaded, 2.9, 1.9), false);
});
test("concave disconnected tile intersections preserve dark space between lit pieces", () => {
  const s = scene();
  // A U shape whose connection is outside the tile: clipping produces two separate strips.
  remember(s, [
    [0.5, 0.5],
    [2.5, 0.5],
    [2.5, 2],
    [1.8, 2],
    [1.8, 0.8],
    [1.2, 0.8],
    [1.2, 2],
    [0.5, 2],
  ]);
  assert.equal(isTileFullyExplored(s, 1, 1), false);
  assert.equal(isPointExplored(s, 1.1, 1.5), true);
  assert.equal(isPointExplored(s, 1.9, 1.5), true);
  assert.equal(isPointExplored(s, 1.5, 1.5), false);
});
test("opening a door alone is not proof that its entire tile has been lit", () => {
  const s = scene();
  s.entities = [
    {
      id: "door",
      type: "feature",
      subtype: "door",
      x: 1,
      y: 1,
      orientation: "vertical",
      doorState: "open",
    },
  ];
  remember(s, rect(1, 1, 0.25, 1));
  assert.equal(isTileFullyExplored(s, 1, 1), false);
  remember(s, rect(1, 1, 1, 1));
  assert.equal(isTileFullyExplored(s, 1, 1), true);
});

test("every internal-wall shape waits for every reachable transparent side, across rotations and flips", () => {
  const bands = {
    north: [1, 1, 1, 5 / 54],
    east: [2 - 5 / 54, 1, 5 / 54, 1],
    south: [1, 2 - 5 / 54, 1, 5 / 54],
    west: [1, 1, 5 / 54, 1],
  };
  for (const kind of ["cap", "corner", "t", "pillar", "run"]) {
    for (let rotationTurns = 0; rotationTurns < 4; rotationTurns++) {
      for (const flipX of [false, true])
        for (const flipY of [false, true]) {
          const s = scene();
          setInnerWallTileMeta(s.tiles[5], "inner-wall", {
            kind,
            rotationTurns,
            flipX,
            flipY,
          });
          const opaque = new Set(getInnerWallConnectedSides(s.tiles[5]));
          const reachable = Object.keys(bands).filter(
            (side) => !opaque.has(side),
          );
          for (let i = 0; i < reachable.length; i++) {
            remember(s, rect(...bands[reachable[i]]));
            assert.equal(
              isTileFullyExplored(s, 1, 1),
              i === reachable.length - 1,
              JSON.stringify({
                kind,
                rotationTurns,
                flipX,
                flipY,
                sides: reachable.slice(0, i + 1),
              }),
            );
          }
        }
    }
  }
});

test("crossing routes keep independent exploration and legacy polygons stay render-only", () => {
  const s = scene();
  s.underpasses = [
    {
      id: "lower",
      lowerCells: [{ x: 1, y: 1 }],
      upperCrossings: [{ x: 1, y: 1 }],
      portals: [],
    },
  ];
  remember(
    s,
    [
      [1, 1],
      [2, 1],
      [1, 2],
    ],
    { routeId: "lower" },
  );
  remember(
    s,
    [
      [2, 1],
      [2, 2],
      [1, 2],
    ],
    { routeId: "" },
  );
  assert.equal(isTileFullyExplored(s, 1, 1, "lower"), false);
  assert.equal(isTileFullyExplored(s, 1, 1, ""), false);
  assert.equal(isPointExplored(s, 1.1, 1.1, "lower"), true);
  assert.equal(isPointExplored(s, 1.1, 1.1, ""), false);
  s.visibility.exploredLightPolygons = [
    rect(1, 1, 1, 1).map((p) => p.map((v) => v * 54)),
  ];
  migrateExplorationHistory(s);
  assert.equal(
    s.visibility.explorationMemory.routes["@legacy"].complete["1,1"],
    true,
  );
  assert.equal(isTileFullyExplored(s, 1, 1, "lower"), false);
  assert.equal(isTileFullyExplored(s, 1, 1, ""), false);
});

test("a newly added room tile cannot inherit completion from an older summary on save", () => {
  const s = scene();
  remember(s, rect(1, 1, 1, 1));
  assert.equal(s.visibility.explorationMemory.routes[""].rooms.room, true);
  s.tiles[9].roomId = "room";
  const saved = serializeDungeonState(s);
  assert.equal(
    saved.visibility.explorationMemory.routes[""].rooms.room,
    undefined,
  );
  const loaded = hydrateDungeonState(saved);
  assert.equal(isTileFullyExplored(loaded, 1, 1), true);
  assert.equal(isTileFullyExplored(loaded, 1, 2), false);
});

test("coarse legacy saves preserve displayed floor without claiming precise route completion", () => {
  const s = scene();
  const memory = hydrateExplorationMemory(null, s, {
    exploredEver: ["1,1", "2,1"],
    visitedRoomIds: ["room"],
    exploredInnerWallInteriors: [],
    exploredLightPolygons: [],
  });
  assert.equal(memory.routes["@legacy"].complete["1,1"], true);
  assert.equal(memory.routes["@legacy"].complete["2,1"], true);
  assert.equal(memory.routes[""], undefined);
});

test("legacy history caps cannot erase older displayed floor or inflate a surviving partial boundary", () => {
  const s = scene();
  delete s.visibility.explorationMemory;
  s.visibility.lightGeometryVersion = 13;
  s.player.torchLit = false;
  s.tiles[9].roomId = "old-room";
  s.visibility.visitedRoomIds.add("old-room");
  s.visibility.visitedRoomIds.add("room");
  s.visibility.exploredEver.add("1,2");
  s.visibility.exploredEver.add("1,1");
  s.visibility.exploredLightPolygons = [
    [
      [54, 54],
      [108, 54],
      [54, 108],
    ],
  ];
  const loaded = hydrateDungeonState(serializeDungeonState(s));
  recomputeVisibility(loaded);
  assert.equal(
    loaded.visibility.explorationMemory.routes["@legacy"]?.complete["1,2"],
    true,
  );
  assert.equal(
    isTileFullyExplored(loaded, 1, 2),
    false,
    "legacy display cannot certify new completion",
  );
  assert.equal(
    isPointExplored(loaded, 1.9, 1.9),
    false,
    "precise partial coverage must win over coarse old flags",
  );
});

test('a geometry output-ring failure preserves exact coverage and cannot abort a character import', () => {
  const s=scene(),original=clipping.union;
  try {
    clipping.union=()=>{throw new Error('Unable to complete output ring starting at [4.01027962962963, 14]. Last matching segment found ends at [4.0466999999999995, 13.8213].');};
    remember(s,[[1,1],[2,1],[1,2]]);
    assert.equal(isPointExplored(s,1.1,1.1),true);
    assert.equal(isPointExplored(s,1.9,1.9),false);
    remember(s,[[2,1],[2,2],[1,2]]);
    assert.equal(isPointExplored(s,1.9,1.9),true);
  } finally {clipping.union=original;}
  const saved=serializeDungeonState(s),loaded=hydrateDungeonState(saved);
  assert.equal(isPointExplored(loaded,1.1,1.1),true);
  assert.equal(isPointExplored(loaded,1.9,1.9),true);
});


test("unchanged partial geometry reuses completion checks but changed required wall geometry is rechecked", () => {
  const s = scene();
  remember(s, rect(1, 1, .25, 1));
  remember(s, rect(1.75, 1, .25, 1));
  const route=s.visibility.explorationMemory.routes[''];
  const original=route.partial['1,1'];
  // Different light polygons produce the same clipped coverage on this tile.
  for (let i=0;i<5;i++) remember(s, rect(.5-i*.01, 1, .75+i*.01, 1));
  assert.equal(route.partial['1,1'],original);
  assert.equal(isTileFullyExplored(s,1,1),false);
  setInnerWallTileMeta(s.tiles[5], 'inner-wall', {kind:'run'});
  remember(s,rect(.3,1,.95,1));
  assert.equal(isTileFullyExplored(s,1,1),true);
});


test('complex failed compaction retains immutable exact pieces, deduplicates observations and completes when wholly observed',()=>{
 const s=scene(),key='1,1';
 // Distinct, overlapping narrow triangles simulate old animation contours.
 const pieces=Array.from({length:1100},(_,i)=>[[[1,1],[1.2+i/100000,1],[1,1.3],[1,1]]]);
 const original=structuredClone(pieces);
 s.visibility.explorationMemory.routes['']={complete:{},partial:{[key]:pieces},rooms:{},halls:{}};
 const union=clipping.union;
 try{clipping.union=()=>{throw new Error('Injected failed large merge');};remember(s,[[1,1],[1.3,1],[1,1.4]]);}
 finally{clipping.union=union;}
 assert.equal(isTileFullyExplored(s,1,1),false);
 assert.equal(isPointExplored(s,1.01,1.01),true);
 assert.equal(isPointExplored(s,1.9,1.9),false);
 const partial=s.visibility.explorationMemory.routes[''].partial[key];
 assert.equal(partial.length,1101);
 assert.deepEqual(partial.slice(0,1100),pieces);
 assert.deepEqual(pieces,original,'historical rings are immutable');
 s.entities=[{id:'far-door',subtype:'door',x:3,y:3,doorState:'closed',orientation:'vertical'}];
 // A changed door signature forces reprocessing of the identical observation.
 remember(s,[[1,1],[1.3,1],[1,1.4]]);
 assert.equal(s.visibility.explorationMemory.routes[''].partial[key],partial);
 assert.equal(partial.length,1101);
 remember(s,rect(1,1,1,1));
 assert.equal(isTileFullyExplored(s,1,1),true);
 assert.equal(s.visibility.explorationMemory.routes[''].partial[key],undefined);
});
