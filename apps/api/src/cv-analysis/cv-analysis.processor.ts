import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job, Queue, UnrecoverableError } from 'bullmq';
import { PROFILE_UPDATED_JOB, CvAnalysisJob, ProfileUpdatedJob, QUEUES } from '../common/queues';
import { FILE_STORAGE, FileStorage } from '../files/file-storage';
import { PrismaService } from '../prisma/prisma.service';
import { CV_ANALYZER, CvAnalysisError, CvAnalyzer } from './cv-analyzer';
import { CvTextError, extractCvText } from './cv-text';

/** Analysis runs as the system (no user actor in the audit trail). */
const SYSTEM_ACTOR = { userId: null, role: null, ip: null, userAgent: 'worker:cv-analysis', requestId: null };

/**
 * Worker: cv-analysis queue (architecture section 7). Steps: mark PROCESSING -> read the file
 * from storage -> extract text -> analyzer (CV text only) -> validate -> store COMPLETED ->
 * signal profile.updated. Retryable failures go back to PENDING and BullMQ retries with
 * backoff; final failures are stored as FAILED with a short error code.
 */
@Processor(QUEUES.cvAnalysis, { concurrency: 2 })
export class CvAnalysisProcessor extends WorkerHost {
  private readonly logger = new Logger('CvAnalysis');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
    @Inject(CV_ANALYZER) private readonly analyzer: CvAnalyzer,
    @InjectQueue(QUEUES.matching) private readonly matching: Queue<ProfileUpdatedJob>,
  ) {
    super();
  }

  async process(job: Job<CvAnalysisJob>): Promise<void> {
    await this.prisma.runAs(SYSTEM_ACTOR, () => this.run(job));
  }

  async run(job: Job<CvAnalysisJob>): Promise<void> {
    const db = this.prisma.db;
    const analysis = await db.cvAnalysis.findFirst({ where: { id: job.data.analysisId } });
    if (!analysis || analysis.status === 'COMPLETED' || analysis.status === 'SKIPPED') return;
    const file = await db.uploadedFile.findFirst({ where: { id: analysis.fileId, deletedAt: undefined } });
    if (!file) return this.fail(analysis.id, 'FILE_MISSING');

    await db.cvAnalysis.update({
      where: { id: analysis.id },
      data: { status: 'PROCESSING', startedAt: new Date(), error: null },
    });

    try {
      const text = await extractCvText(await this.storage.getBuffer(file.storageKey), file.mimeType);
      const sectors = await db.sector.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
        select: { id: true, code: true, nameEn: true, nameAr: true },
      });
      const out = await this.analyzer.analyze({ text, sectors });
      const sector = sectors.find((s) => s.code === out.result.sectorCode) ?? null;
      await db.cvAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: 'COMPLETED',
          model: out.model,
          suggestedSectorId: sector?.id ?? null,
          skills: out.result.skills,
          inferredYears: out.result.inferredYears,
          tipsAr: out.result.tipsAr,
          tipsEn: out.result.tipsEn,
          inputTokens: out.inputTokens,
          outputTokens: out.outputTokens,
          completedAt: new Date(),
          error: null,
        },
      });
      await this.matching
        .add(
          PROFILE_UPDATED_JOB,
          { seekerId: analysis.seekerId, reason: 'cv-analysis', at: new Date().toISOString() },
          { jobId: `profile-${analysis.seekerId}`, delay: 3000, removeOnComplete: true, removeOnFail: 1000 },
        )
        .catch(() => undefined);
      this.logger.log(`Analysis ${analysis.id} completed`);
    } catch (err) {
      const code = err instanceof CvTextError || err instanceof CvAnalysisError ? err.code : 'UNEXPECTED';
      const retryable = err instanceof CvAnalysisError ? err.retryable : !(err instanceof CvTextError);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      if (!retryable || lastAttempt) {
        await this.fail(analysis.id, code);
        this.logger.warn(`Analysis ${analysis.id} failed: ${code}`);
        throw new UnrecoverableError(code);
      }
      await db.cvAnalysis.update({ where: { id: analysis.id }, data: { status: 'PENDING', error: code } });
      this.logger.warn(`Analysis ${analysis.id} will be retried: ${code}`);
      throw err instanceof Error ? err : new Error(code);
    }
  }

  private async fail(id: string, code: string): Promise<void> {
    await this.prisma.db.cvAnalysis.update({
      where: { id },
      data: { status: 'FAILED', error: code, completedAt: new Date() },
    });
  }
}
