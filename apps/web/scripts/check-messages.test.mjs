// Every visible string lives in messages/{ar,en}.json: both files must have the same keys,
// every API error code must be translated, and tokens.css must match docs/design/tokens.json.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const load = (f) => JSON.parse(readFileSync(join(here, '..', f), 'utf8'));
const ar = load('messages/ar.json');
const en = load('messages/en.json');

function keys(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

test('ar and en have exactly the same keys', () => {
  assert.deepEqual(keys(ar).sort(), keys(en).sort());
});

test('no empty strings', () => {
  for (const [name, dict] of [
    ['ar', ar],
    ['en', en],
  ]) {
    for (const k of keys(dict)) {
      const v = k.split('.').reduce((o, p) => o[p], dict);
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${name}:${k} is empty`);
    }
  }
});

test('every shared API error code has a translation', () => {
  const require = createRequire(import.meta.url);
  const { ERROR_CODES } = require('@sanad/shared');
  for (const code of ERROR_CODES) {
    assert.ok(ar.errors[code], `ar errors.${code} missing`);
    assert.ok(en.errors[code], `en errors.${code} missing`);
  }
});

test('tokens.css is in sync with docs/design/tokens.json', () => {
  const tokens = JSON.parse(readFileSync(join(here, '../../../docs/design/tokens.json'), 'utf8'));
  const css = readFileSync(join(here, '../src/styles/tokens.css'), 'utf8');
  for (const [k, v] of Object.entries(tokens.color.light)) {
    assert.ok(css.includes(`--color-${k}: ${v};`), `light ${k}`);
  }
  for (const [k, v] of Object.entries(tokens.color.dark)) {
    assert.ok(css.includes(`--color-${k}: ${v};`), `dark ${k}`);
  }
});
