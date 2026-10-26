import { Transform, Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { EMPLOYMENT_TYPES, EmploymentType, JOB_LIMITS } from '@sanad/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/** S-13 post / edit a job (FR-2.3.1). No employer field: the job carries only employer_id. */
export class JobInputDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(JOB_LIMITS.titleMax) title!: string;
  @Transform(trim)
  @IsString()
  @MinLength(JOB_LIMITS.descriptionMin)
  @MaxLength(JOB_LIMITS.descriptionMax)
  description!: string;
  @IsUUID() sectorId!: string;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(JOB_LIMITS.cityMax) city!: string;
  @IsUUID() countryId!: string;
  @Transform(emptyToNull) @IsOptional() @IsUUID() requiredEducationLevelId?: string | null;
  @Type(() => Number) @IsInt() @Min(0) @Max(JOB_LIMITS.maxYears) minYearsExperience!: number;
  @IsIn(EMPLOYMENT_TYPES) employmentType!: EmploymentType;
}

/** S-16 close a job (FR-2.3.4). The hired person is chosen among the job's applicants. */
export class CloseJobDto {
  @IsIn(['HIRED_VIA_PLATFORM', 'CLOSED_WITHOUT_HIRING'])
  outcome!: 'HIRED_VIA_PLATFORM' | 'CLOSED_WITHOUT_HIRING';
  @ValidateIf((o: CloseJobDto) => o.outcome === 'HIRED_VIA_PLATFORM')
  @IsUUID()
  hiredInterestId?: string;
}

/** S-08 interest request: explicit consent for this job (dialog checkbox). */
export class InterestDto {
  @IsBoolean() @Equals(true) consent!: boolean;
}

/** S-07 filters. */
export class JobsQueryDto {
  @Transform(trim) @IsOptional() @IsString() @MaxLength(100) q?: string;
  @Transform(emptyToNull) @IsOptional() @IsUUID() sectorId?: string | null;
  @Transform(trim) @IsOptional() @IsString() @MaxLength(JOB_LIMITS.cityMax) city?: string;
  @Transform(toBool) @IsOptional() @IsBoolean() fit?: boolean;
}

/** Admin rejection (FR-2.2.2): optional reason, sent in the rejection email. */
export class RejectEmployerDto {
  @Transform(emptyToNull)
  @IsOptional()
  @IsString()
  @MaxLength(JOB_LIMITS.rejectionReasonMax)
  reason?: string | null;
}
