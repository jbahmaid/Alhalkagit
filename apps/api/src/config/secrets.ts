import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Secrets that must exist for the platform to run. When an environment variable is not set,
 * the API generates a strong random value on first boot and stores it in a JSON file on a
 * persisted Docker volume (default /app/secrets/keys.json), so restarts keep the same keys.
 * The worker mounts the same volume read-only and only reads the file.
 */
export const SECRET_NAMES = [
  'ID_ENCRYPTION_KEY',
  'ID_HASH_KEY',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
] as const;
export type SecretName = (typeof SECRET_NAMES)[number];
export type Secrets = Record<SecretName, string>;

export const DEFAULT_SECRETS_FILE = '/app/secrets/keys.json';

function generate(): string {
  // 32 random bytes, hex encoded (64 chars). Valid as an AES-256 key and as an HMAC/JWT secret.
  return randomBytes(32).toString('hex');
}

function readFile(file: string): Partial<Secrets> {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Partial<Secrets>;
  } catch (err) {
    throw new Error(`Secrets file ${file} is not valid JSON: ${(err as Error).message}`);
  }
}

/**
 * Returns all secrets, taking env values first, then the file. With `generateMissing`
 * (API only), missing values are generated and written back to the file atomically.
 */
export function resolveSecrets(
  env: NodeJS.ProcessEnv,
  opts: { file?: string; generateMissing: boolean },
): { secrets: Secrets; generated: SecretName[] } {
  const file = opts.file || DEFAULT_SECRETS_FILE;
  const stored = readFile(file);
  const generated: SecretName[] = [];
  const result = {} as Secrets;
  for (const name of SECRET_NAMES) {
    const fromEnv = env[name]?.trim();
    if (fromEnv) {
      result[name] = fromEnv;
    } else if (stored[name]) {
      result[name] = stored[name] as string;
    } else if (opts.generateMissing) {
      stored[name] = generate();
      result[name] = stored[name] as string;
      generated.push(name);
    } else {
      throw new Error(
        `Secret ${name} is not set and ${file} does not contain it yet. ` +
          'The API creates it on first boot; start the api service first.',
      );
    }
  }
  if (generated.length) {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(stored, null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  }
  return { secrets: result, generated };
}
