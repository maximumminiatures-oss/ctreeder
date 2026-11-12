import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMonsterAttack, monsterAttackSegments, monsterAttackSequence } from '../../S3_content/src/monster-attacks.js';

test('counted attacks retain presentation fields and produce separate strikes', () => {
  const attack = parseMonsterAttack('2 claws +4 (1d8)');
  assert.equal(attack.count, '2 ');
  assert.equal(attack.attackCount, 2);
  assert.equal(attack.name, 'claws');
  assert.equal(attack.bonus, 4);
  assert.equal(attack.detail, ' (1d8)');
  assert.equal(monsterAttackSequence([attack], attack).length, 2);
  assert.equal(parseMonsterAttack('bite (near) -1 (2)').attackCount, 1);
  assert.equal(parseMonsterAttack(''), null);
  assert.equal(parseMonsterAttack('description only'), null);
});

test('and combines counted strikes while or keeps alternative routines separate', () => {
  const attacks = monsterAttackSegments('2 claws +4 (1d8) and 1 bite +4 (1d10) or 3 bow (near) +2 (1d6)')
    .map(({ segment, routineIndex }) => ({ ...parseMonsterAttack(segment), routineIndex }));
  assert.deepEqual(monsterAttackSequence(attacks, attacks[0]).map(attack => attack.name), ['claws', 'claws', 'bite']);
  assert.deepEqual(monsterAttackSequence(attacks, attacks[2]).map(attack => attack.name), ['bow', 'bow', 'bow']);
});

test('malformed extreme counts remain bounded', () => {
  const attack = parseMonsterAttack('999999999999999999999 claws +4 (1d8)');
  assert.equal(monsterAttackSequence([attack], attack).length, 100);
});
