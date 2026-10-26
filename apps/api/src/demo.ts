/**
 * Demo data command (same image as the API):
 *   node dist/demo.js seed     adds the demo data (idempotent); runs on start when SEED_DEMO=true
 *   node dist/demo.js remove   removes every @demo.sanad.local account and its data
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { QuietLogger } from './common/quiet-logger';
import { DemoModule } from './demo/demo.module';
import { DemoSeedService } from './demo/demo-seed.service';

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd !== 'seed' && cmd !== 'remove') {
    console.error('usage: node dist/demo.js seed | remove');
    process.exit(2);
  }
  const app = await NestFactory.createApplicationContext(DemoModule, { logger: new QuietLogger() });
  try {
    const demo = app.get(DemoSeedService);
    if (cmd === 'seed') await demo.seed();
    else await demo.remove();
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[demo] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
