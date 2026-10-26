import { Prisma } from '@prisma/client';

export interface ModelMeta {
  name: string;
  /** Delegate property on the client, e.g. `user` for User. */
  delegate: string;
  /** Table name in PostgreSQL (used as audit_log.entity). */
  table: string;
  pk: string[];
  softDelete: boolean;
  relations: Map<string, { ownsForeignKey: boolean }>;
}

const lcFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Built once from the generated DMMF, so new models are picked up automatically. */
export const MODEL_META: Record<string, ModelMeta> = Object.fromEntries(
  Prisma.dmmf.datamodel.models.map((m) => {
    const idField = m.fields.find((f) => f.isId);
    const pk = idField ? [idField.name] : [...(m.primaryKey?.fields ?? [])];
    const relations = new Map<string, { ownsForeignKey: boolean }>();
    for (const f of m.fields) {
      if (f.kind === 'object') {
        relations.set(f.name, { ownsForeignKey: (f.relationFromFields?.length ?? 0) > 0 });
      }
    }
    return [
      m.name,
      {
        name: m.name,
        delegate: lcFirst(m.name),
        table: m.dbName ?? m.name,
        pk,
        softDelete: m.fields.some((f) => f.name === 'deletedAt'),
        relations,
      },
    ];
  }),
);

/** Models whose writes are not audited. audit_log itself is append-only. */
export const UNAUDITED_MODELS = new Set(['AuditLog']);

export function pkWhere(meta: ModelMeta, row: Record<string, unknown>): Record<string, unknown> {
  if (meta.pk.length === 1) return { [meta.pk[0]]: row[meta.pk[0]] };
  const compoundKey = meta.pk.join('_');
  return { [compoundKey]: Object.fromEntries(meta.pk.map((k) => [k, row[k]])) };
}

export function pkString(meta: ModelMeta, row: Record<string, unknown> | null | undefined): string | null {
  if (!row) return null;
  const parts = meta.pk.map((k) => row[k]);
  if (parts.some((p) => p === undefined || p === null)) return null;
  return parts.map(String).join(':');
}
