import { ThrottlerGuard } from '@nestjs/throttler';
import { ScaledThrottlerGuard } from './scaled-throttler.guard';

describe('ScaledThrottlerGuard', () => {
  afterEach(() => jest.restoreAllMocks());

  function guardWith(factor: number) {
    const guard = Object.create(ScaledThrottlerGuard.prototype) as ScaledThrottlerGuard;
    (guard as any).appConfig = { throttle: { enabled: true, factor } };
    return guard;
  }

  it('multiplies the limit by THROTTLE_FACTOR and keeps the window', async () => {
    const base = jest.spyOn(ThrottlerGuard.prototype as any, 'handleRequest').mockResolvedValue(true);
    await (guardWith(5) as any).handleRequest({ limit: 10, ttl: 60_000 });
    expect(base).toHaveBeenCalledWith(expect.objectContaining({ limit: 50, ttl: 60_000 }));
  });

  it('leaves the limit alone with the default factor', async () => {
    const base = jest.spyOn(ThrottlerGuard.prototype as any, 'handleRequest').mockResolvedValue(true);
    await (guardWith(1) as any).handleRequest({ limit: 10, ttl: 60_000 });
    expect(base).toHaveBeenCalledWith(expect.objectContaining({ limit: 10 }));
  });
});
