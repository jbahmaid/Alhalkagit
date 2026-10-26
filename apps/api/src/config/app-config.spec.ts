import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './app-config';
import { resolveSecrets } from './secrets';

describe('secrets and config', () => {
  it('generates missing secrets once and reuses them', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sanad-')), 'keys.json');
    const first = resolveSecrets({}, { file, generateMissing: true });
    expect(first.generated).toHaveLength(4);
    expect(first.secrets.ID_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    const second = resolveSecrets({}, { file, generateMissing: true });
    expect(second.generated).toHaveLength(0);
    expect(second.secrets).toEqual(first.secrets);
    expect(JSON.parse(readFileSync(file, 'utf8')).JWT_ACCESS_SECRET).toBe(first.secrets.JWT_ACCESS_SECRET);
  });

  it('prefers environment values and does not generate in read-only mode', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sanad-')), 'keys.json');
    expect(() => resolveSecrets({}, { file, generateMissing: false })).toThrow(/not set/);
    const env = {
      ID_ENCRYPTION_KEY: '1'.repeat(64),
      ID_HASH_KEY: '2'.repeat(64),
      JWT_ACCESS_SECRET: 'x'.repeat(40),
      JWT_REFRESH_SECRET: 'y'.repeat(40),
    };
    expect(resolveSecrets(env, { file, generateMissing: false }).secrets.ID_HASH_KEY).toBe('2'.repeat(64));
  });

  it('validates values', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sanad-')), 'keys.json');
    expect(() => loadConfig({ SECRETS_FILE: file }, { generateMissingSecrets: true })).toThrow(
      /DATABASE_URL/,
    );
    expect(() =>
      loadConfig(
        { DATABASE_URL: 'postgresql://a@b/c', SECRETS_FILE: file, PORT: 'abc' },
        { generateMissingSecrets: true },
      ),
    ).toThrow(/PORT/);
    const cfg = loadConfig(
      { DATABASE_URL: 'postgresql://a@b/c', SECRETS_FILE: file },
      { generateMissingSecrets: true },
    );
    expect(cfg.sms.enabled).toBe(false);
    expect(cfg.cvAnalysis.enabled).toBe(false);
    expect(cfg.cookies.secure).toBe(false);
    expect(cfg.throttle).toEqual({ enabled: true, factor: 1 });
    const base = { DATABASE_URL: 'postgresql://a@b/c', SECRETS_FILE: file };
    expect(
      loadConfig({ ...base, THROTTLE_FACTOR: '10' }, { generateMissingSecrets: true }).throttle.factor,
    ).toBe(10);
    expect(
      loadConfig({ ...base, THROTTLE_FACTOR: '500' }, { generateMissingSecrets: true }).throttle.factor,
    ).toBe(100);
    expect(() => loadConfig({ ...base, THROTTLE_FACTOR: '0' }, { generateMissingSecrets: true })).toThrow(
      /THROTTLE_FACTOR/,
    );
  });
});
