import { Global, Module } from '@nestjs/common';
import { FILE_STORAGE } from './file-storage';
import { FileLinksService } from './file-links.service';
import { FilesController } from './files.controller';
import { S3FileStorage } from './s3-file-storage';

/** Private file storage and signed download links (architecture: files module). */
@Global()
@Module({
  controllers: [FilesController],
  providers: [{ provide: FILE_STORAGE, useClass: S3FileStorage }, FileLinksService],
  exports: [FILE_STORAGE, FileLinksService],
})
export class FilesModule {}

/** Worker side: storage only (no HTTP controller). */
@Global()
@Module({
  providers: [{ provide: FILE_STORAGE, useClass: S3FileStorage }],
  exports: [FILE_STORAGE],
})
export class FileStorageModule {}
