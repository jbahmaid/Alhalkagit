import { CryptoService } from '../crypto/crypto.service';
import { testConfig } from '../testing/fake-prisma';
import { checkCvFile, contentDisposition, detectCvType, safeFileName } from './file-type';
import { FileLinksService } from './file-links.service';

const pdf = Buffer.from('%PDF-1.7\n1 0 obj << >> endobj\n%%EOF');
const doc = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);
const docx = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('....[Content_Types].xml....word/document.xml....'),
]);
const otherZip = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('xl/workbook.xml [Content_Types].xml'),
]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const exe = Buffer.from('MZ\x90\x00 this program cannot be run in DOS mode');

describe('CV type check (magic bytes)', () => {
  it('detects PDF, DOC and DOCX by content', () => {
    expect(detectCvType(pdf)).toBe('pdf');
    expect(detectCvType(Buffer.concat([Buffer.from('\n\n'), pdf]))).toBe('pdf');
    expect(detectCvType(doc)).toBe('doc');
    expect(detectCvType(docx)).toBe('docx');
  });

  it('rejects other files whatever their name says', () => {
    expect(detectCvType(otherZip)).toBeNull();
    expect(detectCvType(png)).toBeNull();
    expect(detectCvType(exe)).toBeNull();
    expect(detectCvType(Buffer.alloc(3))).toBeNull();
    expect(checkCvFile('cv.pdf', exe)).toEqual({ ok: false });
    expect(checkCvFile('cv.pdf', png)).toEqual({ ok: false });
  });

  it('needs an allowed extension, and PDF names must hold PDF bytes', () => {
    expect(checkCvFile('cv.PDF', pdf)).toEqual({ ok: true, ext: 'pdf', mime: 'application/pdf' });
    expect(checkCvFile('cv.exe', pdf)).toEqual({ ok: false });
    expect(checkCvFile('cv', pdf)).toEqual({ ok: false });
    expect(checkCvFile('cv.pdf', docx)).toEqual({ ok: false });
    // .doc / .docx confusion is harmless: the bytes decide
    expect(checkCvFile('cv.doc', docx)).toMatchObject({ ok: true, ext: 'docx' });
  });

  it('cleans file names and builds a safe Content-Disposition', () => {
    expect(safeFileName('C:\\Users\\me\\سيرتي.pdf')).toBe('سيرتي.pdf');
    expect(safeFileName('../../etc/"x"\u0007.pdf')).toBe('x.pdf');
    expect(contentDisposition('سيرة "1".pdf')).toBe(
      `attachment; filename="____ _1_.pdf"; filename*=UTF-8''${encodeURIComponent('سيرة "1".pdf')}`,
    );
  });
});

describe('signed file links', () => {
  const links = new FileLinksService(new CryptoService(testConfig()));

  it('issues a same-origin link valid for 5 minutes', () => {
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const link = links.issue('file-1', 'user-1', now);
    expect(link.url).toMatch(/^\/api\/files\/[\w-]+\.[\w-]+$/);
    expect(link.expiresAt).toBe('2026-01-01T12:05:00.000Z');
    const token = link.url.split('/').pop()!;
    expect(links.verify(token, now + 299_000)).toEqual({ fileId: 'file-1', userId: 'user-1' });
    expect(() => links.verify(token, now + 301_000)).toThrow(
      expect.objectContaining({ code: 'FILE_LINK_EXPIRED' }),
    );
  });

  it('rejects tampered or foreign tokens', () => {
    const token = links.issue('file-1', 'user-1').url.split('/').pop()!;
    const [body, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ f: 'file-2', u: 'user-1', e: 9e9 })).toString('base64url');
    for (const bad of [`${forged}.${mac}`, `${body}.${mac}x`, body, `${token}.x`, '']) {
      expect(() => links.verify(bad)).toThrow(expect.objectContaining({ code: 'FILE_LINK_INVALID' }));
    }
    const other = new FileLinksService(
      new CryptoService({ secrets: { ...testConfig().secrets, ID_HASH_KEY: 'e'.repeat(64) } }),
    );
    expect(() => other.verify(token)).toThrow(expect.objectContaining({ code: 'FILE_LINK_INVALID' }));
  });
});
