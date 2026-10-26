'use client';

import { useTranslations } from 'next-intl';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { logout } from '@/lib/auth-store';
import { homeFor, navFor } from '@/lib/roles';
import { useAuth } from '@/lib/use-auth';
import { Button, ButtonLink, Logo, useToast } from '@/components/ui';
import { LanguageSwitch } from './LanguageSwitch';

/** App header (prototype .app-h): brand, language switch, login/logout, role navigation. */
export function Header() {
  const t = useTranslations();
  const { status, user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const toast = useToast();
  const signedIn = status === 'authenticated' && user;
  const nav = signedIn && !user.mustChangePassword ? navFor(user.role) : [];
  const onAuthPage = pathname === '/login';

  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto max-w-container px-4 md:px-6">
        <div className="flex min-h-16 items-center justify-between gap-3">
          <Link
            href={signedIn ? homeFor(user.role) : '/'}
            className="flex min-h-touch items-center gap-2.5 text-xl font-bold text-text no-underline"
          >
            <Logo />
            <span className="leading-tight">
              {t('common.brand')}
              <small className="hidden text-xs font-normal text-text-muted min-[480px]:block">
                {t('common.tagline')}
              </small>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitch />
            {signedIn ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await logout();
                  toast(t('auth.loggedOut'));
                  router.replace('/');
                }}
              >
                {t('common.logout')}
              </Button>
            ) : (
              status === 'anonymous' &&
              !onAuthPage && (
                <ButtonLink href="/login" variant="ghost" size="sm">
                  {t('common.login')}
                </ButtonLink>
              )
            )}
          </div>
        </div>
        {nav.length > 0 && (
          <nav aria-label={t('common.mainNav')} className="flex flex-wrap gap-1 pb-2">
            {nav.map((item) => {
              // Sub-pages light up their section (/admin/users/x -> Users); role homes match exactly.
              const active =
                pathname === item.href ||
                (item.href.split('/').length > 2 && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex min-h-touch items-center rounded-md px-3 py-1.5 text-[15px] font-medium no-underline ${
                    active
                      ? 'bg-primary-soft font-semibold text-primary'
                      : 'text-text-muted hover:bg-surface-2 hover:text-text'
                  }`}
                >
                  {t(`nav.${item.labelKey}`)}
                </Link>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
