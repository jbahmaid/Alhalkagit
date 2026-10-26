'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './Icon';

type ToastKind = 'success' | 'error' | 'info';
type ToastState = { id: number; message: string; kind: ToastKind } | null;

const ToastContext = createContext<(message: string, kind?: ToastKind) => void>(() => {});

/** Shows a short message in an aria-live region (always mounted so announcements are reliable). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((message: string, kind: ToastKind = 'success') => {
    setToast({ id: Date.now(), message, kind });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 4200);
  }, []);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`fixed inset-x-4 bottom-4 z-[60] mx-auto flex max-w-[480px] items-center gap-2.5 rounded-md bg-text px-4 py-3 text-bg shadow-md transition-transform duration-200 motion-reduce:transition-none ${
          toast ? 'visible translate-y-0' : 'invisible translate-y-[150%]'
        }`}
      >
        {toast && (
          <>
            <Icon name={toast.kind === 'error' ? 'warn' : toast.kind === 'info' ? 'info' : 'check'} />
            <span>{toast.message}</span>
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
