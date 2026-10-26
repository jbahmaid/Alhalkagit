import { Transform } from 'class-transformer';
import {
  Equals,
  IsEmail,
  IsNotEmpty,
  IsUUID,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { checkPassword, JOB_LIMITS, OTP_LENGTH, PASSWORD_MAX_LENGTH } from '@sanad/shared';

const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Password policy from @sanad/shared; reported as error "PASSWORD_POLICY". */
export function IsPasswordPolicy(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'PASSWORD_POLICY',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown) => typeof value === 'string' && checkPassword(value) === null,
        defaultMessage: () => 'PASSWORD_POLICY',
      },
    });
}

const OTP_PATTERN = new RegExp(`^[0-9]{${OTP_LENGTH}}$`);

export class SignupSeekerDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @IsString() @IsPasswordPolicy() password!: string;
  /** Explicit consent to share the profile with an employer upon an interest request. */
  @Equals(true) consentShare!: boolean;
  @Equals(true) consentTerms!: boolean;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

/** S-10 employer sign-up (FR-2.2.1). The business type is required. */
export class SignupEmployerDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(JOB_LIMITS.nameMax) contactName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(JOB_LIMITS.nameMax) organizationName!: string;
  @IsUUID() sectorId!: string;
  @IsUUID() businessTypeId!: string;
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(30) phone!: string;
  @IsString() @IsPasswordPolicy() password!: string;
  @Equals(true) consentTerms!: boolean;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

export class EmailDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @IsOptional() @IsIn(['ar', 'en']) locale?: 'ar' | 'en';
}

export class VerifyEmailDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @Matches(OTP_PATTERN) code!: string;
}

export class LoginDto {
  /** Email address or username (the system admin logs in as "admin"). */
  @Transform(lowerTrim) @IsString() @MinLength(1) @MaxLength(254) identifier!: string;
  @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX_LENGTH) password!: string;
}

export class ResetPasswordDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @Transform(trim) @Matches(OTP_PATTERN) code!: string;
  @IsString() @IsPasswordPolicy() newPassword!: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(PASSWORD_MAX_LENGTH) currentPassword!: string;
  @IsString() @IsPasswordPolicy() newPassword!: string;
}

export class UpdateMeDto {
  @IsIn(['ar', 'en']) locale!: 'ar' | 'en';
}

/** "My account": change the login email; a code goes to the new address. */
export class RequestEmailChangeDto {
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
  @IsString() @IsNotEmpty() @MaxLength(PASSWORD_MAX_LENGTH) currentPassword!: string;
}

export class ConfirmEmailChangeDto {
  @Matches(OTP_PATTERN) code!: string;
}
