import { Injectable } from '@nestjs/common';
import { LOOKUP_TYPES, LookupItemDto, LookupType } from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { PrismaService } from '../prisma/prisma.service';

const ORDER = [{ sortOrder: 'asc' as const }, { nameAr: 'asc' as const }];
const BASE = { id: true, nameAr: true, nameEn: true, sortOrder: true, isActive: true } as const;

/**
 * Read-only lookup lists for forms (admin CRUD is AdminLookupsService, S-19). Inactive items are
 * included with isActive false so existing records still show their names; the web offers only
 * active items in dropdowns. Server-side validation of new values still requires isActive.
 */
@Injectable()
export class LookupsService {
  constructor(private readonly prisma: PrismaService) {}

  isType(type: string): type is LookupType {
    return (LOOKUP_TYPES as readonly string[]).includes(type);
  }

  async list(type: string): Promise<LookupItemDto[]> {
    if (!this.isType(type)) throw Errors.notFound('LOOKUP_TYPE_UNKNOWN');
    const db = this.prisma.db;
    const where = {};
    switch (type) {
      case 'countries': {
        const rows = await db.country.findMany({ where, orderBy: ORDER, select: { ...BASE, isoCode: true } });
        return rows.map(({ isoCode, ...r }) => ({ ...r, code: isoCode }));
      }
      case 'sectors':
        return db.sector.findMany({ where, orderBy: ORDER, select: { ...BASE, code: true } });
      case 'education-levels':
        return db.educationLevel.findMany({
          where,
          orderBy: ORDER,
          select: { ...BASE, code: true, rank: true },
        });
      case 'dars':
        return db.dar.findMany({ where, orderBy: ORDER, select: { ...BASE, code: true } });
      case 'fakhdhs':
        return db.fakhdh.findMany({ where, orderBy: ORDER, select: { ...BASE, code: true, darId: true } });
      case 'business-types':
      default:
        return db.businessType.findMany({ where, orderBy: ORDER, select: { ...BASE, code: true } });
    }
  }
}
