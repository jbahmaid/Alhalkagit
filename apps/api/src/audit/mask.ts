/**
 * Values never written to audit_log in clear (docs/database.md section 4.5).
 * Keys are Prisma field names (camelCase).
 */
export const SENSITIVE_FIELDS = new Set([
  'passwordHash',
  'idNumberEncrypted',
  'idNumberHash',
  'tokenHash',
  'codeHash',
  // never stored, but masked defensively if a caller passes them in audit `after` payloads
  'password',
  'currentPassword',
  'newPassword',
  'code',
  'token',
  'accessToken',
  'refreshToken',
  'idNumber',
]);

export const REDACTED = '[REDACTED]';

/** Deep copy that is JSON-safe (Dates as ISO strings, BigInt/Decimal as strings) with secrets masked. */
export function maskForAudit(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > 6) return '[DEPTH]';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return `[BINARY ${value.length} bytes]`;
  if (Array.isArray(value)) return value.map((v) => maskForAudit(v, depth + 1));
  if (typeof value === 'object') {
    // Prisma.Decimal and similar
    if (typeof (value as { toFixed?: unknown }).toFixed === 'function' && 'd' in (value as object)) {
      return String(value);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] =
        SENSITIVE_FIELDS.has(k) && v !== null && v !== undefined ? REDACTED : maskForAudit(v, depth + 1);
    }
    return out;
  }
  return value;
}
