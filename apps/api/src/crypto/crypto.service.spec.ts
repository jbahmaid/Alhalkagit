import { CryptoService } from './crypto.service';
import { TEST_SECRETS } from '../testing/fake-prisma';

describe('CryptoService', () => {
  const crypto = new CryptoService({ secrets: TEST_SECRETS });

  it('normalises ID numbers (spaces, dashes, Arabic-Indic digits, case)', () => {
    expect(CryptoService.normalizeIdNumber(' ١٠١-٢٣٤ ٥٦٧٨ ')).toBe('1012345678');
    expect(CryptoService.normalizeIdNumber('ab-12 34')).toBe('AB1234');
    expect(CryptoService.normalizeIdNumber('۱۲۳')).toBe('123');
  });

  it('encrypts with AES-256-GCM and decrypts back', () => {
    const c1 = crypto.encrypt('1012345678');
    const c2 = crypto.encrypt('1012345678');
    expect(c1).not.toEqual(c2); // random IV
    expect(Buffer.from(c1, 'base64').length).toBe(12 + 16 + 10);
    expect(crypto.decrypt(c1)).toBe('1012345678');
  });

  it('rejects tampered ciphertext', () => {
    const buf = Buffer.from(crypto.encrypt('1012345678'), 'base64');
    buf[buf.length - 1] ^= 0xff;
    expect(() => crypto.decrypt(buf.toString('base64'))).toThrow();
  });

  it('fingerprints deterministically, per id type, over the normalised value', () => {
    const h = crypto.hashIdNumber('NATIONAL_ID', '1012345678');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.hashIdNumber('NATIONAL_ID', '١٠١٢٣٤٥٦٧٨')).toBe(h);
    expect(crypto.hashIdNumber('PASSPORT', '1012345678')).not.toBe(h);
  });

  it('depends on the hash key', () => {
    const other = new CryptoService({ secrets: { ...TEST_SECRETS, ID_HASH_KEY: 'e'.repeat(64) } });
    expect(other.hashIdNumber('NATIONAL_ID', '1')).not.toBe(crypto.hashIdNumber('NATIONAL_ID', '1'));
  });

  it('protectIdNumber returns the three persons columns', () => {
    const p = crypto.protectIdNumber('PASSPORT', 'ab 123');
    expect(crypto.decrypt(p.idNumberEncrypted)).toBe('AB123');
    expect(p.idNumberHash).toBe(crypto.hashIdNumber('PASSPORT', 'AB123'));
    expect(p.idNumberKeyVersion).toBe(1);
  });

  it('rejects keys of the wrong size', () => {
    expect(() => new CryptoService({ secrets: { ...TEST_SECRETS, ID_ENCRYPTION_KEY: 'ab' } })).toThrow();
  });

  it('generates 6-digit codes and keyed code hashes', () => {
    for (let i = 0; i < 50; i++) expect(crypto.generateOtp()).toMatch(/^\d{6}$/);
    expect(crypto.hashOtp('id1', '123456')).not.toBe(crypto.hashOtp('id2', '123456'));
    expect(crypto.safeEqualHex(crypto.hashOtp('a', '1'), crypto.hashOtp('a', '1'))).toBe(true);
  });
});
