import type { ReactNode } from 'react';

/** Label / value list (prototype .kv). */
export function Kv({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(110px,40%)_1fr] gap-x-3 gap-y-2 text-[15px]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-text-muted">{k}</dt>
          <dd className="m-0 min-w-0 font-medium [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
