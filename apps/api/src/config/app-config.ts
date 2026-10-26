import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from '@sanad/shared';
import { DEFAULT_SECRETS_FILE, resolveSecrets, Secrets } from './secrets';

export interface AppConfig {
  nodeEnv: string;
  port: number;
  publicUrl: string;
  databaseUrl: string;
  redisUrl: string;
  secretsFile: string;
  adminInitialPasswordFile: string;
  secrets: Secrets;
  jwt: { accessTtlSeconds: number; refreshTtlDays: number };
  cookies: { secure: boolean };
  smtp: { host: string; port: number; secure: boolean; user?: string; password?: string; from: string };
  sms: { enabled: boolean; provider: string };
  cvAnalysis: { enabled: boolean; model: string; apiKeyPresent: boolean };
  s3: { endpoint: string; bucket: string; accessKey: string; secretKey: string; region: string };
  throttle: { enabled: boolean };
  logLevel: string;
}

export class ConfigValidationError extends Error {}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function int(name: string, value: string | undefined, fallback: number, errors: string[]): number {
  if (value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    errors.push(`${name} must be a positive integer (got "${value}")`);
    return fallback;
  }
  return n;
}

function url(name: string, value: string, errors: string[]): string {
  try {
    new URL(value);
  } catch {
    errors.push(`${name} must be a valid URL (got "${value}")`);
  }
  return value;
}

/**
 * Builds and validates the configuration from environment variables. Every variable is
 * documented in .env.example; all have defaults that work inside docker compose.
 */
export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  opts: { generateMissingSecrets?: boolean; secrets?: Secrets } = {},
): AppConfig {
  const errors: string[] = [];
  const databaseUrl = env.DATABASE_URL ?? '';
  if (!databaseUrl) errors.push('DATABASE_URL is required');
  const secretsFile = env.SECRETS_FILE || DEFAULT_SECRETS_FILE;
  const publicUrl = url('PUBLIC_URL', env.PUBLIC_URL || 'http://localhost:3000', errors);

  const keyErrors = (s: Secrets) => {
    for (const name of ['ID_ENCRYPTION_KEY', 'ID_HASH_KEY'] as const) {
      if (!/^[0-9a-fA-F]{64}$/.test(s[name])) errors.push(`${name} must be 64 hex characters (32 bytes)`);
    }
    for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (s[name].length < 32) errors.push(`${name} must be at least 32 characters`);
    }
  };
  const secrets =
    opts.secrets ??
    resolveSecrets(env, { file: secretsFile, generateMissing: opts.generateMissingSecrets ?? false }).secrets;
  keyErrors(secrets);

  const config: AppConfig = {
    nodeEnv: env.NODE_ENV || 'development',
    port: int('PORT', env.PORT, 4000, errors),
    publicUrl: publicUrl.replace(/\/+$/, ''),
    databaseUrl,
    redisUrl: url('REDIS_URL', env.REDIS_URL || 'redis://localhost:6379', errors),
    secretsFile,
    adminInitialPasswordFile: env.ADMIN_PASSWORD_FILE || '/app/secrets/admin-initial-password.txt',
    secrets,
    jwt: {
      accessTtlSeconds: int(
        'ACCESS_TOKEN_TTL_SECONDS',
        env.ACCESS_TOKEN_TTL_SECONDS,
        ACCESS_TOKEN_TTL_SECONDS,
        errors,
      ),
      refreshTtlDays: int(
        'REFRESH_TOKEN_TTL_DAYS',
        env.REFRESH_TOKEN_TTL_DAYS,
        REFRESH_TOKEN_TTL_DAYS,
        errors,
      ),
    },
    cookies: { secure: bool(env.COOKIE_SECURE, publicUrl.startsWith('https://')) },
    smtp: {
      host: env.SMTP_HOST || 'localhost',
      port: int('SMTP_PORT', env.SMTP_PORT, 1025, errors),
      secure: bool(env.SMTP_SECURE, false),
      user: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
      from: env.SMTP_FROM || 'Sanad <no-reply@sanad.local>',
    },
    sms: { enabled: bool(env.SMS_ENABLED, false), provider: env.SMS_PROVIDER || 'log' },
    cvAnalysis: {
      enabled: bool(env.CV_ANALYSIS_ENABLED, false),
      model: env.CV_ANALYSIS_MODEL || 'claude-opus-5-5',
      apiKeyPresent: !!env.ANTHROPIC_API_KEY,
    },
    s3: {
      endpoint: env.S3_ENDPOINT || 'http://localhost:9000',
      bucket: env.S3_BUCKET || 'cvs',
      accessKey: env.S3_ACCESS_KEY || 'sanad',
      secretKey: env.S3_SECRET_KEY || 'sanad-local-only',
      region: env.S3_REGION || 'us-east-1',
    },
    throttle: { enabled: bool(env.THROTTLE_ENABLED, true) },
    logLevel: env.LOG_LEVEL || 'log',
  };

  if (errors.length) {
    throw new ConfigValidationError(`Invalid configuration:\n - ${errors.join('\n - ')}`);
  }
  return config;
}
