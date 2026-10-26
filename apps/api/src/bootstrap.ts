import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { createValidationPipe } from './common/validation';

/** Shared HTTP setup for main.ts and the e2e/integration tests. */
export function configureApp(app: INestApplication): void {
  const express = app as NestExpressApplication;
  // Requests arrive through the web container (Next.js proxy) on the private Docker network.
  express.set('trust proxy', 'loopback, linklocal, uniquelocal');
  express.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.useGlobalPipes(createValidationPipe());
  app.enableShutdownHooks();
}
