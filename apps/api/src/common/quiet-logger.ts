import { ConsoleLogger } from '@nestjs/common';

/** Nest's start-up chatter would bury the admin password banner in `docker compose logs api`. */
const NOISY = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestFactory',
  'NestApplication',
  'ClsModule',
]);

export class QuietLogger extends ConsoleLogger {
  private quiet(context?: string): boolean {
    return !!context && NOISY.has(context) && process.env.LOG_LEVEL !== 'debug';
  }

  log(message: unknown, context?: string): void {
    if (this.quiet(context)) return;
    super.log(message, context);
  }

  debug(message: unknown, context?: string): void {
    if (this.quiet(context)) return;
    super.debug(message, context);
  }
}
