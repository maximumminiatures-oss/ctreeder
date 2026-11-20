import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const root = new URL("../../S3_content/", import.meta.url);
const dom = new JSDOM(await readFile(new URL("index.html", root), "utf8"), {
  url: "http://localhost/site/",
});
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  Image: dom.window.Image,
  __SD_SERVER_RUNTIME__: true,
});
globalThis.fetch = async (input) =>
  new Response(
    await readFile(new URL(String(input).replace(/^\.\//, ""), root)),
    { headers: { "Content-Type": "application/json" } },
  );
const { executeGameCommand } = await import("../../S3_content/src/main.js");
test.after(() => dom.window.close());
function scene({ combat = true, bow = false } = {}) {
  const width = 18,
    height = 12;
  const stats = { STR: 14, DEX: 16, CON: 12, INT: 12, WIS: 12, CHA: 10 };
  const hero = {
    id: "hero",
    name: "Hero",
    className: "Fighter",
    ancestry: "Human",
    level: 3,
    hp: 100,
    maxHitPoints: 100,
    stats: { ...stats },
    x: 2,
    y: 5,
    roomId: "room",
    equipmentInitialized: true,
    gear: bow
      ? [
          { name: "Longbow", equipped: true, type: "weapon", slots: 2 },
          {
            name: "Arrows",
            quantity: 20,
            units: 20,
            slots: 1,
            ammoType: "arrows",
          },
        ]
      : [{ name: "Longsword", equipped: true, type: "weapon", slots: 1 }],
  };
  const buddy = {
    id: "buddy",
    name: "Buddy",
    className: "Fighter",
    ancestry: "Human",
    level: 3,
    hp: 100,
    maxHitPoints: 100,
    stats: { ...stats },
    x: 1,
    y: 5,
    roomId: "room",
    equipmentInitialized: true,
    gear: [{ name: "Torch", lit: true, equipped: true }],
    lightSource: "torch",
    lightRadius: 6,
  };
  const foe = {
    id: "foe",
    type: "monster",
    name: "Orc",
    hp: 100,
    maxHp: 100,
    ac: 10,
    x: 5,
    y: 5,
    roomId: "room",
    attitude: combat ? "combat" : "neutral",
    attitudeChecked: true,
    hostile: combat,
    attack: "1 claw +0 (1d4)",
    I: 0,
    D: 0,
    level: 1,
    conditions: {},
    knownCharacterSquares: { hero: { id: "hero", x: 2, y: 5, routeId: "" } },
  };
  return {
    seed: 55,
    level: 1,
    map: { width, height },
    tiles: Array.from({ length: width * height }, (_, i) => ({
      x: i % width,
      y: Math.floor(i / width),
      type: "floor",
      roomId: "room",
      meta: {},
    })),
    rooms: [{ id: "room", x: 0, y: 0, width, height }],
    halls: [],
    generation: { entranceRoomId: "room" },
    characters: [hero, buddy],
    entities: [foe],
    player: { x: 2, y: 5, roomId: "room", torchLit: false },
    activeCharacterId: "hero",
    visibility: { exploredEver: [] },
    rollHistory: [],
    combat: {
      active: combat,
      round: 1,
      turnIndex: 0,
      movementRemaining: 6,
      movementBudget: 6,
      actionUsed: false,
      turnStartPending: false,
      turnOrder: [
        { type: "character", id: "hero" },
        { type: "monster", id: "foe" },
        { type: "character", id: "buddy" },
      ],
      playerOrderIds: ["hero", "buddy"],
      monsterIds: ["foe"],
    },
    timers: {
      torchElapsedMs: 0,
      torchDurationMs: 3600000,
      actualElapsedMs: 0,
      lastTickAt: Date.now(),
    },
    wanderingMonsters: { numerator: 0, denominator: 6 },
  };
}
async function command(state, type, extra = {}, random = 0.5) {
  const original = Math.random;
  Math.random = () => random;
  try {
    return await executeGameCommand(state.state_json || state, {
      type,
      character_id: "hero",
      ...extra,
    });
  } finally {
    Math.random = original;
  }
}
const actor = (result) =>
  result.state_json.characters.find((c) => c.id === "hero");
const enemy = (result) =>
  result.state_json.entities.find((e) => e.id === "foe");
test("empty bow shot spends one arrow and reports the ammunition name and empty tile", async () => {
  const result = await command(scene({ bow: true }), "attack_empty", {
    x: 8,
    y: 5,
    attack_index: 0,
  });
  assert.match(
    JSON.stringify(result.state_json.rollHistory),
    /Your arrow misses\. This tile is empty\./,
  );
  assert.equal(
    actor(result).gear.find((item) => /arrows/i.test(item.name)).quantity,
    19,
  );
  assert.equal(result.state_json.combat.actionUsed, true);
});
test("a correct invisible-square guess is disadvantaged and records its location even on a miss", async () => {
  const s = scene({ bow: true });
  s.entities[0].invisible = true;
  const result = await command(
    s,
    "attack_empty",
    { x: 5, y: 5, attack_index: 0 },
    0.05,
  );
  assert.equal(enemy(result).invisible, true);
  assert.equal(enemy(result).darkGuess.x, 5);
  const attack = result.state_json.rollHistory.find(
    (entry) => entry.label === "Attack",
  );
  assert.equal(attack.rollCard.results.length, 2);
});
test("an invisible attacker against an invisible prone target makes one straight roll", async () => {
  const s = scene({ bow: true });
  s.characters[0].invisibility = {
    rounds: 3,
    source: "halfling",
    breakOnOffense: false,
  };
  s.entities[0].invisible = true;
  s.entities[0].conditions.prone = true;
  const result = await command(s, "attack_empty", {
    x: 5,
    y: 5,
    attack_index: 0,
  });
  const attack = result.state_json.rollHistory.find(
    (entry) => entry.label === "Attack",
  );
  assert.equal(attack.rollCard.results.length, 1);
});
test("ending a turn within three squares reveals ordinary stealth without ending magical invisibility", async () => {
  const s = scene();
  s.characters[0].stealthed = true;
  s.characters[0].invisibility = {
    rounds: 3,
    source: "halfling",
    breakOnOffense: false,
  };
  s.combat.turnOrder = [
    { type: "character", id: "hero" },
    { type: "character", id: "buddy" },
  ];
  const ready = await command(s, "normalize");
  assert.equal(actor(ready).stealthed, true);
  const result = await command(ready, "end_turn");
  assert.equal(actor(result).stealthed, false);
  assert.ok(actor(result).invisibility.rounds > 0);
});
test("hearing through a wall starts hostile combat without revealing the monster", async () => {
  const s = scene({ combat: false });
  s.entities[0].x = 4;
  s.entities[0].hostile = true;
  s.entities[0].attitude = "hostile";
  for (let y = 0; y < 12; y++) s.tiles[y * 18 + 3].type = "wall";
  const result = await command(s, "move", { dx: 0, dy: 1 });
  assert.equal(result.state_json.combat.active, true);
  assert.ok(result.state_json.combat.monsterIds.includes("foe"));
  assert.equal(enemy(result).knownCharacterSquares.hero.heard, true);
  assert.equal(enemy(result).knownCharacterSquares.hero.seen, false);
});
test("an invisible monster with a guessed location moves even with negative Intelligence", async () => {
  const s = scene();
  s.entities[0].name = "Invisible Stalker";
  s.entities[0].I = -3;
  s.entities[0].darkGuess = { x: 5, y: 5, routeId: "" };
  const result = await command(s, "end_turn");
  assert.ok(enemy(result).x !== 5 || enemy(result).y !== 5);
  assert.equal(enemy(result).darkGuess, undefined);
});
test("a monster guesses its remembered square instead of following a moved invisible character", async () => {
  const s = scene();
  s.characters = [s.characters[0]];
  s.characters[0].x = 3;
  s.characters[0].invisibility = {
    rounds: 3,
    source: "halfling",
    breakOnOffense: false,
  };
  s.characters[0].gear.push({ name: "Torch", lit: true, equipped: true });
  s.characters[0].lightRadius = 6;
  s.characters[0].lightSource = "torch";
  s.combat.turnOrder = [
    { type: "character", id: "hero" },
    { type: "monster", id: "foe" },
  ];
  s.combat.playerOrderIds = ["hero"];
  const result = await command(s, "end_turn");
  assert.equal(actor(result).hp, 100);
  assert.match(
    JSON.stringify(result.state_json.rollHistory),
    /This tile is empty/,
  );
});

test("a successfully stealthed hostile that only hears a character prepares its ambush outside combat", async () => {
  const s = scene({ combat: false });
  const foe = s.entities[0];
  Object.assign(foe, {
    name: "Bandit",
    x: 4,
    hostile: true,
    attitude: "hostile",
    stealthState: { attempted: true, roll: 20, total: 20, revealed: false },
  });
  // An unbroken wall blocks attack and movement; hearing alone must not break the ambush.
  for (let y = 0; y < 12; y++) s.tiles[y * 18 + 3].type = "wall";
  const result = await command(s, "tick", { elapsed_ms: 1000 });
  assert.equal(result.state_json.combat.active, false);
  assert.equal(enemy(result).stealthState.revealed, false);
  assert.equal(enemy(result).knownCharacterSquares.hero.heard, true);
  assert.equal(enemy(result).knownCharacterSquares.hero.seen, false);
});
