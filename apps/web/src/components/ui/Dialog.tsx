'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * Modal built on the native <dialog>: traps focus, closes on Escape, and returns focus to the
 * element that opened it.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      opener.current = document.activeElement;
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        onClose();
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
      className="w-[min(520px,calc(100vw-32px))] rounded-xl border-0 bg-surface p-0 text-text shadow-md backdrop:bg-[rgba(10,20,18,.5)]"
    >
      <div className="p-5">
        <h2 id={titleId} className="m-0 mb-2 text-xl font-bold">
          {title}
        </h2>
        {children}
      </div>
      {footer && <div className="flex flex-wrap justify-end gap-2 px-5 pb-5 pt-3">{footer}</div>}
    </dialog>
  );
}
