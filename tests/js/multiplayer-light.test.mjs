import test from 'node:test';
import assert from 'node:assert/strict';
import { collectLightSources } from '../../S3_content/src/light-geometry.js';

function openDungeon() {
  const width = 24;
  const height = 5;
  return {
    map: { width, height },
    tiles: Array.from({ length: width * height }, (_, index) => ({
      x: index % width,
      y: Math.floor(index / width),
      type: 'floor',
      roomId: 'room'
    })),
    rooms: [{ id: 'room', x: 0, y: 0, width, height }],
    entities: [],
    decor: {},
    sharedRoom: true,
    viewerCharacterIds: new Set(['user-b']),
    characters: [
      { id: 'user-a', x: 2, y: 2, lightRadius: 6 },
      { id: 'user-b', x: 1, y: 2, lightRadius: 0 }
    ]
  };
}

test('another player light stays visible beyond its radius with clear line of sight', () => {
  const state = openDungeon();
  assert.equal(collectLightSources(state).length, 1);

  state.characters[0].x = 18;
  assert.equal(collectLightSources(state).length, 1);
  for (let y = 0; y < 5; y++) state.tiles[y * 24 + 10].type = 'wall';
  assert.equal(collectLightSources(state).length, 0);
  assert.equal(collectLightSources(state, { physical: true }).length, 1);

  state.characters[1].lightRadius = 6;
  const ownLights = collectLightSources(state);
  assert.equal(ownLights.length, 1);
  assert.deepEqual([ownLights[0].x, ownLights[0].y], [1, 2]);
});

test('unseen unattended lights use explored memory and resume exact illumination when seen again', async () => {
  const { recomputeVisibility } = await import('../../S3_content/src/visibility.js');
  const { isPointExplored } = await import('../../S3_content/src/exploration-memory.js');
  const { createEmptyDungeonState } = await import('../../S3_content/src/state-schema.js');
  const state = Object.assign(createEmptyDungeonState(1), openDungeon());
  delete state.viewerCharacterIds;state.sharedRoom=false;
  state.characters=[{ id:'hero', x:1, y:2, hp:10, lightRadius:0 }];
  state.player={ x:1,y:2,torchLit:false };
  state.entities=[{ id:'lamp', subtype:'dropped-equipment', x:18,y:2,lightRadius:6,lightSource:'torch',torchLit:true,lit:true }];
  recomputeVisibility(state);
  assert.equal(state.visibility.visibleNow.has('18,2'),true);
  assert.equal(isPointExplored(state,18.5,2.5),true);
  for(let y=0;y<5;y++)state.tiles[y*24+10].type='wall';
  recomputeVisibility(state);
  assert.equal(state.visibility.visibleNow.has('18,2'),false);
  assert.equal(isPointExplored(state,18.5,2.5),true);
  assert.equal(collectLightSources(state,{physical:true}).length,1,'the torch still burns in the world');
  for(let y=0;y<5;y++)state.tiles[y*24+10].type='floor';
  recomputeVisibility(state);
  assert.equal(state.visibility.visibleNow.has('18,2'),true);
});
