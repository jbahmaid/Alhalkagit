import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Errors } from '../common/app-exception';
import { AuthUser, REQUIRED_PERMISSIONS } from '../common/decorators';
import { PermissionsService } from './permissions.service';

/** Global guard that enforces @RequirePermissions(...) using the DB-backed permission matrix. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndMerge<string[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;
    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user) throw Errors.unauthenticated();
    if (await this.permissions.has(user.id, user.role, required)) return true;
    throw Errors.forbidden('PERMISSION_DENIED', { required });
  }
}
