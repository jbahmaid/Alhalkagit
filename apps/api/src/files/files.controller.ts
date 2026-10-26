import { Controller, Get, Inject, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { Errors } from '../common/app-exception';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { contentDisposition } from './file-type';
import { FILE_STORAGE, FileStorage } from './file-storage';
import { FileLinksService } from './file-links.service';

/** Serves a private file for a valid, unexpired signed link. The token itself is the credential. */
@Controller('files')
export class FilesController {
  constructor(
    private readonly links: FileLinksService,
    private readonly prisma: PrismaService,
    @Inject(FILE_STORAGE) private readonly storage: FileStorage,
  ) {}

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Get(':token')
  async download(@Param('token') token: string, @Res() res: Response): Promise<void> {
    const { fileId } = this.links.verify(token);
    const file = await this.prisma.db.uploadedFile.findFirst({ where: { id: fileId } });
    if (!file) throw Errors.notFound('CV_NOT_FOUND');
    const obj = await this.storage.get(file.storageKey);
    res.status(200);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', String(obj.contentLength ?? file.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition(file.originalName));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    await pipeline(obj.body, res);
  }
}
