import { useTranslations } from 'next-intl';

export function Footer() {
  const t = useTranslations('common');
  return (
    <footer className="border-t border-border py-4 text-[13px] text-text-muted">
      <div className="mx-auto max-w-container px-4 md:px-6">{t('footer')}</div>
    </footer>
  );
}
