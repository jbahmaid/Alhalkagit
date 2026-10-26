/* In-memory stand-in for PrismaService, good enough for unit tests (auth, permissions, profile). */
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
      if ('contains' in cond) {
        const hay = String(row[k] ?? '');
        const needle = String(cond.contains);
        return cond.mode === 'insensitive'
          ? hay.toLowerCase().includes(needle.toLowerCase())
          : hay.includes(needle);
      }
      if (['gt', 'gte', 'lt', 'lte'].some((op) => op in cond)) {
        const v0 = row[k];
        return (
          (!('gt' in cond) || v0 > cond.gt) &&
          (!('gte' in cond) || v0 >= cond.gte) &&
          (!('lt' in cond) || v0 < cond.lt) &&
          (!('lte' in cond) || v0 <= cond.lte)
        );
      }
      if ('not' in cond) return !eq(row[k], cond.not);
      return matches(row[k] ?? {}, cond);
    }
    return eq(row[k], v);
  });
}

export class FakeTable {
  rows: Row[] = [];
  private seq = 0;
  constructor(
    private readonly defaults: () => Row = () => ({}),
    /** Mimics the audit extension: reads hide deletedAt rows, delete sets deletedAt. */
    private readonly softDelete = false,
  ) {}

  private visible(where: Row = {}): Row {
    return this.softDelete && !Object.prototype.hasOwnProperty.call(where, 'deletedAt')
      ? { ...where, deletedAt: null }
      : where;
  }

  private sorted(where?: Row, orderBy?: Row | Row[]): Row[] {
    const list = this.rows.filter((r) => matches(r, this.visible(where)));
    const orders = orderBy ? (Array.isArray(orderBy) ? orderBy : [orderBy]) : [];
    list.sort((a, b) => {
      for (const o of orders) {
        const [[field, dir]] = Object.entries(o);
        const d = +a[field] - +b[field];
        if (d) return dir === 'desc' ? -d : d;
      }
      return a.__seq - b.__seq;
    });
    return list;
  }

  async findFirst(args: Row = {}) {
    return this.sorted(args.where, args.orderBy)[0] ?? null;
  }
  async findFirstOrThrow(args: Row = {}) {
    const row = await this.findFirst(args);
    if (!row) throw new Error('No record found');
    return row;
  }
  async count(args: Row = {}) {
    return this.sorted(args.where).length;
  }
  async delete(args: Row) {
    const row = this.rows.find((r) => matches(r, this.visible(args.where)));
    if (!row) throw new Error('Record not found');
    if (this.softDelete) row.deletedAt = new Date();
    else this.rows.splice(this.rows.indexOf(row), 1);
    return row;
  }
  async deleteMany(args: Row = {}) {
    const list = this.sorted(args.where);
    for (const row of list) {
      if (this.softDelete) row.deletedAt = new Date();
      else this.rows.splice(this.rows.indexOf(row), 1);
    }
    return { count: list.length };
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
    const row = this.rows.find((r) => matches(r, this.visible(args.where)));
    if (!row) throw new Error('Record not found');
    Object.assign(row, args.data, { updatedAt: new Date() });
    return row;
  }
  async updateMany(args: Row) {
    const list = this.sorted(args.where);
    list.forEach((r) => Object.assign(r, args.data));
    return { count: list.length };
  }
  /** groupBy with `_count: { _all: true }` only (what the services use). */
  async groupBy(args: Row) {
    const groups = new Map<string, Row>();
    for (const r of this.sorted(args.where)) {
      const key = JSON.stringify((args.by as string[]).map((f) => r[f]));
      const g = groups.get(key) ?? {
        ...Object.fromEntries((args.by as string[]).map((f) => [f, r[f]])),
        _count: { _all: 0 },
      };
      g._count._all += 1;
      groups.set(key, g);
    }
    return [...groups.values()];
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
    seekerProfile: new FakeTable(
      () => ({
        deletedAt: null,
        personId: null,
        completionStep: 'PERSONAL',
        completedAt: null,
        hasExperience: null,
        yearsOfExperience: null,
        currentCvFileId: null,
      }),
      true,
    ),
    person: new FakeTable(
      () => ({ deletedAt: null, darId: null, fakhdhId: null, mobile: null, email: null }),
      true,
    ),
    seekerEducation: new FakeTable(() => ({ deletedAt: null, sortOrder: 0, fieldOfStudy: null }), true),
    experiencePosition: new FakeTable(() => ({ deletedAt: null, organization: null, sectorId: null }), true),
    experienceContact: new FakeTable(() => ({ deletedAt: null, positionId: null }), true),
    uploadedFile: new FakeTable(() => ({ deletedAt: null }), true),
    cvAnalysis: new FakeTable(() => ({
      status: 'PENDING',
      suggestedSectorId: null,
      correctedSectorId: null,
      skills: null,
      inferredYears: null,
      tipsAr: null,
      tipsEn: null,
      completedAt: null,
      error: null,
    })),
    country: new FakeTable(() => ({ deletedAt: null, isActive: true }), true),
    dar: new FakeTable(() => ({ deletedAt: null, isActive: true }), true),
    fakhdh: new FakeTable(() => ({ deletedAt: null, isActive: true, darId: null }), true),
    sector: new FakeTable(() => ({ deletedAt: null, isActive: true }), true),
    educationLevel: new FakeTable(() => ({ deletedAt: null, isActive: true }), true),
    businessType: new FakeTable(() => ({ deletedAt: null, isActive: true }), true),
    employer: new FakeTable(
      () => ({
        deletedAt: null,
        approvalStatus: 'PENDING',
        approvedAt: null,
        approvedById: null,
        rejectionReason: null,
      }),
      true,
    ),
    job: new FakeTable(
      () => ({
        deletedAt: null,
        status: 'OPEN',
        closedOutcome: null,
        hiredSeekerId: null,
        closedAt: null,
        publishedAt: new Date(),
        requiredEducationLevelId: null,
        minYearsExperience: 0,
        employmentType: 'FULL_TIME',
      }),
      true,
    ),
    interestRequest: new FakeTable(() => ({
      status: 'SUBMITTED',
      employerViewedAt: null,
      statusChangedAt: null,
    })),
    matchScore: new FakeTable(() => ({ computedAt: new Date(), breakdown: null })),
    setting: new FakeTable(),
    emailVerificationCode: new FakeTable(() => ({ attempts: 0, maxAttempts: 5, consumedAt: null })),
    refreshToken: new FakeTable(() => ({ revokedAt: null, revokeReason: null, replacedById: null })),
    permission: new FakeTable(),
    rolePermission: new FakeTable(),
    userPermission: new FakeTable(),
    auditLog: new FakeTable(() => ({
      actorUserId: null,
      actorRole: null,
      entityId: null,
      before: null,
      after: null,
      ip: null,
    })),
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
