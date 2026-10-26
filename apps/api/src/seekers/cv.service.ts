import { InjectQueue } from '@nestjs/bullmq';
import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CV_MAX_BYTES, CvAnalysisDto, FileLinkDto, ProfileDto } from '@sanad/shared';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { AppException, Errors } from '../common/app-exception';
import { CvAnalysisJob, QUEUES } from '../common/queues';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { CryptoService } from '../crypto/crypto.service';
import { checkCvFile, safeFileName } from '../files/file-type';
import { FILE_STORAGE, FileStorage } from '../files/file-storage';
import { FileLinksService } from '../files/file-links.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProfileService, toAnalysisDto } from './profile.service';

export interface IncomingFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

/**
 * CV upload, replace, remove and download links (S-06, FR-2.1.9).
 *  - type is decided by magic bytes (PDF, DOC, DOCX), size <= 10 MB;
 *  - files go to the private bucket under cv/<userId>/<uuid>.<ext>;
 *  - replacing keeps the earlier files (FR-2.1.9 "previous versions are kept");
 *    current_cv_file_id points at the latest;
 *  - each upload gets a cv_analyses row: SKIPPED when analysis is disabled, otherwise PENDING
 *    plus a cv-analysis job for the worker.
 */
@Injectable()
export class CvService implements OnModuleInit {
  private readonly logger = new Logger('Cv');

  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: ProfileService,
    private readonly links: FileLinksService,
    private readonly crypto: CryptoService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @InjectQueue(QUEUES.cvAnalysis) private readonly queue: Queue<CvAnalysisJob>,
  ) {}

  onModuleInit(): void {
    if (process.env.CV_ANALYSIS_ENABLED === 'true' && !this.config.cvAnalysis.apiKeyPresent) {
      this.logger.warn('CV_ANALYSIS_ENABLED=true but ANTHROPIC_API_KEY is empty: CV analysis stays off.');
    }
  }

  private get db() {
    return this.prisma.db;
  }

  async upload(userId: string, file: IncomingFile | undefined): Promise<ProfileDto> {
    if (!file || !file.buffer?.length) throw Errors.badRequest('FILE_REQUIRED');
    if (file.size > CV_MAX_BYTES || file.buffer.length > CV_MAX_BYTES) {
      throw new AppException('FILE_TOO_LARGE', HttpStatus.PAYLOAD_TOO_LARGE, { maxBytes: CV_MAX_BYTES });
    }
    const name = safeFileName(file.originalname);
    const type = checkCvFile(name, file.buffer);
    if (!type.ok) throw new AppException('FILE_TYPE_NOT_ALLOWED', HttpStatus.UNSUPPORTED_MEDIA_TYPE);

    const profile = await this.profiles.profileOf(userId);
    const key = `cv/${userId}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);

    const enabled = this.config.cvAnalysis.enabled;
    let analysisId: string;
    try {
      analysisId = await this.profiles.write(profile.id, 'cv', async () => {
        const row = await this.db.uploadedFile.create({
          data: {
            ownerUserId: userId,
            purpose: 'CV',
            bucket: this.config.s3.bucket,
            storageKey: key,
            originalName: name,
            mimeType: type.mime,
            sizeBytes: file.buffer.length,
            sha256: this.crypto.sha256(file.buffer),
          },
        });
        await this.db.seekerProfile.update({ where: { id: profile.id }, data: { currentCvFileId: row.id } });
        const analysis = await this.db.cvAnalysis.create({
          data: {
            seekerId: profile.id,
            fileId: row.id,
            status: enabled ? 'PENDING' : 'SKIPPED',
            model: enabled ? this.config.cvAnalysis.model : null,
          },
        });
        return analysis.id;
      });
    } catch (err) {
      // Keep storage and database consistent: the object without a row is useless.
      await this.storage.remove(key).catch(() => undefined);
      throw err;
    }

    if (enabled) {
      await this.queue
        .add(
          'analyze',
          { analysisId },
          {
            jobId: `cv-${analysisId}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 10_000 },
            removeOnComplete: 1000,
            removeOnFail: 5000,
          },
        )
        .catch((err: Error) => this.logger.error(`Could not enqueue CV analysis ${analysisId}: ${err.message}`));
    }
    return this.profiles.get(userId);
  }

  /** Removes the current CV from the profile. The file row is soft-deleted; storage keeps it. */
  async remove(userId: string): Promise<ProfileDto> {
    const profile = await this.profiles.profileOf(userId);
    if (!profile.currentCvFileId) throw Errors.notFound('CV_NOT_FOUND');
    const fileId = profile.currentCvFileId;
    await this.profiles.write(profile.id, 'cv', async () => {
      await this.db.seekerProfile.update({ where: { id: profile.id }, data: { currentCvFileId: null } });
      await this.db.uploadedFile.delete({ where: { id: fileId } });
    });
    return this.profiles.get(userId);
  }

  async link(userId: string): Promise<FileLinkDto> {
    const profile = await this.profiles.profileOf(userId);
    if (!profile.currentCvFileId) throw Errors.notFound('CV_NOT_FOUND');
    return this.links.issue(profile.currentCvFileId, userId);
  }

  /** The seeker corrects (or clears) the suggested sector of the latest completed analysis. */
  async correctSector(userId: string, sectorId: string | null): Promise<CvAnalysisDto> {
    const profile = await this.profiles.profileOf(userId);
    if (!profile.currentCvFileId) throw Errors.notFound('CV_NOT_FOUND');
    const analysis = await this.db.cvAnalysis.findFirst({
      where: { fileId: profile.currentCvFileId },
      orderBy: { createdAt: 'desc' },
    });
    if (!analysis || analysis.status !== 'COMPLETED') throw Errors.conflict('CV_ANALYSIS_NOT_READY');
    if (sectorId && !(await this.db.sector.count({ where: { id: sectorId, isActive: true } }))) {
      throw Errors.validation([{ field: 'sectorId', errors: ['LOOKUP_INVALID'] }]);
    }
    const updated = await this.profiles.write(profile.id, 'cv-analysis', () =>
      this.db.cvAnalysis.update({
        where: { id: analysis.id },
        data: { correctedSectorId: sectorId, correctedAt: sectorId ? new Date() : null },
      }),
    );
    return toAnalysisDto(updated);
  }
}
