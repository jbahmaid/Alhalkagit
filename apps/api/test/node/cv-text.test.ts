/**
 * Real text extraction (pdf-parse / mammoth). Runs with Node's test runner instead of Jest,
 * because pdf.js loads its worker with an ESM dynamic import:
 *   node --import tsx --test test/node/cv-text.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CvTextError, extractCvText } from '../../src/cv-analysis/cv-text';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { makePdf, SAMPLE_CV } = require('../../../../e2e/lib/pdf.cjs');

const PDF = 'application/pdf';

test('extracts the text of a PDF CV', async () => {
  const text = await extractCvText(makePdf(SAMPLE_CV), PDF);
  assert.match(text, /Skills: SQL, Power BI, Excel/);
  assert.match(text, /King Saud University/);
});

test('rejects legacy .doc, near-empty and broken files with a clear code', async () => {
  const code = async (p: Promise<unknown>) => {
    try {
      await p;
      return 'OK';
    } catch (e) {
      assert.ok(e instanceof CvTextError);
      return e.code;
    }
  };
  assert.equal(await code(extractCvText(Buffer.from('x'), 'application/msword')), 'DOC_UNSUPPORTED');
  assert.equal(await code(extractCvText(makePdf(['hi']), PDF)), 'NO_TEXT');
  assert.equal(await code(extractCvText(Buffer.from('%PDF-broken'), PDF)), 'UNREADABLE');
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  assert.equal(await code(extractCvText(Buffer.from('PK\u0003\u0004 not really'), docx)), 'UNREADABLE');
});
