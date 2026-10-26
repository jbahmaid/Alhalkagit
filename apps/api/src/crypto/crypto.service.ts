import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';

const IV_BYTES = 12;
const TAG_BYTES = 16;

export type IdType = 'NATIONAL_ID' | 'PASSPORT';

/**
 * ID number protection (docs/database.md section 4):
 *  - normalise: drop spaces/dashes, Arabic-Indic and Persian digits to Latin, upper case;
 *  - encrypt: AES-256-GCM, random 12-byte IV, stored as base64(iv | authTag | ciphertext);
 *  - fingerprint: HMAC-SHA256(ID_HASH_KEY, idType + ":" + normalised), hex, for duplicate checks.
 * Also small helpers for one-time codes and opaque tokens.
 */
@Injectable()
export class CryptoService {
  private readonly encKey: Buffer;
  private readonly hashKey: Buffer;
  readonly keyVersion = 1;

  constructor(@Inject(APP_CONFIG) config: Pick<AppConfig, 'secrets'>) {
    this.encKey = Buffer.from(config.secrets.ID_ENCRYPTION_KEY, 'hex');
    this.hashKey = Buffer.from(config.secrets.ID_HASH_KEY, 'hex');
    if (this.encKey.length !== 32) throw new Error('ID_ENCRYPTION_KEY must be 32 bytes (64 hex chars)');
    if (this.hashKey.length !== 32) throw new Error('ID_HASH_KEY must be 32 bytes (64 hex chars)');
  }

  static normalizeIdNumber(raw: string): string {
    return raw
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[\s\-_.‏‎]/g, '')
      .toUpperCase();
  }

  encrypt(plain: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length < IV_BYTES + TAG_BYTES) throw new Error('Ciphertext too short');
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ct = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  hashIdNumber(idType: IdType, raw: string): string {
    const normalized = CryptoService.normalizeIdNumber(raw);
    return createHmac('sha256', this.hashKey).update(`${idType}:${normalized}`).digest('hex');
  }

  /** Normalise, encrypt and fingerprint in one go, ready for the persons table. */
  protectIdNumber(idType: IdType, raw: string) {
    const normalized = CryptoService.normalizeIdNumber(raw);
    return {
      idNumberEncrypted: this.encrypt(normalized),
      idNumberHash: this.hashIdNumber(idType, normalized),
      idNumberKeyVersion: this.keyVersion,
    };
  }

  /** 6-digit numeric code, uniformly random. */
  generateOtp(length = 6): string {
    return String(randomInt(0, 10 ** length)).padStart(length, '0');
  }

  /** Keyed hash for one-time codes, bound to the code record id. */
  hashOtp(recordId: string, code: string): string {
    return createHmac('sha256', this.hashKey).update(`otp:${recordId}:${code}`).digest('hex');
  }

  /** Opaque random token (refresh tokens), base64url. */
  generateToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  /**
   * Compact signed token `<payload>.<mac>` (both base64url) for short-lived links such as CV
   * downloads. The MAC is HMAC-SHA256 with the server key, domain-separated by `purpose`.
   */
  signToken(purpose: string, payload: Record<string, unknown>): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${body}.${this.mac(purpose, body)}`;
  }

  /** Returns the payload when the MAC is valid, otherwise null. Expiry is checked by the caller. */
  verifyToken<T = Record<string, unknown>>(purpose: string, token: string): T | null {
    const [body, mac, extra] = token.split('.');
    if (!body || !mac || extra !== undefined) return null;
    const expected = this.mac(purpose, body);
    const a = Buffer.from(mac);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    } catch {
      return null;
    }
  }

  private mac(purpose: string, body: string): string {
    return createHmac('sha256', this.hashKey).update(`token:${purpose}:${body}`).digest('base64url');
  }

  sha256(value: string | Buffer): string {
    return createHash('sha256').update(value).digest('hex');
  }

  safeEqualHex(a: string, b: string): boolean {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    return ba.length === bb.length && timingSafeEqual(ba, bb);
  }
}
