import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AppException } from '../common/app-exception';
import { ALLOW_PENDING_PASSWORD_CHANGE, IS_PUBLIC, REQUIRED_PERMISSIONS } from '../common/decorators';
import { CryptoService } from '../crypto/crypto.service';
import { createFakePrisma, testConfig } from '../testing/fake-prisma';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { PermissionsService } from './permissions.service';
import { TokenService } from './token.service';

function ctxFor(req: any, meta: Record<string, unknown> = {}): ExecutionContext {
  const handler = () => undefined;
  for (const [k, v] of Object.entries(meta)) Reflect.defineMetadata(k, v, handler);
  return {
    getHandler: () => handler,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'OK';
  } catch (e) {
    return (e as AppException).code;
  }
}

describe('JwtAuthGuard', () => {
  const config = testConfig();
  const prisma = createFakePrisma();
  const tokens = new TokenService(config, new JwtService({}), prisma as any, new CryptoService(config));
  const cls = { set: jest.fn() };
  const guard = new JwtAuthGuard(new Reflector(), tokens, prisma as any, cls as any);

  beforeAll(async () => {
    await prisma.db.user.create({ data: { id: 'u1', email: 'a@b.c', role: 'SEEKER', status: 'ACTIVE' } });
    await prisma.db.user.create({
      data: { id: 'admin', email: 'x@y.z', role: 'SUPER_ADMIN', status: 'ACTIVE', mustChangePassword: true },
    });
    await prisma.db.user.create({ data: { id: 'sus', email: 's@b.c', role: 'SEEKER', status: 'SUSPENDED' } });
  });
  const bearer = (id: string, role: any) => ({
    headers: { authorization: `Bearer ${tokens.signAccess(id, role)}` },
  });

  it('lets public routes through without a token', async () => {
    expect(await code(guard.canActivate(ctxFor({ headers: {} }, { [IS_PUBLIC]: true })))).toBe('OK');
  });

  it('requires a valid bearer token', async () => {
    expect(await code(guard.canActivate(ctxFor({ headers: {} })))).toBe('UNAUTHENTICATED');
    expect(await code(guard.canActivate(ctxFor({ headers: { authorization: 'Bearer nope' } })))).toBe(
      'AUTH_TOKEN_INVALID',
    );
    const req: any = bearer('u1', 'SEEKER');
    expect(await code(guard.canActivate(ctxFor(req)))).toBe('OK');
    expect(req.user).toEqual({ id: 'u1', role: 'SEEKER', mustChangePassword: false });
    expect(cls.set).toHaveBeenCalledWith('userId', 'u1');
  });

  it('reports expired tokens distinctly', async () => {
    const expired = new TokenService(
      { ...config, jwt: { ...config.jwt, accessTtlSeconds: -10 } },
      new JwtService({}),
      prisma as any,
      new CryptoService(config),
    ).signAccess('u1', 'SEEKER');
    expect(await code(guard.canActivate(ctxFor({ headers: { authorization: `Bearer ${expired}` } })))).toBe(
      'AUTH_TOKEN_EXPIRED',
    );
  });

  it('refuses suspended accounts even with a valid token', async () => {
    expect(await code(guard.canActivate(ctxFor(bearer('sus', 'SEEKER'))))).toBe('AUTH_ACCOUNT_SUSPENDED');
  });

  it('blocks everything except allowed routes until the password is changed', async () => {
    expect(await code(guard.canActivate(ctxFor(bearer('admin', 'SUPER_ADMIN'))))).toBe(
      'PASSWORD_CHANGE_REQUIRED',
    );
    expect(
      await code(
        guard.canActivate(ctxFor(bearer('admin', 'SUPER_ADMIN'), { [ALLOW_PENDING_PASSWORD_CHANGE]: true })),
      ),
    ).toBe('OK');
  });
});

describe('PermissionsGuard', () => {
  const prisma = createFakePrisma();
  const service = new PermissionsService(prisma as any);
  const guard = new PermissionsGuard(new Reflector(), service);

  beforeAll(async () => {
    const perm = (code: string) => prisma.db.permission.create({ data: { id: code, code } });
    await perm('users.manage');
    await perm('audit.read');
    await perm('profile.self.read');
    const grant = (role: string, code: string) =>
      prisma.db.rolePermission.create({ data: { role, permissionId: code, permission: { code } } });
    await grant('ADMIN', 'users.manage');
    await grant('ADMIN', 'audit.read');
    await grant('SEEKER', 'profile.self.read');
    // admin "a2" has users.manage revoked; seeker "s2" was granted audit.read
    await prisma.db.userPermission.create({
      data: { userId: 'a2', granted: false, permission: { code: 'users.manage' } },
    });
    await prisma.db.userPermission.create({
      data: { userId: 's2', granted: true, permission: { code: 'audit.read' } },
    });
  });

  const run = (user: any, required?: string[]) =>
    code(guard.canActivate(ctxFor({ user }, required ? { [REQUIRED_PERMISSIONS]: required } : {})));

  it('allows routes without requirements', async () => {
    expect(await run({ id: 's1', role: 'SEEKER' })).toBe('OK');
  });

  it('applies role defaults', async () => {
    expect(await run({ id: 'a1', role: 'ADMIN' }, ['users.manage'])).toBe('OK');
    expect(await run({ id: 's1', role: 'SEEKER' }, ['users.manage'])).toBe('PERMISSION_DENIED');
  });

  it('applies per-user grants and revocations', async () => {
    expect(await run({ id: 'a2', role: 'ADMIN' }, ['users.manage'])).toBe('PERMISSION_DENIED');
    expect(await run({ id: 'a2', role: 'ADMIN' }, ['audit.read'])).toBe('OK');
    expect(await run({ id: 's2', role: 'SEEKER' }, ['audit.read'])).toBe('OK');
  });

  it('requires every listed permission', async () => {
    expect(await run({ id: 's2', role: 'SEEKER' }, ['audit.read', 'users.manage'])).toBe('PERMISSION_DENIED');
  });

  it('gives SUPER_ADMIN everything', async () => {
    expect(await run({ id: 'root', role: 'SUPER_ADMIN' }, ['records.hard_delete', 'anything.else'])).toBe(
      'OK',
    );
    expect((await service.effective('root', 'SUPER_ADMIN' as any)).size).toBe(3);
  });
});
