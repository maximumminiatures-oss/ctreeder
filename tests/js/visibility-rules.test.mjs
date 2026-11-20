import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyDungeonState } from "../../S3_content/src/state-schema.js";
import { conditionAttackMode } from "../../S3_content/src/conditions.js";
import {
  isMonsterCurrentlyVisible,
  isCreatureLocationKnown,
  monsterHearsTarget,
  refreshMonsterAwareness,
  markMonsterCorrectlyGuessed,
} from "../../S3_content/src/monster-perception.js";
import {
  visibleDungeonEntities,
  renderDungeon,
} from "../../S3_content/src/render.js";
import { blindDungeonView } from "../../S3_content/src/viewer-perception.js";
import { planStealthApproach } from "../../S3_content/src/monster-ai.js";
import { canMoveBetweenTiles } from "../../S3_content/src/interactions.js";

function scene() {
  const s = createEmptyDungeonState(5);
  s.map = { width: 22, height: 12 };
  s.tiles = Array.from({ length: 264 }, (_, i) => ({
    x: i % 22,
    y: Math.floor(i / 22),
    type: "floor",
    meta: {},
  }));
  s.player.torchLit = false;
  const hero = {
    id: "hero",
    hp: 20,
    x: 1,
    y: 5,
    lightRadius: 6,
    conditions: {},
  };
  const ally = {
    id: "ally",
    hp: 20,
    x: 1,
    y: 6,
    lightRadius: 0,
    conditions: {},
    companion: { kind: "friendly" },
  };
  s.characters = [hero, ally];
  s.activeCharacterId = "hero";
  const foe = {
    id: "foe",
    type: "monster",
    name: "Orc",
    hp: 20,
    x: 4,
    y: 5,
    conditions: {},
  };
  s.entities = [foe];
  s.visibility.visibleNow = new Set(["4,5"]);
  return { s, hero, ally, foe };
}
test("invisible attacker versus invisible prone target rolls straight despite multiple advantages", () => {
  const attacker = { invisible: true },
    target = { invisible: true, conditions: { prone: true } };
  assert.deepEqual(
    conditionAttackMode(target, { attacker, melee: true, advantage: true }),
    { doubleRoll: false, disadvantage: false },
  );
  assert.deepEqual(conditionAttackMode({ stealthed: true }, { attacker: {} }), {
    doubleRoll: false,
    disadvantage: true,
  });
  assert.deepEqual(conditionAttackMode({}, { attacker: { stealthed: true } }), {
    doubleRoll: true,
    disadvantage: false,
  });
  assert.deepEqual(
    conditionAttackMode({}, { attacker: { conditions: { blind: true } } }),
    { doubleRoll: false, disadvantage: true },
  );
});
test("invisible and stealthed enemies stay hidden; Detect Magic shows only a known location", () => {
  const { s, hero, foe } = scene();
  foe.invisible = true;
  assert.equal(isMonsterCurrentlyVisible(s, foe), false);
  assert.deepEqual(visibleDungeonEntities(s), []);
  hero.magicDetectedIds = ["foe"];
  hero.focusSpell = { spell: "detect magic", radius: 6 };
  assert.equal(isCreatureLocationKnown(s, foe), true);
  assert.equal(isMonsterCurrentlyVisible(s, foe), false);
  assert.deepEqual(
    visibleDungeonEntities(s).map((e) => e.id),
    ["foe"],
  );
  s.tiles[5 * 22 + 2].type = "wall";
  assert.equal(isCreatureLocationKnown(s, foe), false);
});
test("known invisible locations disappear after movement and do not reveal possessed ghosts", () => {
  const { s, foe } = scene();
  foe.invisible = true;
  markMonsterCorrectlyGuessed(foe, s);
  assert.equal(isCreatureLocationKnown(s, foe), true);
  foe.y++;
  assert.equal(isCreatureLocationKnown(s, foe), false);
  foe.y--;
  foe.visible = false;
  foe.possessingId = "hero";
  assert.equal(isCreatureLocationKnown(s, foe), false);
});
test("only the selected recruited monster adds creature darkvision, including on its combat turn", () => {
  const { s, hero, ally, foe } = scene();
  hero.lightRadius = 0;
  foe.x = 10;
  s.visibility.visibleNow.clear();
  assert.equal(isMonsterCurrentlyVisible(s, foe), false);
  s.activeCharacterId = "ally";
  assert.equal(isMonsterCurrentlyVisible(s, foe), true);
  s.combat = {
    active: true,
    turnIndex: 0,
    turnOrder: [
      { type: "character", id: "hero" },
      { type: "character", id: "ally" },
    ],
  };
  assert.equal(isMonsterCurrentlyVisible(s, foe), false);
  s.combat.turnIndex = 1;
  assert.equal(isMonsterCurrentlyVisible(s, foe), true);
});
test("a blind character combat view hides all creature tokens without forgetting memory", () => {
  const { s, hero, foe } = scene();
  hero.conditions.blind = true;
  s.combat = {
    active: true,
    turnIndex: 0,
    movementRemaining: 0,
    turnOrder: [{ type: "character", id: "hero" }],
  };
  s.visibility.exploredEver.add("4,5");
  assert.equal(blindDungeonView(s), true);
  assert.equal(isMonsterCurrentlyVisible(s, foe), false);
  assert.deepEqual(visibleDungeonEntities(s), []);
  let arcs = 0;
  const ctx = new Proxy(
    {
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      arc() {
        arcs++;
      },
    },
    { get: (o, k) => (k in o ? o[k] : () => {}) },
  );
  renderDungeon(s, { fogCtx: ctx }, { motionOnly: true });
  assert.equal(arcs, 0);
  assert.equal(s.visibility.exploredEver.has("4,5"), true);
});
test("hearing uses six squares, or three behind opaque geometry, without granting sight", () => {
  const { s, hero, foe } = scene();
  foe.x = 7;
  assert.equal(monsterHearsTarget(s, foe, hero), true);
  foe.x = 8;
  assert.equal(monsterHearsTarget(s, foe, hero), false);
  foe.x = 4;
  s.tiles[5 * 22 + 2].type = "wall";
  assert.equal(monsterHearsTarget(s, foe, hero), true);
  foe.x = 5;
  assert.equal(monsterHearsTarget(s, foe, hero), false);
  foe.x = 4;
  hero.stealthed = true;
  assert.equal(monsterHearsTarget(s, foe, hero), false);
  delete hero.stealthed;
  hero.invisible = true;
  assert.equal(monsterHearsTarget(s, foe, hero), false);
});
test("monster knowledge retains an invisible target previous square rather than following its new position", () => {
  const { s, hero, foe } = scene();
  refreshMonsterAwareness(s, foe);
  const original = { ...foe.knownCharacterSquares.hero };
  hero.invisible = true;
  hero.x = 12;
  refreshMonsterAwareness(s, foe);
  assert.deepEqual(foe.knownCharacterSquares.hero, original);
});
test("hidden approach stops beyond three squares and leaves an attack reachable next turn", () => {
  const { s, hero, foe } = scene();
  foe.x = 12;
  hero.x = 2;
  foe.routeId = "";
  hero.routeId = "";
  const plan = planStealthApproach(s, foe, hero, {
    movement: 6,
    observers: [hero],
    canStep: (x, y, nx, ny) =>
      canMoveBetweenTiles(s, x, y, nx, ny).ok &&
      !(nx === hero.x && ny === hero.y),
    canAttackFrom: (x, y) =>
      Math.max(Math.abs(x - hero.x), Math.abs(y - hero.y)) <= 1,
  });
  assert.ok(plan?.steps.length);
  assert.ok(Math.hypot(plan.x - hero.x, plan.y - hero.y) > 3);
  assert.equal(plan.attackNextTurn, true);
  for (const step of plan.steps)
    assert.ok(Math.hypot(step.x - hero.x, step.y - hero.y) > 3);
});
