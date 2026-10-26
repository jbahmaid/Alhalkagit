'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * Page title block. The h1 receives focus when the page mounts, so screen-reader users hear the
 * new page after client-side navigation (design principle 7).
 */
export function PageHeader({
  title,
  lead,
  eyebrow,
}: {
  title: ReactNode;
  lead?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="mb-5">
      {eyebrow && <span className="mb-1 block text-[13px] font-semibold text-accent">{eyebrow}</span>}
      <h1
        ref={ref}
        tabIndex={-1}
        className="m-0 mb-2 text-2xl font-bold leading-snug outline-none md:text-3xl"
      >
        {title}
      </h1>
      {lead && <p className="m-0 text-text-muted">{lead}</p>}
    </div>
  );
}
