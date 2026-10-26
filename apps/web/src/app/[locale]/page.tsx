import { getTranslations, setRequestLocale } from 'next-intl/server';
import { HomeActions } from '@/components/home/HomeActions';
import { Badge, Card, Icon } from '@/components/ui';

/** S-01 Home. */
export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('home');

  return (
    <>
      <section className="pb-2 pt-4">
        <span className="mb-1 block text-[13px] font-semibold text-accent">
          {(await getTranslations('common'))('tagline')}
        </span>
        <h1 className="m-0 mb-2 max-w-[22ch] text-3xl font-bold leading-snug md:text-[40px]">
          {t('heroTitle')}
        </h1>
        <p className="m-0 max-w-[52ch] text-lg text-text-muted">{t('heroLead')}</p>
        <HomeActions />
      </section>

      <h2 className="mb-0 mt-6 text-xl font-bold">{t('howTitle')}</h2>
      <ol className="my-6 grid list-none gap-3 p-0 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <li key={i}>
            <Card className="h-full">
              <span
                aria-hidden="true"
                className="mb-2 inline-grid h-8 w-8 place-items-center rounded-pill bg-primary-soft font-bold text-primary"
              >
                {i}
              </span>
              <h3 className="m-0 mb-2 text-[17px] font-semibold">{t(`how${i}t`)}</h3>
              <p className="m-0 text-sm text-text-muted">{t(`how${i}`)}</p>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="flex items-start gap-3">
        <span className="text-primary">
          <Icon name="shield" />
        </span>
        <div>
          <h2 className="m-0 mb-2 text-lg font-bold">{t('privacyTitle')}</h2>
          <p className="m-0 text-text-muted">{t('privacyBody')}</p>
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="m-0 mb-2 text-base font-bold">{t('sections')}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="match" icon="check">
            {t('secJobs')} · {t('available')}
          </Badge>
          <Badge variant="muted" icon="clock">
            {t('secSoon')}
          </Badge>
        </div>
      </Card>
    </>
  );
}
