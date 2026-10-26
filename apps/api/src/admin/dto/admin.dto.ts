import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  AUDIT_ACTIONS,
  EXPORT_KINDS,
  LOOKUP_LIMITS,
  PASSWORD_MAX_LENGTH,
  USER_ROLES,
  USER_STATUSES,
  type AuditAction,
  type ExportKind,
  type UserRole,
  type UserStatus,
} from '@sanad/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upperTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;
const toBool = ({ value }: { value: unknown }) =>
  value === true || value === 'true' ? true : value === false || value === 'false' ? false : value;

/** Codes: Latin capitals, digits and underscores (countries: ISO alpha-2, checked in the service). */
export const LOOKUP_CODE = /^[A-Z0-9_]+$/;

/** S-19 add an item. */
export class LookupCreateDto {
  @Transform(upperTrim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOOKUP_LIMITS.codeMax)
  @Matches(LOOKUP_CODE)
  code!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(LOOKUP_LIMITS.nameMax) nameAr!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(LOOKUP_LIMITS.nameMax) nameEn!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) sortOrder?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  /** education-levels: required, unique */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) rank?: number;
  /** fakhdhs: optional link to a dar */
  @IsOptional() @Transform(emptyToNull) @IsUUID() darId?: string | null;
}

/** S-19 edit (any subset) or activate / deactivate. */
export class LookupUpdateDto {
  @IsOptional()
  @Transform(upperTrim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(LOOKUP_LIMITS.codeMax)
  @Matches(LOOKUP_CODE)
  code?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(LOOKUP_LIMITS.nameMax) nameAr?: string;
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(LOOKUP_LIMITS.nameMax) nameEn?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) sortOrder?: number;
  @IsOptional() @Transform(toBool) @IsBoolean() isActive?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) rank?: number;
  @IsOptional() @Transform(emptyToNull) @IsUUID() darId?: string | null;
}

/** S-20 list filters (also used by the users export). */
export class UserFiltersDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsIn(USER_ROLES) role?: UserRole;
  @IsOptional() @Transform(emptyToUndefined) @IsIn(USER_STATUSES) status?: UserStatus;
}

export class UserListQueryDto extends UserFiltersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

/** S-21 filters (also used by the audit export). */
export class AuditFiltersDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) user?: string;
  @IsOptional() @Transform(emptyToUndefined) @IsIn(AUDIT_ACTIONS) action?: AuditAction;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(64) entity?: string;
  @IsOptional() @Transform(emptyToUndefined) @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Transform(emptyToUndefined) @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class AuditQueryDto extends AuditFiltersDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

/** Super admin creates an admin (FR-2.4.1). The temporary password is emailed. */
export class CreateAdminDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() || null : value,
  )
  @IsString()
  @Matches(/^[a-z0-9._-]{3,64}$/)
  username?: string | null;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @IsIn(['ADMIN', 'SUPER_ADMIN']) role!: 'ADMIN' | 'SUPER_ADMIN';
}

export class ChangeRoleDto {
  @IsIn(['ADMIN', 'SUPER_ADMIN']) role!: 'ADMIN' | 'SUPER_ADMIN';
}

/** Email change of another account by an admin: the acting admin re-enters their password. */
export class AdminChangeEmailDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @IsString() @IsNotEmpty() @MaxLength(PASSWORD_MAX_LENGTH) currentPassword!: string;
}

/** Admin edits an employer's data (employers.update). */
export class AdminEmployerUpdateDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) contactName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) organizationName!: string;
  @IsUUID() sectorId!: string;
  @IsUUID() businessTypeId!: string;
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(30) phone!: string;
}

class WeightsDto {
  @Type(() => Number) @IsInt() @Min(0) @Max(100) sector!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) education!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) experience!: number;
  @Type(() => Number) @IsInt() @Min(0) @Max(100) keywords!: number;
}
class ThresholdsDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100) suitable!: number;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) near!: number;
}
export class MatchingSettingsInputDto {
  @ValidateNested() @Type(() => WeightsDto) weights!: WeightsDto;
  @ValidateNested() @Type(() => ThresholdsDto) thresholds!: ThresholdsDto;
}

/** Re-enter the password to get a short-lived export token (architecture section 8). */
export class ExportTokenRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(PASSWORD_MAX_LENGTH) password!: string;
}

export class ExportRequestDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) token!: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
  @IsOptional() @ValidateNested() @Type(() => UserFiltersDto) users?: UserFiltersDto;
  @IsOptional() @ValidateNested() @Type(() => AuditFiltersDto) audit?: AuditFiltersDto;
}

export const isExportKind = (k: string): k is ExportKind => (EXPORT_KINDS as readonly string[]).includes(k);
