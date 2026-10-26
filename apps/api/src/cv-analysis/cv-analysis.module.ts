import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../common/queues';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { AnthropicCvAnalyzer } from './anthropic-cv-analyzer';
import { CV_ANALYZER, CvAnalysisError, CvAnalyzer } from './cv-analyzer';
import { CvAnalysisProcessor } from './cv-analysis.processor';

/** Used when analysis is disabled: jobs are never enqueued then, so this only guards mistakes. */
class DisabledCvAnalyzer implements CvAnalyzer {
  async analyze(): Promise<never> {
    throw new CvAnalysisError('DISABLED', false);
  }
}

/** Worker side of CV analysis (the API only enqueues jobs, see SeekersModule). */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.cvAnalysis }, { name: QUEUES.matching })],
  providers: [
    {
      provide: CV_ANALYZER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): CvAnalyzer =>
        config.cvAnalysis.enabled
          ? AnthropicCvAnalyzer.create(process.env.ANTHROPIC_API_KEY as string, {
              model: config.cvAnalysis.model,
              fallback: config.cvAnalysis.fallback,
            })
          : new DisabledCvAnalyzer(),
    },
    CvAnalysisProcessor,
  ],
})
export class CvAnalysisModule {}
