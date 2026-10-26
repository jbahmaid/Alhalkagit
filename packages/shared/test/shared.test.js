const test = require('node:test');
const assert = require('node:assert');
const { checkPassword, matchLabel, isLocale } = require('../dist');

test('password policy', () => {
  assert.equal(checkPassword('short1'), 'TOO_SHORT');
  assert.equal(checkPassword('onlyletters'), 'NEEDS_LETTER_AND_DIGIT');
  assert.equal(checkPassword('12345678'), 'NEEDS_LETTER_AND_DIGIT');
  assert.equal(checkPassword('abcdefg1'), null);
  assert.equal(checkPassword('كلمةسر١٢٣٤'), null);
  assert.equal(checkPassword('a1'.repeat(65)), 'TOO_LONG');
});

test('match labels', () => {
  assert.equal(matchLabel(70), 'SUITABLE');
  assert.equal(matchLabel(69), 'NEAR');
  assert.equal(matchLabel(45), 'NEAR');
  assert.equal(matchLabel(44), 'NONE');
});

test('locales', () => {
  assert.ok(isLocale('ar'));
  assert.ok(!isLocale('fr'));
});
