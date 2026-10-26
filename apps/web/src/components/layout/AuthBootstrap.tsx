'use client';

import { useEffect } from 'react';
import { initAuth } from '@/lib/auth-store';

/** Restores the session once per page load (silent refresh through the HttpOnly cookie). */
export function AuthBootstrap() {
  useEffect(() => {
    void initAuth();
  }, []);
  return null;
}
