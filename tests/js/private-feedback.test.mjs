import test from 'node:test';
import assert from 'node:assert/strict';
import { canReadFeedback } from '../../S3_content/src/private-feedback.js';

test('single-player retains private spell feedback without a multiplayer viewer scope', () => {
  assert.equal(canReadFeedback({}, { privateCharacterId: 'wizard' }), true);
});

test('only the caster owner sees private feedback, not another player or an unassigned spectator', () => {
  const message = { privateCharacterId: 'wizard', detail: 'Badzog casts Illusion.' };
  assert.equal(canReadFeedback({ viewerCharacterIds: new Set(['wizard', 'fighter']) }, message), true);
  assert.equal(canReadFeedback({ viewerCharacterIds: new Set(['other']) }, message), false);
  assert.equal(canReadFeedback({ viewerCharacterIds: new Set() }, message), false);
  assert.equal(canReadFeedback({ viewerCharacterIds: new Set() }, { detail: 'A skeleton attacks.' }), true);
});
