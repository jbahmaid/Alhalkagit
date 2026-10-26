import { maskForAudit, REDACTED } from './mask';
import { assertNoNestedWrites } from '../prisma/audited-client';
import { MODEL_META } from '../prisma/model-meta';

describe('maskForAudit', () => {
  it('redacts password hashes, encrypted ids, fingerprints, token and code hashes', () => {
    const out = maskForAudit({
      id: 'u1',
      email: 'a@b.c',
      passwordHash: '$argon2id$...',
      idNumberEncrypted: 'xxx',
      idNumberHash: 'f'.repeat(64),
      tokenHash: 'abc',
      codeHash: 'def',
      nested: { password: 'secret1', ok: 1 },
    }) as Record<string, any>;
    expect(out.passwordHash).toBe(REDACTED);
    expect(out.idNumberEncrypted).toBe(REDACTED);
    expect(out.idNumberHash).toBe(REDACTED);
    expect(out.tokenHash).toBe(REDACTED);
    expect(out.codeHash).toBe(REDACTED);
    expect(out.nested).toEqual({ password: REDACTED, ok: 1 });
    expect(out.email).toBe('a@b.c');
  });

  it('keeps nulls visible and makes values JSON safe', () => {
    const d = new Date('2026-10-26T10:00:00Z');
    expect(maskForAudit({ passwordHash: null, at: d, n: BigInt(5) })).toEqual({
      passwordHash: null,
      at: '2026-10-26T10:00:00.000Z',
      n: '5',
    });
  });
});

describe('model metadata and nested-write protection', () => {
  it('knows tables, primary keys and soft-delete models from the schema', () => {
    expect(MODEL_META.User).toMatchObject({ table: 'users', pk: ['id'], softDelete: true });
    expect(MODEL_META.RolePermission).toMatchObject({
      table: 'role_permissions',
      pk: ['role', 'permissionId'],
    });
    expect(MODEL_META.Setting.pk).toEqual(['key']);
    expect(MODEL_META.RefreshToken.softDelete).toBe(false);
  });

  it('rejects nested creates (they would not be audited)', () => {
    expect(() =>
      assertNoNestedWrites(MODEL_META.User, { email: 'x', seekerProfile: { create: {} } }),
    ).toThrow(/Nested write/);
    expect(() => assertNoNestedWrites(MODEL_META.User, { files: { connect: { id: 'f1' } } })).toThrow(
      /Nested write/,
    ); // FK lives on uploaded_files, so connect would change another table
  });

  it('allows connect on a foreign key the model owns, and plain scalars', () => {
    expect(() =>
      assertNoNestedWrites(MODEL_META.SeekerProfile, {
        user: { connect: { id: 'u1' } },
        hasExperience: true,
      }),
    ).not.toThrow();
    expect(() => assertNoNestedWrites(MODEL_META.SeekerProfile, { userId: 'u1' })).not.toThrow();
  });
});
