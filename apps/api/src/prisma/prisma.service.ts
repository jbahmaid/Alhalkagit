import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { AppConfig } from '../config/app-config';
import { APP_CONFIG } from '../config/config.module';
import { CTX, RequestContext } from '../common/request-context';
import {
  AuditActor,
  AuditContextProvider,
  AuditedClient,
  AuditedTx,
  createAuditedClient,
} from './audited-client';

export function clsAuditContext(cls: ClsService<RequestContext>): AuditContextProvider {
  const get = <T>(key: string): T | undefined => (cls.isActive() ? (cls.get(key as any) as T) : undefined);
  return {
    actor: (): AuditActor => ({
      userId: get<string>(CTX.userId) ?? null,
      role: get(CTX.role) ?? null,
      ip: get<string>(CTX.ip) ?? null,
      userAgent: get<string>(CTX.userAgent) ?? null,
      requestId: get<string>(CTX.requestId) ?? null,
    }),
    tx: () => get(CTX.tx),
    hardDeleteAllowed: () => get<boolean>(CTX.hardDelete) === true,
  };
}

/**
 * The only way application code talks to the database. `db` is the audited client;
 * the raw PrismaClient stays private so writes cannot skip the audit trail.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly base: PrismaClient;
  private readonly root: AuditedClient;

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    private readonly cls: ClsService<RequestContext>,
  ) {
    this.base = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
    this.root = createAuditedClient(this.base, clsAuditContext(cls));
  }

  /**
   * The audited client. Inside `tx(...)` this is the transaction client, so services that call
   * `prisma.db` join the surrounding transaction automatically.
   */
  get db(): AuditedClient {
    const tx = this.cls.isActive() ? (this.cls.get(CTX.tx as any) as AuditedClient | undefined) : undefined;
    return tx ?? this.root;
  }

  async onModuleInit(): Promise<void> {
    await this.base.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.base.$disconnect();
  }

  /**
   * Interactive transaction whose audit rows are written inside the same transaction.
   * Nested calls reuse the outer transaction.
   */
  async tx<T>(
    fn: (tx: AuditedTx) => Promise<T>,
    options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
  ): Promise<T> {
    const current = this.cls.isActive() ? (this.cls.get(CTX.tx as any) as AuditedTx | undefined) : undefined;
    if (current) return await fn(current);
    return this.root.$transaction(
      (tx) =>
        this.cls.run({ ifNested: 'inherit' }, async () => {
          this.cls.set(CTX.tx as any, tx);
          // Await here: Prisma queries are lazy and must run inside this CLS context.
          return await fn(tx as unknown as AuditedTx);
        }),
      options,
    );
  }

  /** Runs `fn` with the given actor (for system jobs and the worker). */
  runAs<T>(actor: AuditActor, fn: () => Promise<T>): Promise<T> {
    return this.cls.run({ ifNested: 'inherit' }, async () => {
      for (const [k, v] of Object.entries(actor)) this.cls.set(k as any, v as any);
      return await fn();
    });
  }

  /**
   * Permanent delete of a soft-delete model row, audited as HARD_DELETE.
   * Callers must check the `records.hard_delete` permission first.
   */
  hardDelete<T>(fn: (db: AuditedClient) => Promise<T>): Promise<T> {
    return this.cls.run({ ifNested: 'inherit' }, async () => {
      this.cls.set(CTX.hardDelete as any, true);
      return await fn(this.db);
    });
  }

  async ping(): Promise<boolean> {
    await this.root.$queryRaw`SELECT 1`;
    return true;
  }
}
