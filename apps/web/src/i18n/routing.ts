import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always',
  // Arabic is the default for everyone; English only via the switch or an /en link.
  localeDetection: false,
});

export type AppLocale = (typeof routing.locales)[number];
