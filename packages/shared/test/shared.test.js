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

const {
  normalizeSaudiMobile,
  localSaudiMobile,
  ageFrom,
  isNationalIdFormat,
  normalizePhone,
  toLatinDigits,
} = require('../dist');

test('saudi mobile numbers', () => {
  for (const v of [
    '0512345678',
    '512345678',
    '+966512345678',
    '00966512345678',
    '966 51 234 5678',
    '٠٥١٢٣٤٥٦٧٨',
  ]) {
    assert.equal(normalizeSaudiMobile(v), '+966512345678', v);
  }
  for (const v of ['0412345678', '05123', '+971501234567', '', null, '05123456789']) {
    assert.equal(normalizeSaudiMobile(v), null, String(v));
  }
  assert.equal(localSaudiMobile('+966512345678'), '0512345678');
});

test('age, ids and phones', () => {
  const today = new Date(Date.UTC(2026, 9, 26));
  assert.equal(ageFrom('2000-10-26', today), 26);
  assert.equal(ageFrom('2000-10-27', today), 25);
  assert.equal(ageFrom('nope', today), null);
  assert.ok(isNationalIdFormat('1012345678'));
  assert.ok(isNationalIdFormat('2012345678'));
  assert.ok(!isNationalIdFormat('3012345678'));
  assert.equal(normalizePhone('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizePhone('12'), null);
  assert.equal(toLatinDigits('١٢٣'), '123');
});
