import { useTranslations } from 'next-intl';
import { ButtonLink, EmptyState } from '@/components/ui';

export default function NotFound() {
  const t = useTranslations('notFound');
  return (
    <EmptyState
      icon="info"
      title={t('title')}
      body={t('body')}
      action={<ButtonLink href="/">{t('home')}</ButtonLink>}
    />
  );
}
