import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserStatus } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import type { Request } from 'express';
import { Errors } from '../common/app-exception';
import { ALLOW_PENDING_PASSWORD_CHANGE, AuthUser, IS_PUBLIC } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { PrismaService } from '../prisma/prisma.service';
import { TokenService } from './token.service';

/**
 * Global guard. Every route needs a valid access token (Authorization: Bearer) unless it is
 * marked @Public(). The user row is re-read on each request so suspensions and forced password
 * changes take effect immediately. Until a required password change is done, only routes marked
 * @AllowPendingPasswordChange() are reachable (403 PASSWORD_CHANGE_REQUIRED otherwise).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
    private readonly cls: ClsService<RequestContext>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) throw Errors.unauthenticated();

    const payload = this.tokens.verifyAccess(token);
    const user = await this.prisma.db.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, status: true, mustChangePassword: true },
    });
    if (!user) throw Errors.unauthenticated('AUTH_TOKEN_INVALID');
    if (user.status !== UserStatus.ACTIVE) throw Errors.forbidden('AUTH_ACCOUNT_SUSPENDED');

    req.user = { id: user.id, role: user.role, mustChangePassword: user.mustChangePassword };
    this.cls.set('userId', user.id);
    this.cls.set('role', user.role);

    if (
      user.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PENDING_PASSWORD_CHANGE, targets)
    ) {
      throw Errors.forbidden('PASSWORD_CHANGE_REQUIRED');
    }
    return true;
  }
}
