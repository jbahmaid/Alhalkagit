import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PROFILE_LIMITS, toLatinDigits } from '@sanad/shared';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : value;
const lowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
/** "" from an empty form field means "not set". */
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? null : typeof value === 'string' ? value.trim() : value;
const digits = ({ value }: { value: unknown }) => (typeof value === 'string' ? toLatinDigits(value).trim() : value);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Positions are entered as months (YYYY-MM); full dates are accepted too. */
const MONTH_OR_DATE = /^\d{4}-\d{2}(-\d{2})?$/;

/** Step 1 (S-05): personal data. FR-2.1.2 */
export class PersonalStepDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PROFILE_LIMITS.nameMax) firstName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PROFILE_LIMITS.nameMax) fatherName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PROFILE_LIMITS.nameMax) grandfatherName!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PROFILE_LIMITS.nameMax) familyName!: string;
  @IsIn(['NATIONAL_ID', 'PASSPORT']) idType!: 'NATIONAL_ID' | 'PASSPORT';
  /** Required the first time; afterwards omit (or send empty) to keep the stored number. */
  @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(40) idNumber?: string | null;
  @IsIn(['MALE', 'FEMALE']) gender!: 'MALE' | 'FEMALE';
  @Transform(digits) @Matches(DATE) birthDate!: string;
  @IsUUID() nationalityId!: string;
  @IsBoolean() hasSpecialNeeds!: boolean;
}

/** Step 2: dar and fakhdh. FR-2.1.3, FR-2.1.4 */
export class AffiliationStepDto {
  @Transform(emptyToNull) @IsOptional() @IsUUID() darId?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsUUID() fakhdhId?: string | null;
}

/** Step 3: contact. FR-2.1.5 (both mandatory) */
export class ContactStepDto {
  @Transform(digits) @IsString() @IsNotEmpty() @MaxLength(30) mobile!: string;
  @Transform(lowerTrim) @IsEmail() @MaxLength(254) email!: string;
}

/** Step 4: education. FR-2.1.6 */
export class EducationStepDto {
  @IsUUID() educationLevelId!: string;
  @Type(() => Number) @IsInt() graduationYear!: number;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PROFILE_LIMITS.institutionMax) institution!: string;
  @IsUUID() countryId!: string;
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(PROFILE_LIMITS.institutionMax)
  fieldOfStudy?: string | null;
}

/** One position. endDate null (or omitted) means "present". FR-2.1.8 */
export class PositionInputDto {
  /** Present when updating an existing position inside PATCH /experience. */
  @IsOptional() @IsUUID() id?: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(PROFILE_LIMITS.titleMax) title!: string;
  @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(PROFILE_LIMITS.titleMax) organization?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsUUID() sectorId?: string | null;
  @Transform(digits) @Matches(MONTH_OR_DATE) startDate!: string;
  @Transform(emptyToNull) @IsOptional() @Matches(MONTH_OR_DATE) endDate?: string | null;
}

/** Experience verification contact. FR-2.1.8 */
export class VerifierInputDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(200) name!: string;
  @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(200) jobTitle?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(200) organization?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(30) phone?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsEmail() @MaxLength(254) email?: string | null;
  @Transform(emptyToNull) @IsOptional() @IsString() @MaxLength(PROFILE_LIMITS.notesMax) notes?: string | null;
}

/**
 * Step 5: experience. FR-2.1.7, FR-2.1.8. Saves the whole step at once (what the wizard does):
 * when `positions` is present it replaces the list (ids kept are updated, missing ones are
 * deleted, new ones created, order = array order). The per-position endpoints do the same one
 * at a time.
 */
export class ExperienceStepDto {
  @IsBoolean() hasExperience!: boolean;
  @ValidateIf((o: ExperienceStepDto) => o.hasExperience === true)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(PROFILE_LIMITS.maxYearsOfExperience)
  yearsOfExperience?: number | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PositionInputDto)
  positions?: PositionInputDto[];
  @IsOptional() @ValidateNested() @Type(() => VerifierInputDto) verifier?: VerifierInputDto | null;
}

export class ReorderPositionsDto {
  @IsArray() @ArrayMaxSize(200) @IsUUID('all', { each: true }) ids!: string[];
}

export class CorrectSectorDto {
  /** null clears the correction (back to the suggested sector). */
  @Transform(emptyToNull) @IsOptional() @IsUUID() sectorId!: string | null;
}
