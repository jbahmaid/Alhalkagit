'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { usePathname, useRouter } from '@/i18n/navigation';
import { api } from '@/lib/api';
import { getState } from '@/lib/auth-store';
import { buttonClasses } from '@/components/ui';

/** Switches ar <-> en on the same page (path and query kept). Saves the choice for signed-in users. */
export function LanguageSwitch() {
  const t = useTranslations('common');
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = locale === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      lang={next}
      aria-label={t('langAria')}
      disabled={pending}
      className={buttonClasses('secondary', 'sm')}
      onClick={() => {
        const query = typeof window !== 'undefined' ? window.location.search : '';
        startTransition(() => router.replace(`${pathname}${query}`, { locale: next }));
        if (getState().status === 'authenticated') {
          api('/me', { method: 'PATCH', body: { locale: next } }).catch(() => undefined);
        }
      }}
    >
      {t('langBtn')}
    </button>
  );
}
