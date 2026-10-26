import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { LOOKUP_TYPES, type AdminLookupItemDto, type FieldErrorDetail, type LookupType } from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';
import { LookupCreateDto, LookupUpdateDto } from './dto/admin.dto';

type Delegate = 'country' | 'sector' | 'educationLevel' | 'dar' | 'fakhdh' | 'businessType';
const DELEGATE: Record<LookupType, Delegate> = {
  countries: 'country',
  sectors: 'sector',
  'education-levels': 'educationLevel',
  dars: 'dar',
  fakhdhs: 'fakhdh',
  'business-types': 'businessType',
};
const ORDER = [{ sortOrder: 'asc' as const }, { nameAr: 'asc' as const }];

type Row = {
  id: string;
  code?: string;
  isoCode?: string;
  nameAr: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
  rank?: number;
  darId?: string | null;
};

/**
 * S-19 lookup lists CRUD (FR-2.4.2), `lookups.manage`. Items are never deleted: deactivating sets
 * isActive false, so existing records keep their value and forms stop offering it. Every write
 * goes through the audited client.
 */
@Injectable()
export class AdminLookupsService {
  constructor(private readonly prisma: PrismaService) {}

  private delegate(type: string): any {
    if (!(LOOKUP_TYPES as readonly string[]).includes(type)) throw Errors.notFound('LOOKUP_TYPE_UNKNOWN');
    return (this.prisma.db as any)[DELEGATE[type as LookupType]];
  }

  private toDto(type: LookupType, r: Row): AdminLookupItemDto {
    return {
      id: r.id,
      code: type === 'countries' ? r.isoCode! : r.code!,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      sortOrder: r.sortOrder,
      isActive: r.isActive,
      ...(type === 'education-levels' ? { rank: r.rank } : {}),
      ...(type === 'fakhdhs' ? { darId: r.darId ?? null } : {}),
    };
  }

  async list(type: string): Promise<AdminLookupItemDto[]> {
    const rows: Row[] = await this.delegate(type).findMany({ orderBy: ORDER });
    return rows.map((r) => this.toDto(type as LookupType, r));
  }

  /** Field errors for code / rank / dar (uniqueness checked across deleted rows too). */
  private async check(
    type: LookupType,
    input: { code?: string; rank?: number; darId?: string | null },
    selfId?: string,
  ): Promise<void> {
    const errors: FieldErrorDetail[] = [];
    const d = this.delegate(type);
    if (input.code !== undefined) {
      if (type === 'countries' && !/^[A-Z]{2}$/.test(input.code)) {
        errors.push({ field: 'code', errors: ['matches'] });
      } else {
        const where = type === 'countries' ? { isoCode: input.code } : { code: input.code };
        const clash = await d.findFirst({ where: { ...where, deletedAt: undefined }, select: { id: true } });
        if (clash && clash.id !== selfId) errors.push({ field: 'code', errors: ['LOOKUP_CODE_TAKEN'] });
      }
    }
    if (type === 'education-levels' && input.rank !== undefined) {
      const clash = await d.findFirst({
        where: { rank: input.rank, deletedAt: undefined },
        select: { id: true },
      });
      if (clash && clash.id !== selfId) errors.push({ field: 'rank', errors: ['LOOKUP_RANK_TAKEN'] });
    }
    if (type === 'fakhdhs' && input.darId) {
      const dar = await this.prisma.db.dar.count({ where: { id: input.darId } });
      if (!dar) errors.push({ field: 'darId', errors: ['LOOKUP_INVALID'] });
    }
    if (errors.length) throw Errors.validation(errors);
  }

  private data(type: LookupType, dto: LookupCreateDto | LookupUpdateDto): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (dto.code !== undefined) out[type === 'countries' ? 'isoCode' : 'code'] = dto.code;
    for (const k of ['nameAr', 'nameEn', 'sortOrder', 'isActive'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k];
    }
    if (type === 'education-levels' && dto.rank !== undefined) out.rank = dto.rank;
    if (type === 'fakhdhs' && dto.darId !== undefined) out.darId = dto.darId;
    return out;
  }

  async create(type: string, dto: LookupCreateDto): Promise<AdminLookupItemDto> {
    const d = this.delegate(type);
    const t = type as LookupType;
    if (t === 'education-levels' && dto.rank === undefined) {
      throw Errors.validation([{ field: 'rank', errors: ['isInt'] }]);
    }
    await this.check(t, dto);
    try {
      const row = await d.create({ data: { sortOrder: 0, isActive: true, ...this.data(t, dto) } });
      return this.toDto(t, row);
    } catch (err) {
      throw this.uniqueError(err);
    }
  }

  async update(type: string, id: string, dto: LookupUpdateDto): Promise<AdminLookupItemDto> {
    const d = this.delegate(type);
    const t = type as LookupType;
    const cur = await d.findFirst({ where: { id } });
    if (!cur) throw Errors.notFound('LOOKUP_NOT_FOUND');
    await this.check(t, dto, id);
    const data = this.data(t, dto);
    if (!Object.keys(data).length) return this.toDto(t, cur);
    try {
      return this.toDto(t, await d.update({ where: { id }, data }));
    } catch (err) {
      throw this.uniqueError(err);
    }
  }

  /** A race between the check and the insert still ends as a clean field error. */
  private uniqueError(err: unknown): unknown {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const target = String((err.meta as { target?: unknown })?.target ?? '');
      return Errors.validation([
        target.includes('rank')
          ? { field: 'rank', errors: ['LOOKUP_RANK_TAKEN'] }
          : { field: 'code', errors: ['LOOKUP_CODE_TAKEN'] },
      ]);
    }
    return err;
  }
}
