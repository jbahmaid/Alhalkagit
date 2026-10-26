import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CvAnalysisDto,
  FieldErrorDetail,
  normalizePhone,
  normalizeSaudiMobile,
  PositionDto,
  ProfileDto,
  VerifierDto,
} from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { ProfileChangeReason } from '../common/queues';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  AffiliationStepDto,
  ContactStepDto,
  EducationStepDto,
  ExperienceStepDto,
  PersonalStepDto,
  PositionInputDto,
  VerifierInputDto,
} from './dto/profile.dto';
import { CompletionSnapshot, completionOf } from './profile-completion';
import { ProfileEventsService } from './profile-events.service';
import {
  birthDateRules,
  experienceRules,
  graduationYearRules,
  idNumberRules,
  parseDateInput,
  positionDateRules,
} from './profile-rules';

type Row = Record<string, unknown>;
const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null);
const asDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
const err = (field: string, rule: string): FieldErrorDetail => ({ field, errors: [rule] });

function comparable(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : v;
}

/** Only the fields whose value actually changes, so autosave does not write empty audit rows. */
export function changedFields<T extends Row>(current: Row, next: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (comparable(current[k]) !== comparable(v)) (out as Row)[k] = v;
  }
  return out;
}

function throwIf(errors: FieldErrorDetail[]): void {
  if (errors.length) throw Errors.validation(errors);
}

/**
 * Seeker profile (S-05): one method per wizard step, positions CRUD and completion tracking.
 * Every write goes through the audited Prisma client (audit_log rows with masked ID fields) and
 * then signals ProfileEventsService so match scores can be recomputed (batch 3).
 * Permissions are checked by the controller; every query is scoped to the caller's own profile.
 */
@Injectable()
export class ProfileService {
  /** Overridable in tests. */
  now: () => Date = () => new Date();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly events: ProfileEventsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private get db() {
    return this.prisma.db;
  }

  // -------------------------------------------------------------------------
  // Loading
  // -------------------------------------------------------------------------

  async profileOf(userId: string) {
    const profile = await this.db.seekerProfile.findFirst({ where: { userId } });
    if (!profile) throw Errors.notFound('PROFILE_NOT_FOUND');
    return profile;
  }

  private async personOf(profile: { personId: string | null }) {
    const person = profile.personId
      ? await this.db.person.findFirst({ where: { id: profile.personId } })
      : null;
    if (!person) throw Errors.conflict('PROFILE_PERSONAL_REQUIRED');
    return person;
  }

  private async positionsOf(seekerId: string) {
    return this.db.experiencePosition.findMany({
      where: { seekerId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async verifierOf(seekerId: string) {
    return this.db.experienceContact.findFirst({
      where: { seekerId, positionId: null },
      orderBy: { createdAt: 'asc' },
    });
  }

  private async educationOf(seekerId: string) {
    return this.db.seekerEducation.findFirst({
      where: { seekerId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async tribeRequirements(darId: string | null) {
    const darRequired = (await this.db.dar.count({ where: { isActive: true } })) > 0;
    const fakhdhRequired =
      (await this.db.fakhdh.count({
        where: { isActive: true, OR: [{ darId: null }, ...(darId ? [{ darId }] : [])] },
      })) > 0;
    return { darRequired, fakhdhRequired };
  }

  private async snapshot(profileId: string): Promise<CompletionSnapshot> {
    const profile = await this.db.seekerProfile.findFirstOrThrow({ where: { id: profileId } });
    const person = profile.personId
      ? await this.db.person.findFirst({ where: { id: profile.personId } })
      : null;
    const [education, positionCount, verifier] = await Promise.all([
      this.educationOf(profile.id),
      this.db.experiencePosition.count({ where: { seekerId: profile.id } }),
      this.verifierOf(profile.id),
    ]);
    return {
      hasPerson: !!person,
      darId: person?.darId ?? null,
      fakhdhId: person?.fakhdhId ?? null,
      ...(await this.tribeRequirements(person?.darId ?? null)),
      mobile: person?.mobile ?? null,
      email: person?.email ?? null,
      hasEducation: !!education,
      hasExperience: profile.hasExperience,
      yearsOfExperience: profile.yearsOfExperience,
      positionCount,
      hasVerifier: !!verifier,
      hasCv: !!profile.currentCvFileId,
      completedAt: profile.completedAt,
    };
  }

  /** Recomputes completion_step (inside the caller's transaction). */
  async refreshStep(profileId: string): Promise<void> {
    const profile = await this.db.seekerProfile.findFirstOrThrow({ where: { id: profileId } });
    const { completionStep } = completionOf(await this.snapshot(profileId));
    if (completionStep !== profile.completionStep) {
      await this.db.seekerProfile.update({ where: { id: profileId }, data: { completionStep } });
    }
  }

  /**
   * Runs one profile change in a transaction (audit rows included), recomputes completion_step,
   * and after commit emits the profile.updated hook so match scores are refreshed.
   */
  async write<T>(profileId: string, reason: ProfileChangeReason, fn: () => Promise<T>): Promise<T> {
    const result = await this.prisma.tx(async () => {
      const r = await fn();
      await this.refreshStep(profileId);
      return r;
    });
    await this.events.changed(profileId, reason);
    return result;
  }

  async get(userId: string): Promise<ProfileDto> {
    const profile = await this.profileOf(userId);
    const user = await this.db.user.findFirstOrThrow({ where: { id: userId }, select: { email: true } });
    const person = profile.personId
      ? await this.db.person.findFirst({ where: { id: profile.personId } })
      : null;
    const [education, positions, verifier] = await Promise.all([
      this.educationOf(profile.id),
      this.positionsOf(profile.id),
      this.verifierOf(profile.id),
    ]);
    const state = completionOf(await this.snapshot(profile.id));
    const file = profile.currentCvFileId
      ? await this.db.uploadedFile.findFirst({ where: { id: profile.currentCvFileId } })
      : null;
    const analysis = file
      ? await this.db.cvAnalysis.findFirst({ where: { fileId: file.id }, orderBy: { createdAt: 'desc' } })
      : null;
    const previousVersions = await this.db.uploadedFile.count({
      where: {
        ownerUserId: userId,
        purpose: 'CV',
        ...(file ? { id: { not: file.id } } : {}),
        deletedAt: undefined,
      },
    });

    return {
      completionStep: profile.completionStep,
      completedAt: profile.completedAt?.toISOString() ?? null,
      steps: state.steps,
      percent: state.percent,
      accountEmail: user.email,
      personal: person
        ? {
            firstName: person.firstName,
            fatherName: person.fatherName,
            grandfatherName: person.grandfatherName,
            familyName: person.familyName,
            idType: person.idType,
            idNumberMasked: this.maskId(person.idNumberEncrypted),
            gender: person.gender,
            birthDate: iso(person.birthDate) as string,
            nationalityId: person.nationalityId,
            hasSpecialNeeds: person.hasSpecialNeeds,
          }
        : null,
      affiliation: { darId: person?.darId ?? null, fakhdhId: person?.fakhdhId ?? null },
      contact: { mobile: person?.mobile ?? null, email: person?.email ?? null },
      education: education
        ? {
            id: education.id,
            educationLevelId: education.educationLevelId,
            graduationYear: education.graduationYear,
            institution: education.institution,
            countryId: education.countryId,
            fieldOfStudy: education.fieldOfStudy,
          }
        : null,
      experience: {
        hasExperience: profile.hasExperience,
        yearsOfExperience: profile.yearsOfExperience,
        positions: positions.map(toPositionDto),
        verifier: verifier ? toVerifierDto(verifier) : null,
      },
      cv: {
        file: file
          ? {
              id: file.id,
              originalName: file.originalName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              uploadedAt: file.createdAt.toISOString(),
            }
          : null,
        analysis: analysis ? toAnalysisDto(analysis) : null,
        analysisEnabled: this.config.cvAnalysis.enabled,
        previousVersions,
      },
    };
  }

  private maskId(encrypted: string): string {
    try {
      const plain = this.crypto.decrypt(encrypted);
      return '•'.repeat(Math.max(0, plain.length - 4)) + plain.slice(-4);
    } catch {
      return '••••';
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: personal
  // -------------------------------------------------------------------------

  async updatePersonal(userId: string, dto: PersonalStepDto): Promise<ProfileDto> {
    const today = this.now();
    const errors = birthDateRules(dto.birthDate, today);
    if (dto.idNumber) errors.push(...idNumberRules(dto.idType, dto.idNumber));
    if (!(await this.db.country.count({ where: { id: dto.nationalityId, isActive: true } }))) {
      errors.push(err('nationalityId', 'LOOKUP_INVALID'));
    }
    const profile = await this.profileOf(userId);
    const person = profile.personId
      ? await this.db.person.findFirst({ where: { id: profile.personId } })
      : null;
    if (!person && !dto.idNumber) errors.push(err('idNumber', 'isNotEmpty'));

    // ID: new number, or the stored one re-fingerprinted when only the type changed.
    let protectedId:
      | { idNumberEncrypted: string; idNumberHash: string; idNumberKeyVersion: number }
      | undefined;
    if (dto.idNumber) {
      protectedId = this.crypto.protectIdNumber(dto.idType, dto.idNumber);
    } else if (person && person.idType !== dto.idType) {
      const stored = this.crypto.decrypt(person.idNumberEncrypted);
      const formatErrors = idNumberRules(dto.idType, stored);
      if (formatErrors.length) errors.push(...formatErrors);
      else protectedId = this.crypto.protectIdNumber(dto.idType, stored);
    }
    throwIf(errors);

    if (protectedId && protectedId.idNumberHash !== person?.idNumberHash) {
      const taken = await this.db.person.count({
        where: {
          idNumberHash: protectedId.idNumberHash,
          deletedAt: undefined,
          ...(person ? { id: { not: person.id } } : {}),
        },
      });
      if (taken) throw Errors.conflict('PROFILE_ID_NUMBER_TAKEN');
    }

    const data = {
      firstName: dto.firstName,
      fatherName: dto.fatherName,
      grandfatherName: dto.grandfatherName,
      familyName: dto.familyName,
      idType: dto.idType,
      gender: dto.gender,
      birthDate: asDate(dto.birthDate),
      nationalityId: dto.nationalityId,
      hasSpecialNeeds: dto.hasSpecialNeeds,
    };

    try {
      await this.write(profile.id, 'personal', async () => {
        if (!person) {
          const created = await this.db.person.create({
            data: { ...data, ...protectedId!, userId },
          });
          await this.db.seekerProfile.update({ where: { id: profile.id }, data: { personId: created.id } });
        } else {
          const next = { ...data };
          // Never compare ciphertexts (random IV): only write the ID when its fingerprint changes.
          const changes: Row = changedFields(person, next);
          if (protectedId && protectedId.idNumberHash !== person.idNumberHash)
            Object.assign(changes, protectedId);
          if (Object.keys(changes).length) {
            await this.db.person.update({ where: { id: person.id }, data: changes });
          }
        }
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw Errors.conflict('PROFILE_ID_NUMBER_TAKEN');
      }
      throw e;
    }
    return this.get(userId);
  }

  // -------------------------------------------------------------------------
  // Step 2: dar and fakhdh
  // -------------------------------------------------------------------------

  async updateAffiliation(userId: string, dto: AffiliationStepDto): Promise<ProfileDto> {
    const profile = await this.profileOf(userId);
    const person = await this.personOf(profile);
    const darId = dto.darId ?? null;
    const fakhdhId = dto.fakhdhId ?? null;
    const errors: FieldErrorDetail[] = [];
    const { darRequired, fakhdhRequired } = await this.tribeRequirements(darId);

    if (darId) {
      if (!(await this.db.dar.count({ where: { id: darId, isActive: true } })))
        errors.push(err('darId', 'LOOKUP_INVALID'));
    } else if (darRequired) errors.push(err('darId', 'isNotEmpty'));

    if (fakhdhId) {
      const fakhdh = await this.db.fakhdh.findFirst({ where: { id: fakhdhId, isActive: true } });
      if (!fakhdh) errors.push(err('fakhdhId', 'LOOKUP_INVALID'));
      else if (fakhdh.darId && fakhdh.darId !== darId) errors.push(err('fakhdhId', 'FAKHDH_DAR_MISMATCH'));
    } else if (fakhdhRequired) errors.push(err('fakhdhId', 'isNotEmpty'));
    throwIf(errors);

    await this.write(profile.id, 'affiliation', async () => {
      const changes = changedFields(person, { darId, fakhdhId });
      if (Object.keys(changes).length)
        await this.db.person.update({ where: { id: person.id }, data: changes });
    });
    return this.get(userId);
  }

  // -------------------------------------------------------------------------
  // Step 3: contact
  // -------------------------------------------------------------------------

  async updateContact(userId: string, dto: ContactStepDto): Promise<ProfileDto> {
    const mobile = normalizeSaudiMobile(dto.mobile);
    if (!mobile) throw Errors.validation([err('mobile', 'SAUDI_MOBILE')]);
    const profile = await this.profileOf(userId);
    const person = await this.personOf(profile);
    await this.write(profile.id, 'contact', async () => {
      const changes = changedFields(person, { mobile, email: dto.email });
      if (Object.keys(changes).length)
        await this.db.person.update({ where: { id: person.id }, data: changes });
    });
    return this.get(userId);
  }

  // -------------------------------------------------------------------------
  // Step 4: education (the wizard edits the main qualification; the table allows several)
  // -------------------------------------------------------------------------

  async updateEducation(userId: string, dto: EducationStepDto): Promise<ProfileDto> {
    const profile = await this.profileOf(userId);
    const person = profile.personId
      ? await this.db.person.findFirst({ where: { id: profile.personId } })
      : null;
    const errors = graduationYearRules(dto.graduationYear, iso(person?.birthDate), this.now());
    if (!(await this.db.educationLevel.count({ where: { id: dto.educationLevelId, isActive: true } }))) {
      errors.push(err('educationLevelId', 'LOOKUP_INVALID'));
    }
    if (!(await this.db.country.count({ where: { id: dto.countryId, isActive: true } }))) {
      errors.push(err('countryId', 'LOOKUP_INVALID'));
    }
    throwIf(errors);

    const data = {
      educationLevelId: dto.educationLevelId,
      graduationYear: dto.graduationYear,
      institution: dto.institution,
      countryId: dto.countryId,
      fieldOfStudy: dto.fieldOfStudy ?? null,
    };
    await this.write(profile.id, 'education', async () => {
      const current = await this.educationOf(profile.id);
      if (!current) {
        await this.db.seekerEducation.create({ data: { ...data, seekerId: profile.id, sortOrder: 0 } });
      } else {
        const changes = changedFields(current, data);
        if (Object.keys(changes).length) {
          await this.db.seekerEducation.update({ where: { id: current.id }, data: changes });
        }
      }
    });
    return this.get(userId);
  }

  // -------------------------------------------------------------------------
  // Step 5: experience, positions, verifier
  // -------------------------------------------------------------------------

  private async validatePositions(
    list: PositionInputDto[],
    birthDate: string | null,
    prefix: (i: number) => string,
  ): Promise<{ start: string; end: string | null }[]> {
    const today = this.now();
    const errors: FieldErrorDetail[] = [];
    const dates: { start: string; end: string | null }[] = [];
    const sectorIds = [...new Set(list.map((p) => p.sectorId).filter((s): s is string => !!s))];
    const validSectors = new Set(
      sectorIds.length
        ? (
            await this.db.sector.findMany({
              where: { id: { in: sectorIds }, isActive: true },
              select: { id: true },
            })
          ).map((s) => s.id)
        : [],
    );
    list.forEach((p, i) => {
      const r = positionDateRules(p, birthDate, today, prefix(i));
      errors.push(...r.errors);
      if (p.sectorId && !validSectors.has(p.sectorId))
        errors.push(err(`${prefix(i)}sectorId`, 'LOOKUP_INVALID'));
      dates.push({ start: r.start ?? '', end: r.end });
    });
    throwIf(errors);
    return dates;
  }

  private positionData(p: PositionInputDto, d: { start: string; end: string | null }) {
    return {
      title: p.title,
      organization: p.organization ?? null,
      sectorId: p.sectorId ?? null,
      startDate: asDate(d.start),
      endDate: d.end ? asDate(d.end) : null,
    };
  }

  private verifierData(v: VerifierInputDto, field = 'verifier.') {
    const errors: FieldErrorDetail[] = [];
    const phone = v.phone ? normalizePhone(v.phone) : null;
    if (v.phone && !phone) errors.push(err(`${field}phone`, 'PHONE_FORMAT'));
    if (!v.phone && !v.email) errors.push(err(`${field}phone`, 'CONTACT_REQUIRED'));
    throwIf(errors);
    return {
      name: v.name,
      jobTitle: v.jobTitle ?? null,
      organization: v.organization ?? null,
      phone,
      email: v.email ?? null,
      notes: v.notes ?? null,
    };
  }

  private async birthDateOf(profile: { personId: string | null }): Promise<string | null> {
    if (!profile.personId) return null;
    const person = await this.db.person.findFirst({
      where: { id: profile.personId },
      select: { birthDate: true },
    });
    return iso(person?.birthDate);
  }

  async updateExperience(userId: string, dto: ExperienceStepDto): Promise<ProfileDto> {
    throwIf(experienceRules(dto.hasExperience, dto.yearsOfExperience));
    const profile = await this.profileOf(userId);
    const birthDate = await this.birthDateOf(profile);
    const positions = dto.hasExperience ? dto.positions : undefined;
    const dates = positions
      ? await this.validatePositions(positions, birthDate, (i) => `positions.${i}.`)
      : [];
    const verifier =
      dto.hasExperience && dto.verifier !== undefined && dto.verifier !== null
        ? this.verifierData(dto.verifier)
        : undefined;

    await this.write(profile.id, 'experience', async () => {
      const years = dto.hasExperience ? (dto.yearsOfExperience ?? null) : null;
      const changes = changedFields(profile, { hasExperience: dto.hasExperience, yearsOfExperience: years });
      // hasExperience=false and years must be written together (CHECK constraint).
      if (Object.keys(changes).length) {
        await this.db.seekerProfile.update({
          where: { id: profile.id },
          data: { hasExperience: dto.hasExperience, yearsOfExperience: years },
        });
      }

      if (!dto.hasExperience) {
        // "No experience": positions and the verifier no longer apply (soft delete, audited).
        await this.db.experienceContact.deleteMany({ where: { seekerId: profile.id } });
        await this.db.experiencePosition.deleteMany({ where: { seekerId: profile.id } });
      } else {
        if (positions) await this.syncPositions(profile.id, positions, dates);
        if (dto.verifier === null) {
          await this.db.experienceContact.deleteMany({ where: { seekerId: profile.id, positionId: null } });
        } else if (verifier) {
          await this.saveVerifier(profile.id, verifier);
        }
      }
    });
    return this.get(userId);
  }

  /** Replace the list: update kept ids, delete missing ones, create new ones; order = array order. */
  private async syncPositions(
    seekerId: string,
    list: PositionInputDto[],
    dates: { start: string; end: string | null }[],
  ): Promise<void> {
    const existing = await this.positionsOf(seekerId);
    const byId = new Map(existing.map((p) => [p.id, p]));
    const keep = new Set<string>();
    for (const p of list) {
      if (p.id && !byId.has(p.id)) throw Errors.notFound('POSITION_NOT_FOUND');
      if (p.id) keep.add(p.id);
    }
    const removed = existing.filter((p) => !keep.has(p.id)).map((p) => p.id);
    if (removed.length) {
      await this.db.experienceContact.updateMany({
        where: { seekerId, positionId: { in: removed } },
        data: { positionId: null },
      });
      await this.db.experiencePosition.deleteMany({ where: { id: { in: removed }, seekerId } });
    }
    for (const [i, p] of list.entries()) {
      const data = { ...this.positionData(p, dates[i]), sortOrder: i };
      if (p.id) {
        const changes = changedFields(byId.get(p.id)!, data);
        if (Object.keys(changes).length) {
          await this.db.experiencePosition.update({ where: { id: p.id }, data: changes });
        }
      } else {
        await this.db.experiencePosition.create({ data: { ...data, seekerId } });
      }
    }
  }

  private async saveVerifier(
    seekerId: string,
    data: ReturnType<ProfileService['verifierData']>,
  ): Promise<void> {
    const current = await this.verifierOf(seekerId);
    if (!current) {
      await this.db.experienceContact.create({ data: { ...data, seekerId } });
      return;
    }
    const changes = changedFields(current, data);
    if (Object.keys(changes).length)
      await this.db.experienceContact.update({ where: { id: current.id }, data: changes });
  }

  private async experienceProfile(userId: string) {
    const profile = await this.profileOf(userId);
    if (profile.hasExperience === false) throw Errors.conflict('CONFLICT', { reason: 'NO_EXPERIENCE' });
    return profile;
  }

  async listPositions(userId: string): Promise<PositionDto[]> {
    const profile = await this.profileOf(userId);
    return (await this.positionsOf(profile.id)).map(toPositionDto);
  }

  async createPosition(userId: string, dto: PositionInputDto): Promise<PositionDto> {
    const profile = await this.experienceProfile(userId);
    const [d] = await this.validatePositions([dto], await this.birthDateOf(profile), () => '');
    const created = await this.write(profile.id, 'positions', async () => {
      const last = await this.db.experiencePosition.findFirst({
        where: { seekerId: profile.id },
        orderBy: { sortOrder: 'desc' },
      });
      const row = await this.db.experiencePosition.create({
        data: { ...this.positionData(dto, d), seekerId: profile.id, sortOrder: (last?.sortOrder ?? -1) + 1 },
      });
      if (profile.hasExperience === null) {
        await this.db.seekerProfile.update({ where: { id: profile.id }, data: { hasExperience: true } });
      }
      return row;
    });
    return toPositionDto(created);
  }

  async updatePosition(userId: string, id: string, dto: PositionInputDto): Promise<PositionDto> {
    const profile = await this.experienceProfile(userId);
    const current = await this.db.experiencePosition.findFirst({ where: { id, seekerId: profile.id } });
    if (!current) throw Errors.notFound('POSITION_NOT_FOUND');
    const [d] = await this.validatePositions([dto], await this.birthDateOf(profile), () => '');
    const updated = await this.write(profile.id, 'positions', async () => {
      const changes = changedFields(current, this.positionData(dto, d));
      const row = Object.keys(changes).length
        ? await this.db.experiencePosition.update({ where: { id }, data: changes })
        : current;
      return row;
    });
    return toPositionDto(updated);
  }

  async deletePosition(userId: string, id: string): Promise<void> {
    const profile = await this.profileOf(userId);
    const current = await this.db.experiencePosition.findFirst({ where: { id, seekerId: profile.id } });
    if (!current) throw Errors.notFound('POSITION_NOT_FOUND');
    await this.write(profile.id, 'positions', async () => {
      await this.db.experienceContact.updateMany({
        where: { seekerId: profile.id, positionId: id },
        data: { positionId: null },
      });
      await this.db.experiencePosition.delete({ where: { id } });
    });
  }

  async reorderPositions(userId: string, ids: string[]): Promise<PositionDto[]> {
    const profile = await this.profileOf(userId);
    const existing = await this.positionsOf(profile.id);
    const same =
      ids.length === existing.length &&
      new Set(ids).size === ids.length &&
      existing.every((p) => ids.includes(p.id));
    if (!same) throw Errors.badRequest('POSITIONS_ORDER_MISMATCH');
    await this.write(profile.id, 'positions', async () => {
      for (const [i, id] of ids.entries()) {
        const p = existing.find((x) => x.id === id)!;
        if (p.sortOrder !== i)
          await this.db.experiencePosition.update({ where: { id }, data: { sortOrder: i } });
      }
    });
    return this.listPositions(userId);
  }

  async putVerifier(userId: string, dto: VerifierInputDto): Promise<VerifierDto> {
    const profile = await this.experienceProfile(userId);
    const data = this.verifierData(dto, '');
    await this.write(profile.id, 'verifier', async () => {
      await this.saveVerifier(profile.id, data);
    });
    return toVerifierDto((await this.verifierOf(profile.id))!);
  }

  async deleteVerifier(userId: string): Promise<void> {
    const profile = await this.profileOf(userId);
    await this.write(profile.id, 'verifier', async () => {
      await this.db.experienceContact.deleteMany({ where: { seekerId: profile.id, positionId: null } });
    });
  }

  // -------------------------------------------------------------------------
  // Finish (S-06 "Finish and see jobs")
  // -------------------------------------------------------------------------

  async complete(userId: string): Promise<ProfileDto> {
    const profile = await this.profileOf(userId);
    const state = completionOf(await this.snapshot(profile.id));
    if (state.missing.length) throw Errors.conflict('PROFILE_INCOMPLETE', { missing: state.missing });
    await this.write(profile.id, 'completed', async () => {
      if (!profile.completedAt || profile.completionStep !== 'COMPLETED') {
        await this.db.seekerProfile.update({
          where: { id: profile.id },
          data: { completedAt: profile.completedAt ?? this.now(), completionStep: 'COMPLETED' },
        });
      }
    });
    return this.get(userId);
  }
}

export function toPositionDto(p: {
  id: string;
  title: string;
  organization: string | null;
  sectorId: string | null;
  startDate: Date;
  endDate: Date | null;
  sortOrder: number;
}): PositionDto {
  return {
    id: p.id,
    title: p.title,
    organization: p.organization,
    sectorId: p.sectorId,
    startDate: iso(p.startDate) as string,
    endDate: iso(p.endDate),
    sortOrder: p.sortOrder,
  };
}

export function toVerifierDto(v: {
  id: string;
  name: string;
  jobTitle: string | null;
  organization: string | null;
  phone: string | null;
  email: string | null;
}): VerifierDto {
  return {
    id: v.id,
    name: v.name,
    jobTitle: v.jobTitle,
    organization: v.organization,
    phone: v.phone,
    email: v.email,
  };
}

const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

export function toAnalysisDto(a: {
  id: string;
  status: CvAnalysisDto['status'];
  suggestedSectorId: string | null;
  correctedSectorId: string | null;
  skills: unknown;
  inferredYears: number | null;
  tipsAr: unknown;
  tipsEn: unknown;
  completedAt: Date | null;
}): CvAnalysisDto {
  return {
    id: a.id,
    status: a.status,
    suggestedSectorId: a.suggestedSectorId,
    correctedSectorId: a.correctedSectorId,
    sectorId: a.correctedSectorId ?? a.suggestedSectorId,
    skills: stringList(a.skills),
    inferredYears: a.inferredYears,
    tipsAr: stringList(a.tipsAr),
    tipsEn: stringList(a.tipsEn),
    completedAt: a.completedAt?.toISOString() ?? null,
  };
}

export { parseDateInput };
