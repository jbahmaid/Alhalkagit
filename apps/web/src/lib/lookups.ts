'use client';

import type { LookupItemDto, LookupType } from '@sanad/shared';
import { useLocale } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export type Lookups = Partial<Record<LookupType, LookupItemDto[]>>;

const cache = new Map<LookupType, Promise<LookupItemDto[]>>();

function load(type: LookupType): Promise<LookupItemDto[]> {
  let p = cache.get(type);
  if (!p) {
    p = api<LookupItemDto[]>(`/lookups/${type}`, { auth: false });
    // A failed request is not cached, so the next screen tries again.
    p.catch(() => cache.delete(type));
    cache.set(type, p);
  }
  return p;
}

/** Loads the lookup lists a form needs (server order: sortOrder, so Saudi and the Gulf come first). */
export function useLookups(types: LookupType[]): { lists: Lookups; ready: boolean; failed: boolean } {
  const key = types.join(',');
  const [lists, setLists] = useState<Lookups>({});
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    const wanted = key.split(',') as LookupType[];
    Promise.all(wanted.map(load))
      .then((rows) => {
        if (!live) return;
        setLists(Object.fromEntries(wanted.map((t, i) => [t, rows[i]])));
        setState('ready');
      })
      .catch(() => live && setState('failed'));
    return () => {
      live = false;
    };
  }, [key]);
  return { lists, ready: state === 'ready', failed: state === 'failed' };
}

/** Name of a lookup item in the current language. */
export function useLookupName() {
  const locale = useLocale();
  return useCallback(
    (item: Pick<LookupItemDto, 'nameAr' | 'nameEn'> | undefined | null): string =>
      item ? (locale === 'ar' ? item.nameAr : item.nameEn) : '',
    [locale],
  );
}
