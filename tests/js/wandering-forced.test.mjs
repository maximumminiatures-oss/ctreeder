import test from 'node:test';
import assert from 'node:assert/strict';
import { maybeSpawnWanderingMonster } from '../../S3_content/src/wandering.js';

test('an already-triggered spell encounter does not roll the ordinary wandering chance a second time', () => {
  const state = { seed: 5, map: { width: 15, height: 3 },
    tiles: Array.from({ length: 45 }, (_, i) => ({ x: i % 15, y: Math.floor(i / 15), type: 'floor', meta: {} })),
    characters: [], entities: [], rooms: [], decor: {}, player: { x: 7, y: 1, torchLit: false },
    wanderingMonsters: { numerator: 0, denominator: 6, spawnedCount: 0 } };
  const monsters = [{ name: 'Rat', hp: 2, ac: 10, level: 1, attack: '1 bite +0 (1)' }];
  assert.equal(maybeSpawnWanderingMonster(state, monsters, { ignoreDarkness: true, allowUnlit: true }).spawned, false);
  const result = maybeSpawnWanderingMonster(state, monsters, { ignoreDarkness: true, allowUnlit: true, forceEncounter: true });
  assert.equal(result.spawned, true); assert.equal(result.entity.name, 'Rat');
  assert.equal(state.wanderingMonsters.numerator, 0); assert.equal(state.wanderingMonsters.spawnedCount, 1);
});
