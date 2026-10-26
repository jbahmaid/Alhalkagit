import { Inject, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { ThrottlerRequest } from '@nestjs/throttler';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';

/**
 * The rate limiter, keyed on the caller's IP, with every limit multiplied by THROTTLE_FACTOR.
 * Some networks show all their users to the server as one IP (Docker Desktop port forwarding,
 * an office NAT); raising the factor keeps a room of demo users from sharing one small budget,
 * while the per-account lockout still stops password guessing.
 */
@Injectable()
export class ScaledThrottlerGuard extends ThrottlerGuard {
  @Inject(APP_CONFIG) private readonly appConfig!: AppConfig;

  protected override handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const factor = this.appConfig?.throttle.factor ?? 1;
    return super.handleRequest(
      factor > 1 ? { ...requestProps, limit: requestProps.limit * factor } : requestProps,
    );
  }
}
