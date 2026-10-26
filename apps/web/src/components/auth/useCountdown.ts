'use client';

import { useEffect, useState } from 'react';

/** Seconds left, ticking down to 0. `restart(n)` starts again from n. */
export function useCountdown(initial: number) {
  const [left, setLeft] = useState(Math.max(0, initial));
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return { left, restart: (n: number) => setLeft(Math.max(0, n)) };
}
