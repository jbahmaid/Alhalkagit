import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Readable } from 'node:stream';
import { AppException, Errors } from '../common/app-exception';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { FileStorage, StoredObject, streamToBuffer } from './file-storage';

/** MinIO / S3 storage. The bucket is private; nothing is ever served from it directly. */
@Injectable()
export class S3FileStorage implements FileStorage {
  private readonly logger = new Logger('FileStorage');
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.bucket = config.s3.bucket;
    this.client = new S3Client({
      endpoint: config.s3.endpoint,
      region: config.s3.region,
      forcePathStyle: true,
      credentials: { accessKeyId: config.s3.accessKey, secretAccessKey: config.s3.secretKey },
      // MinIO accepts the default checksums, but keep requests minimal and compatible.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  get bucketName(): string {
    return this.bucket;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.call(() =>
      this.client.send(
        new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
      ),
    );
  }

  async get(key: string): Promise<StoredObject> {
    const out = await this.call(() => this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key })));
    if (!out.Body) throw Errors.notFound('CV_NOT_FOUND');
    return { body: out.Body as Readable, contentLength: out.ContentLength };
  }

  async getBuffer(key: string): Promise<Buffer> {
    return streamToBuffer((await this.get(key)).body);
  }

  async remove(key: string): Promise<void> {
    await this.call(() => this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })));
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const name = (err as { name?: string }).name;
      if (name === 'NoSuchKey' || name === 'NotFound') throw Errors.notFound('CV_NOT_FOUND');
      this.logger.error(`Storage error: ${(err as Error).message}`);
      throw new AppException('STORAGE_UNAVAILABLE', HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
