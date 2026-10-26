import { HttpStatus } from '@nestjs/common';
import { AuditAction, Prisma, PrismaClient, UserRole } from '@prisma/client';
import { AppException } from '../common/app-exception';
import { maskForAudit } from '../audit/mask';
import { MODEL_META, ModelMeta, pkString, UNAUDITED_MODELS } from './model-meta';

/**
 * Audited Prisma client (architecture section 9, docs/database.md sections 5 and 6).
 *
 * Every create / update / upsert / delete / *Many write on every model except audit_log goes
 * through this extension, which writes one audit_log row per affected record with the actor,
 * role, action, table, record id, IP, user agent and masked before/after values.
 *
 * Also enforced here, so ordinary service code cannot bypass auditing:
 *  - soft delete: `delete`/`deleteMany` on models with `deletedAt` set the column instead
 *    (audited as DELETE); a real delete needs PrismaService.hardDelete (audited as HARD_DELETE);
 *  - reads on soft-delete models get `deletedAt: null` unless the query mentions `deletedAt`;
 *  - nested relation writes are rejected (they would not reach the per-model hook);
 *  - raw write queries ($executeRaw*) are rejected; $queryRaw (reports views) is allowed;
 *  - audit_log rows can only be created (the DB triggers block the rest as well).
 */

export interface AuditActor {
  userId?: string | null;
  role?: UserRole | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditContextProvider {
  actor(): AuditActor;
  /** Current interactive transaction (extended client), if any. */
  tx(): unknown;
  hardDeleteAllowed(): boolean;
}

const READ_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
]);

const NESTED_WRITE_KEYS = new Set([
  'create',
  'createMany',
  'connectOrCreate',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
  'set',
]);

type Row = Record<string, unknown>;
type AnyDelegate = Record<string, (args?: any) => Promise<any>>;

export interface AuditEntry {
  action: AuditAction;
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

function nestedWriteError(model: string, field: string): AppException {
  return new AppException(
    'INTERNAL_ERROR',
    HttpStatus.INTERNAL_SERVER_ERROR,
    undefined,
    `Nested write on ${model}.${field} is not allowed: write each model separately so it is audited.`,
  );
}

/** Rejects relation writes other than connect/disconnect on a foreign key this model owns. */
export function assertNoNestedWrites(meta: ModelMeta, data: unknown): void {
  if (!data || typeof data !== 'object') return;
  const rows = Array.isArray(data) ? data : [data];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row as Row)) {
      const rel = meta.relations.get(key);
      if (!rel || value === undefined) continue;
      const ops = Object.keys((value ?? {}) as Row);
      const onlyConnect = ops.every((op) => op === 'connect' || op === 'disconnect');
      if (!rel.ownsForeignKey || !onlyConnect || ops.some((op) => NESTED_WRITE_KEYS.has(op))) {
        throw nestedWriteError(meta.name, key);
      }
    }
  }
}

function withSoftDeleteFilter(meta: ModelMeta, args: any): any {
  if (!meta.softDelete) return args;
  const where = args?.where;
  if (where && Object.prototype.hasOwnProperty.call(where, 'deletedAt')) return args;
  return { ...(args ?? {}), where: { ...(where ?? {}), deletedAt: null } };
}

/** `where` that matches soft-deleted rows too (the read hook skips filtering when the key exists). */
function unfiltered(meta: ModelMeta, where: Row | undefined): Row {
  return meta.softDelete ? { ...(where ?? {}), deletedAt: undefined } : { ...(where ?? {}) };
}

function writeAction(meta: ModelMeta, before: Row | null, after: Row | null): AuditAction {
  if (!before) return AuditAction.CREATE;
  if (meta.softDelete && after) {
    if (before.deletedAt == null && after.deletedAt != null) return AuditAction.DELETE;
    if (before.deletedAt != null && after.deletedAt == null) return AuditAction.RESTORE;
  }
  return AuditAction.UPDATE;
}

function pkFilter(meta: ModelMeta, rows: Row[]): Row {
  if (meta.pk.length === 1) return { [meta.pk[0]]: { in: rows.map((r) => r[meta.pk[0]]) } };
  return { OR: rows.map((r) => Object.fromEntries(meta.pk.map((k) => [k, r[k]]))) };
}

export function createAuditedClient(base: PrismaClient, ctx: AuditContextProvider) {
  // Hooks only run after `self` is assigned below, so they can call back into the extended client.
  const client = (): any => (ctx.tx() as any) ?? self;
  const delegate = (meta: ModelMeta): AnyDelegate => client()[meta.delegate];

  async function writeAudit(entries: AuditEntry[]): Promise<void> {
    if (!entries.length) return;
    const actor = ctx.actor();
    const data = entries.map((e) => ({
      actorUserId: actor.userId ?? null,
      actorRole: actor.role ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId ?? null,
      before: (maskForAudit(e.before) ?? Prisma.DbNull) as Prisma.InputJsonValue,
      after: (maskForAudit(e.after) ?? Prisma.DbNull) as Prisma.InputJsonValue,
      ip: actor.ip?.slice(0, 45) ?? null,
      userAgent: actor.userAgent?.slice(0, 512) ?? null,
      requestId: actor.requestId ?? null,
    }));
    if (data.length === 1) await client().auditLog.create({ data: data[0] });
    else await client().auditLog.createMany({ data });
  }

  async function readOne(meta: ModelMeta, where: Row): Promise<Row | null> {
    return delegate(meta).findFirst({ where: unfiltered(meta, where) });
  }

  async function readMany(meta: ModelMeta, where: Row | undefined): Promise<Row[]> {
    return delegate(meta).findMany({ where: unfiltered(meta, where) });
  }

  /** Re-read affected rows by primary key and write one audit row each. */
  async function auditRows(meta: ModelMeta, beforeRows: Row[], afterKeys: Row[], force?: AuditAction) {
    if (!afterKeys.length && !beforeRows.length) return;
    const afterRows = afterKeys.length ? await readMany(meta, pkFilter(meta, afterKeys)) : [];
    const beforeById = new Map(beforeRows.map((r) => [pkString(meta, r), r]));
    await writeAudit(
      afterRows.map((after) => {
        const before = beforeById.get(pkString(meta, after)) ?? null;
        return {
          action: force ?? writeAction(meta, before, after),
          entity: meta.table,
          entityId: pkString(meta, after),
          before,
          after,
        };
      }),
    );
  }

  async function handleWrite(meta: ModelMeta, operation: string, args: any, query: (a: any) => Promise<any>) {
    switch (operation) {
      case 'create': {
        assertNoNestedWrites(meta, args.data);
        const result = await query(args);
        const key = result && pkString(meta, result) ? result : await keyFromData(meta, args.data);
        await auditRows(meta, [], key ? [key] : [], AuditAction.CREATE);
        return result;
      }
      case 'createManyAndReturn': {
        assertNoNestedWrites(meta, args.data);
        const { select: _select, omit: _omit, include: _include, ...rest } = args;
        const rows: Row[] = await query(rest);
        await auditRows(meta, [], rows, AuditAction.CREATE);
        if (!args.select && !args.omit) return rows;
        return delegate(meta).findMany({
          where: unfiltered(meta, pkFilter(meta, rows)),
          select: args.select,
          omit: args.omit,
        });
      }
      case 'createMany': {
        // Converted so every created row gets its own audit entry.
        const rows: Row[] = await delegate(meta).createManyAndReturn({
          data: args.data,
          skipDuplicates: args.skipDuplicates,
        });
        return { count: rows.length };
      }
      case 'update': {
        assertNoNestedWrites(meta, args.data);
        const before = await readOne(meta, args.where);
        const result = await query(args);
        if (before) await auditRows(meta, [before], [before]);
        return result;
      }
      case 'upsert': {
        assertNoNestedWrites(meta, args.create);
        assertNoNestedWrites(meta, args.update);
        const before = await readOne(meta, args.where);
        const result = await query(args);
        const key = before ?? (result && pkString(meta, result) ? result : await readOne(meta, args.where));
        if (key) await auditRows(meta, before ? [before] : [], [key]);
        return result;
      }
      case 'updateMany':
      case 'updateManyAndReturn': {
        assertNoNestedWrites(meta, args.data);
        const beforeRows = await readMany(meta, args.where);
        const result = await query(args);
        await auditRows(meta, beforeRows, beforeRows);
        return result;
      }
      case 'delete': {
        if (meta.softDelete && !ctx.hardDeleteAllowed()) {
          const { where, ...shape } = args;
          return delegate(meta).update({ where, data: { deletedAt: new Date() }, ...shape });
        }
        const before = await readOne(meta, args.where);
        const result = await query(args);
        if (before) {
          await writeAudit([
            {
              action: meta.softDelete ? AuditAction.HARD_DELETE : AuditAction.DELETE,
              entity: meta.table,
              entityId: pkString(meta, before),
              before,
              after: null,
            },
          ]);
        }
        return result;
      }
      case 'deleteMany': {
        if (meta.softDelete && !ctx.hardDeleteAllowed()) {
          return delegate(meta).updateMany({
            where: { ...(args?.where ?? {}), deletedAt: null },
            data: { deletedAt: new Date() },
          });
        }
        const beforeRows = await readMany(meta, args?.where);
        const result = await query(args);
        await writeAudit(
          beforeRows.map((before) => ({
            action: meta.softDelete ? AuditAction.HARD_DELETE : AuditAction.DELETE,
            entity: meta.table,
            entityId: pkString(meta, before),
            before,
            after: null,
          })),
        );
        return result;
      }
      default:
        return query(args);
    }
  }

  /** When a create used `select` without the primary key, find the row by its unique data. */
  async function keyFromData(meta: ModelMeta, data: Row): Promise<Row | null> {
    const where = Object.fromEntries(meta.pk.map((k) => [k, data?.[k]]));
    if (Object.values(where).every((v) => v !== undefined)) return where;
    return null;
  }

  const self: any = base.$extends({
    name: 'sanad-audit',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const meta = MODEL_META[model];
          if (!meta) return query(args);
          if (READ_OPS.has(operation)) return query(withSoftDeleteFilter(meta, args));
          if (UNAUDITED_MODELS.has(model)) {
            if (operation !== 'create' && operation !== 'createMany') {
              throw new AppException(
                'FORBIDDEN',
                HttpStatus.FORBIDDEN,
                undefined,
                'audit_log is append-only',
              );
            }
            return query(args);
          }
          return handleWrite(meta, operation, args, query);
        },
      },
      async $executeRaw() {
        throw new AppException('RAW_WRITE_FORBIDDEN', HttpStatus.INTERNAL_SERVER_ERROR);
      },
      async $executeRawUnsafe() {
        throw new AppException('RAW_WRITE_FORBIDDEN', HttpStatus.INTERNAL_SERVER_ERROR);
      },
    },
    client: {
      /** Explicit audit events (LOGIN, LOGIN_FAILED, LOGOUT, EMAIL_VERIFIED, PASSWORD_RESET, ...). */
      async $audit(entry: AuditEntry): Promise<void> {
        await writeAudit([entry]);
      },
    },
  });
  return self as AuditedClient;
}

/** Never called: only gives the extended client its static type. */
function _clientTypeOf(c: PrismaClient) {
  return c.$extends({ client: { async $audit(_entry: AuditEntry): Promise<void> {} } });
}

export type AuditedClient = ReturnType<typeof _clientTypeOf>;
export type AuditedTx = Omit<
  AuditedClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends' | '$use'
>;
