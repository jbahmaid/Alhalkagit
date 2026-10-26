import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  async health(): Promise<{ status: 'ok'; db: 'up' }> {
    try {
      await this.prisma.ping();
    } catch {
      throw new HttpException(
        { statusCode: 503, code: 'API_UNAVAILABLE', message: 'Database unavailable' },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { status: 'ok', db: 'up' };
  }
}
