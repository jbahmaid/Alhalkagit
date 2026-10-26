import { Inject, Injectable } from '@nestjs/common';
import { AuditAction, Prisma, User, UserRole, UserStatus } from '@prisma/client';
import {
  normalizePhone,
  PERMISSIONS,
  type AdminUserDetailDto,
  type AdminUserRowDto,
  type FieldErrorDetail,
  type Paged,
  type RevealedIdDto,
} from '@sanad/shared';
import { randomInt } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { PermissionsService } from '../auth/permissions.service';
import { TokenService } from '../auth/token.service';
import { Errors } from '../common/app-exception';
import { nameOf } from '../common/names';
import { AuthUser } from '../common/decorators';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { toAccountDto } from '../jobs/employers.service';
import { EmailQueueService } from '../notifications/email-queue.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AdminChangeEmailDto,
  AdminEmployerUpdateDto,
  CreateAdminDto,
  UserFiltersDto,
  UserListQueryDto,
} from './dto/admin.dto';

const ADMIN_ROLES: UserRole[] = [UserRole.ADMIN, UserRole.SUPER_ADMIN];
const isAdminRole = (r: UserRole) => ADMIN_ROLES.includes(r);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Policy-compliant temporary password (letters and digits, at least one of each). */
export function temporaryPassword(length = 14): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const digits = '23456789';
  const all = letters + digits;
  const chars = [letters[randomInt(letters.length)], digits[randomInt(digits.length)]];
  while (chars.length < length) chars.push(all[randomInt(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

/**
 * S-20 accounts (FR-2.4.1). Seekers and employers need `users.manage`; acting on an admin
 * account needs `admins.manage` (SUPER_ADMIN). The system account (`admin`) can never be
 * suspended, deleted or have its role changed: refused here with SYSTEM_ACCOUNT_PROTECTED before
 * the database trigger (the second layer) is reached. Its email stays editable.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly email: EmailQueueService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  // ---------------------------------------------------------------------------
  // Listing
  // ---------------------------------------------------------------------------

  where(f: UserFiltersDto): Prisma.UserWhereInput {
    const where: Prisma.UserWhereInput = {};
    if (f.role) where.role = f.role;
    if (f.status) where.status = f.status;
    const q = f.q?.trim();
    if (q) {
      const has = { contains: q, mode: 'insensitive' as const };
      where.OR = [
        { email: has },
        { username: has },
        { displayName: has },
        { person: { is: { OR: [{ firstName: has }, { fatherName: has }, { familyName: has }] } } },
        { employer: { is: { OR: [{ contactName: has }, { organizationName: has }] } } },
      ];
    }
    return where;
  }

  /** Rows for the given users with their names (separate queries: soft-delete safe). */
  async rows(users: User[]): Promise<AdminUserRowDto[]> {
    const ids = users.map((u) => u.id);
    const [people, employers] = ids.length
      ? await Promise.all([
          this.db.person.findMany({
            where: { userId: { in: ids } },
            select: {
              userId: true,
              firstName: true,
              fatherName: true,
              grandfatherName: true,
              familyName: true,
            },
          }),
          this.db.employer.findMany({
            where: { userId: { in: ids } },
            select: { userId: true, contactName: true },
          }),
        ])
      : [[], []];
    return users.map((u) => ({
      id: u.id,
      name: nameOf(
        u,
        people.find((p) => p.userId === u.id),
        employers.find((e) => e.userId === u.id),
      ),
      email: u.email,
      username: u.username,
      role: u.role,
      status: u.status,
      isSystemAccount: u.isSystemAccount,
      emailVerifiedAt: iso(u.emailVerifiedAt),
      lastLoginAt: iso(u.lastLoginAt),
      createdAt: u.createdAt.toISOString(),
    }));
  }

  async list(q: UserListQueryDto): Promise<Paged<AdminUserRowDto>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 20;
    const where = this.where(q);
    const [total, users] = await Promise.all([
      this.db.user.count({ where }),
      this.db.user.findMany({
        where,
        orderBy: [{ isSystemAccount: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: await this.rows(users), total, page, pageSize };
  }

  private async load(id: string): Promise<User> {
    const u = await this.db.user.findFirst({ where: { id } });
    if (!u) throw Errors.notFound('USER_NOT_FOUND');
    return u;
  }

  async detail(id: string): Promise<AdminUserDetailDto> {
    const u = await this.load(id);
    const [row] = await this.rows([u]);
    const employer =
      u.role === UserRole.EMPLOYER ? await this.db.employer.findFirst({ where: { userId: id } }) : null;
    const profile =
      u.role === UserRole.SEEKER ? await this.db.seekerProfile.count({ where: { userId: id } }) : 0;
    return {
      ...row,
      displayName: u.displayName,
      mustChangePassword: u.mustChangePassword,
      locale: u.locale,
      employer: employer ? { id: employer.id, ...toAccountDto(employer, u.emailVerifiedAt) } : null,
      hasSeekerProfile: profile > 0,
    };
  }

  // ---------------------------------------------------------------------------
  // Protections
  // ---------------------------------------------------------------------------

  /**
   * Common checks before changing someone else's account: not yourself, not the system account
   * (for `protectSystem` actions), and `admins.manage` when the target is an admin.
   */
  private async guard(actor: AuthUser, target: User, opts: { protectSystem: boolean }): Promise<void> {
    if (opts.protectSystem && target.isSystemAccount) throw Errors.forbidden('SYSTEM_ACCOUNT_PROTECTED');
    if (target.id === actor.id) throw Errors.forbidden('CANNOT_TARGET_SELF');
    if (isAdminRole(target.role)) {
      const ok = await this.permissions.has(actor.id, actor.role as UserRole, [PERMISSIONS.ADMINS_MANAGE]);
      if (!ok) throw Errors.forbidden('PERMISSION_DENIED');
    }
  }

  async suspend(actor: AuthUser, id: string): Promise<AdminUserRowDto> {
    const u = await this.load(id);
    await this.guard(actor, u, { protectSystem: true });
    const updated = await this.prisma.tx(async () => {
      const row = await this.db.user.update({ where: { id }, data: { status: UserStatus.SUSPENDED } });
      await this.tokens.revokeAllForUser(id, 'suspended');
      await this.audit.record(AuditAction.SUSPEND, 'users', id, { status: 'SUSPENDED' });
      return row;
    });
    return (await this.rows([updated]))[0];
  }

  async reactivate(actor: AuthUser, id: string): Promise<AdminUserRowDto> {
    const u = await this.load(id);
    await this.guard(actor, u, { protectSystem: true });
    const status = u.emailVerifiedAt ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION;
    const updated = await this.prisma.tx(async () => {
      const row = await this.db.user.update({ where: { id }, data: { status } });
      await this.audit.record(AuditAction.STATUS_CHANGE, 'users', id, { status });
      return row;
    });
    return (await this.rows([updated]))[0];
  }

  /** Soft delete (audited as DELETE by the client); sessions end. */
  async remove(actor: AuthUser, id: string): Promise<void> {
    const u = await this.load(id);
    await this.guard(actor, u, { protectSystem: true });
    await this.prisma.tx(async () => {
      await this.tokens.revokeAllForUser(id, 'deleted');
      await this.db.user.delete({ where: { id } });
    });
  }

  async changeRole(actor: AuthUser, id: string, role: 'ADMIN' | 'SUPER_ADMIN'): Promise<AdminUserRowDto> {
    const u = await this.load(id);
    await this.guard(actor, u, { protectSystem: true });
    if (!isAdminRole(u.role)) throw Errors.badRequest('NOT_AN_ADMIN');
    if (u.role === role) return (await this.rows([u]))[0];
    const updated = await this.db.user.update({ where: { id }, data: { role } });
    // Permissions come from the role on every request; existing sessions follow at once.
    return (await this.rows([updated]))[0];
  }

  /**
   * Change another account's login email. The acting admin re-enters their own password. The
   * system account's email may be changed (by another SUPER_ADMIN; admins.manage).
   */
  async changeEmail(actor: AuthUser, id: string, dto: AdminChangeEmailDto): Promise<AdminUserRowDto> {
    const u = await this.load(id);
    if (u.id === actor.id) throw Errors.forbidden('CANNOT_TARGET_SELF'); // own email: "my account"
    await this.guard(actor, u, { protectSystem: false });
    if (!(await this.confirmPassword(actor.id, dto.currentPassword)))
      throw Errors.forbidden('AUTH_WRONG_PASSWORD');
    if (dto.email === u.email) throw Errors.badRequest('EMAIL_UNCHANGED');
    await this.assertEmailFree(dto.email, u.id);
    const previous = u.email;
    const updated = await this.db.user.update({ where: { id }, data: { email: dto.email } });
    await this.email.enqueue({
      template: 'emailChanged',
      to: previous,
      locale: u.locale,
      vars: { newEmail: dto.email },
    });
    return (await this.rows([updated]))[0];
  }

  async confirmPassword(userId: string, password: string): Promise<boolean> {
    const me = await this.db.user.findFirst({ where: { id: userId }, select: { passwordHash: true } });
    return !!me && (await this.passwords.verify(me.passwordHash, password));
  }

  private async assertEmailFree(email: string, selfId?: string): Promise<void> {
    const clash = await this.db.user.findFirst({
      where: { email, deletedAt: undefined },
      select: { id: true },
    });
    if (clash && clash.id !== selfId) throw Errors.conflict('AUTH_EMAIL_TAKEN');
  }

  // ---------------------------------------------------------------------------
  // Admin accounts (SUPER_ADMIN, admins.manage)
  // ---------------------------------------------------------------------------

  async createAdmin(dto: CreateAdminDto): Promise<AdminUserRowDto> {
    await this.assertEmailFree(dto.email);
    if (dto.username) {
      const clash = await this.db.user.findFirst({ where: { username: dto.username, deletedAt: undefined } });
      if (clash) throw Errors.validation([{ field: 'username', errors: ['USERNAME_TAKEN'] }]);
    }
    const temp = temporaryPassword();
    const user = await this.db.user.create({
      data: {
        email: dto.email,
        username: dto.username ?? null,
        displayName: dto.name,
        role: dto.role,
        status: UserStatus.ACTIVE,
        emailVerifiedAt: new Date(),
        mustChangePassword: true,
        passwordHash: await this.passwords.hash(temp),
        locale: 'ar',
      },
    });
    await this.email.enqueue({
      template: 'adminInvite',
      to: user.email,
      locale: user.locale,
      vars: {
        name: dto.name,
        login: dto.username ?? dto.email,
        password: temp,
        link: `${this.config.publicUrl}/${user.locale}/login`,
      },
    });
    return (await this.rows([user]))[0];
  }

  // ---------------------------------------------------------------------------
  // Seekers and employers
  // ---------------------------------------------------------------------------

  /** The seeker's user id, or 404 if the account is not a seeker. */
  async seekerUser(id: string): Promise<User> {
    const u = await this.load(id);
    if (u.role !== UserRole.SEEKER) throw Errors.notFound('PROFILE_NOT_FOUND');
    return u;
  }

  /** Decrypted ID number (seekers.id_number.reveal), audited as VIEW_SENSITIVE. */
  async revealId(id: string): Promise<RevealedIdDto> {
    await this.seekerUser(id);
    const person = await this.db.person.findFirst({ where: { userId: id } });
    if (!person) throw Errors.notFound('PROFILE_NOT_FOUND');
    await this.audit.record(AuditAction.VIEW_SENSITIVE, 'persons', person.id, {
      field: 'idNumber',
      userId: id,
    });
    return { idType: person.idType, idNumber: this.crypto.decrypt(person.idNumberEncrypted) };
  }

  async updateEmployer(id: string, dto: AdminEmployerUpdateDto): Promise<AdminUserDetailDto> {
    const u = await this.load(id);
    const employer = await this.db.employer.findFirst({ where: { userId: id } });
    if (u.role !== UserRole.EMPLOYER || !employer) throw Errors.notFound('EMPLOYER_NOT_FOUND');
    const errors: FieldErrorDetail[] = [];
    const phone = normalizePhone(dto.phone);
    if (!phone) errors.push({ field: 'phone', errors: ['PHONE_FORMAT'] });
    // Keeping the current value is allowed even if it was deactivated since.
    const [sector, bt] = await Promise.all([
      dto.sectorId === employer.sectorId
        ? 1
        : this.db.sector.count({ where: { id: dto.sectorId, isActive: true } }),
      dto.businessTypeId === employer.businessTypeId
        ? 1
        : this.db.businessType.count({ where: { id: dto.businessTypeId, isActive: true } }),
    ]);
    if (!sector) errors.push({ field: 'sectorId', errors: ['LOOKUP_INVALID'] });
    if (!bt) errors.push({ field: 'businessTypeId', errors: ['LOOKUP_INVALID'] });
    if (errors.length) throw Errors.validation(errors);
    await this.db.employer.update({
      where: { id: employer.id },
      data: {
        contactName: dto.contactName,
        organizationName: dto.organizationName,
        sectorId: dto.sectorId,
        businessTypeId: dto.businessTypeId,
        email: dto.email,
        phone: phone!,
      },
    });
    return this.detail(id);
  }
}
