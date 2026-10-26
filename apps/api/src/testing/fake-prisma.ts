/* In-memory stand-in for PrismaService, good enough for auth/permission unit tests. */
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config/app-config';

type Row = Record<string, any>;

function eq(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

export function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined) return true;
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
    if (v === null) return row[k] === null || row[k] === undefined;
    if (typeof v === 'object' && !(v instanceof Date)) {
      const cond = v as Row;
      if ('in' in cond) return (cond.in as unknown[]).some((x) => eq(x, row[k]));
      if ('not' in cond) return !eq(row[k], cond.not);
      if ('gt' in cond) return row[k] > cond.gt;
      if ('lt' in cond) return row[k] < cond.lt;
      return matches(row[k] ?? {}, cond);
    }
    return eq(row[k], v);
  });
}

export class FakeTable {
  rows: Row[] = [];
  private seq = 0;
  constructor(private readonly defaults: () => Row = () => ({})) {}

  private sorted(where?: Row, orderBy?: Row): Row[] {
    const list = this.rows.filter((r) => matches(r, where));
    if (orderBy) {
      const [[field, dir]] = Object.entries(orderBy);
      list.sort((a, b) => {
        const d = +a[field] - +b[field] || a.__seq - b.__seq;
        return dir === 'desc' ? -d : d;
      });
    }
    return list;
  }

  async findFirst(args: Row = {}) {
    return this.sorted(args.where, args.orderBy)[0] ?? null;
  }
  async findUnique(args: Row) {
    return this.findFirst(args);
  }
  async findMany(args: Row = {}) {
    return this.sorted(args.where, args.orderBy);
  }
  async create(args: Row) {
    const row = {
      id: randomUUID(),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...this.defaults(),
      ...args.data,
    };
    Object.defineProperty(row, '__seq', { value: this.seq++, enumerable: false });
    this.rows.push(row);
    return row;
  }
  async update(args: Row) {
    const row = this.rows.find((r) => matches(r, args.where));
    if (!row) throw new Error('Record not found');
    Object.assign(row, args.data, { updatedAt: new Date() });
    return row;
  }
  async updateMany(args: Row) {
    const list = this.rows.filter((r) => matches(r, args.where));
    list.forEach((r) => Object.assign(r, args.data));
    return { count: list.length };
  }
}

export interface FakeAudit {
  action: string;
  entity: string;
  entityId?: string | null;
  after?: unknown;
  actor?: unknown;
}

export function createFakePrisma() {
  const audits: FakeAudit[] = [];
  let actor: Row = {};
  const db = {
    user: new FakeTable(() => ({
      username: null,
      status: 'PENDING_VERIFICATION',
      locale: 'ar',
      failedLoginCount: 0,
      lockedUntil: null,
      mustChangePassword: false,
      isSystemAccount: false,
      emailVerifiedAt: null,
      deletedAt: null,
      person: null,
    })),
    seekerProfile: new FakeTable(() => ({ deletedAt: null })),
    emailVerificationCode: new FakeTable(() => ({ attempts: 0, maxAttempts: 5, consumedAt: null })),
    refreshToken: new FakeTable(() => ({ revokedAt: null, revokeReason: null, replacedById: null })),
    permission: new FakeTable(),
    rolePermission: new FakeTable(),
    userPermission: new FakeTable(),
    async $audit(entry: FakeAudit) {
      audits.push({ ...entry, actor: { ...actor } });
    },
  };
  const prisma = {
    db,
    audits,
    tx: async <T>(fn: (tx: typeof db) => Promise<T>) => fn(db),
    runAs: async <T>(a: Row, fn: () => Promise<T>) => {
      const prev = actor;
      actor = a;
      try {
        return await fn();
      } finally {
        actor = prev;
      }
    },
  };
  return prisma;
}

export const TEST_SECRETS = {
  ID_ENCRYPTION_KEY: 'a'.repeat(64),
  ID_HASH_KEY: 'b'.repeat(64),
  JWT_ACCESS_SECRET: 'c'.repeat(64),
  JWT_REFRESH_SECRET: 'd'.repeat(64),
};

export function testConfig() {
  return loadConfig({ DATABASE_URL: 'postgresql://x:y@localhost:5432/test' }, { secrets: TEST_SECRETS });
}
