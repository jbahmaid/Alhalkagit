import { Injectable } from '@nestjs/common';
import type { FieldErrorDetail, MatchingSettingsDto } from '@sanad/shared';
import { Errors } from '../common/app-exception';
import { MatchingEventsService } from '../matching/matching-events.service';
import { MatchingService } from '../matching/matching.service';
import { PrismaService } from '../prisma/prisma.service';
import { MatchingSettingsInputDto } from './dto/admin.dto';

/** Field errors for matching settings: weights sum to 100, 0 < near < suitable <= 100. */
export function checkMatchingSettings(s: MatchingSettingsDto): FieldErrorDetail[] {
  const errors: FieldErrorDetail[] = [];
  const w = s.weights;
  if (w.sector + w.education + w.experience + w.keywords !== 100) {
    errors.push({ field: 'weights', errors: ['WEIGHTS_SUM'] });
  }
  if (!(s.thresholds.near < s.thresholds.suitable)) {
    errors.push({ field: 'thresholds.near', errors: ['THRESHOLD_ORDER'] });
  }
  return errors;
}

/** Matching weights and thresholds (`settings.manage`). Saving queues a full recompute. */
@Injectable()
export class AdminSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matching: MatchingService,
    private readonly events: MatchingEventsService,
  ) {}

  async get(): Promise<MatchingSettingsDto> {
    const s = await this.matching.settings();
    return { weights: { ...s.weights }, thresholds: { ...s.thresholds } };
  }

  async save(adminId: string, dto: MatchingSettingsInputDto): Promise<MatchingSettingsDto> {
    const value: MatchingSettingsDto = {
      weights: {
        sector: dto.weights.sector,
        education: dto.weights.education,
        experience: dto.weights.experience,
        keywords: dto.weights.keywords,
      },
      thresholds: { suitable: dto.thresholds.suitable, near: dto.thresholds.near },
    };
    const errors = checkMatchingSettings(value);
    if (errors.length) throw Errors.validation(errors);
    await this.prisma.tx(async () => {
      for (const [key, v] of [
        ['matching.weights', value.weights],
        ['matching.thresholds', value.thresholds],
      ] as const) {
        const cur = await this.prisma.db.setting.findFirst({ where: { key } });
        if (cur) {
          await this.prisma.db.setting.update({ where: { key }, data: { value: v, updatedById: adminId } });
        } else {
          await this.prisma.db.setting.create({ data: { key, value: v, updatedById: adminId } });
        }
      }
    });
    await this.events.recomputeAll();
    return value;
  }
}
