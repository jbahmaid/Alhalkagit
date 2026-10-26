import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import { CV_MIME_TYPES } from '@sanad/shared';

/** The file cannot be turned into text (legacy .doc, scanned PDF, empty document...). */
export class CvTextError extends Error {
  constructor(public readonly code: 'DOC_UNSUPPORTED' | 'NO_TEXT' | 'TEXT_TOO_LONG' | 'UNREADABLE') {
    super(code);
  }
}

/** Below this many characters there is nothing worth analysing (e.g. a scanned image PDF). */
export const MIN_CV_CHARS = 80;
/** A CV longer than this is almost certainly not a CV; refuse rather than truncate silently. */
export const MAX_CV_CHARS = 120_000;

function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extracts plain text: pdf-parse for PDF, mammoth for DOCX. Legacy binary .doc is marked
 * unsupported (no reliable pure-JS extractor); the seeker can upload PDF or DOCX instead.
 */
export async function extractCvText(buffer: Buffer, mimeType: string): Promise<string> {
  let text: string;
  try {
    if (mimeType === CV_MIME_TYPES.pdf) {
      const parser = new PDFParse({ data: buffer });
      try {
        text = (await parser.getText()).text;
      } finally {
        await parser.destroy().catch(() => undefined);
      }
    } else if (mimeType === CV_MIME_TYPES.docx) {
      text = (await mammoth.extractRawText({ buffer })).value;
    } else {
      throw new CvTextError('DOC_UNSUPPORTED');
    }
  } catch (err) {
    if (err instanceof CvTextError) throw err;
    throw new CvTextError('UNREADABLE');
  }
  const clean = tidy(text);
  if (clean.length < MIN_CV_CHARS) throw new CvTextError('NO_TEXT');
  if (clean.length > MAX_CV_CHARS) throw new CvTextError('TEXT_TOO_LONG');
  return clean;
}
