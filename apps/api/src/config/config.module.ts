import { DynamicModule, Global, Module } from '@nestjs/common';
import { AppConfig, loadConfig } from './app-config';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class AppConfigModule {
  /**
   * The API owns the secrets file (generateMissingSecrets: true); the worker only reads it.
   */
  static forRoot(opts: { generateMissingSecrets: boolean }): DynamicModule {
    return {
      module: AppConfigModule,
      providers: [
        {
          provide: APP_CONFIG,
          useFactory: (): AppConfig =>
            loadConfig(process.env, { generateMissingSecrets: opts.generateMissingSecrets }),
        },
      ],
      exports: [APP_CONFIG],
    };
  }
}
