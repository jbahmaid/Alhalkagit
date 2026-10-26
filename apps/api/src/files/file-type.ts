import { CV_EXTENSIONS, CV_MIME_TYPES, CvExtension } from '@sanad/shared';

const PDF = Buffer.from('%PDF-');
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/**
 * Detects a CV file type from its first bytes (never from the name or the browser's MIME type):
 *  - PDF: "%PDF-" within the first 1 KB (some generators put a few bytes before it);
 *  - DOC: OLE2 compound file signature;
 *  - DOCX: ZIP whose entries include "word/document.xml" and "[Content_Types].xml".
 * Returns null for anything else (images, executables, other ZIPs, other Office files).
 */
export function detectCvType(buf: Buffer): CvExtension | null {
  if (buf.length < 8) return null;
  const head = buf.subarray(0, 1024);
  if (head.indexOf(PDF) !== -1 && head.indexOf(PDF) < 1024) return 'pdf';
  if (buf.subarray(0, 8).equals(OLE)) return 'doc';
  if (buf.subarray(0, 4).equals(ZIP)) {
    // ZIP entry names are stored as plain bytes in local and central directory headers.
    if (buf.includes('word/document.xml') && buf.includes('[Content_Types].xml')) return 'docx';
  }
  return null;
}

export function extensionOf(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** The detected type must be allowed, and the file name must carry an allowed extension. */
export function checkCvFile(name: string, buf: Buffer): { ok: true; ext: CvExtension; mime: string } | { ok: false } {
  const ext = extensionOf(name);
  if (!(CV_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false };
  const detected = detectCvType(buf);
  if (!detected) return { ok: false };
  // A .doc name holding DOCX bytes (or the reverse) is common and harmless: trust the bytes.
  if ((ext === 'pdf') !== (detected === 'pdf')) return { ok: false };
  return { ok: true, ext: detected, mime: CV_MIME_TYPES[detected] };
}

/** Keeps a display-safe base name: no path, no control characters, at most 255 characters. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f"]/g, '').trim();
  return (clean || 'file').slice(-255);
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name (RFC 6266 / 5987). */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/[\\"]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
