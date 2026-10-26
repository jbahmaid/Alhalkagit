'use client';

import type { ProfileDto } from '@sanad/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';

export const PROFILE_PATH = '/seeker/profile';

/** The signed-in seeker's profile (GET /me/profile), with a reload. */
export function useProfile() {
  const [profile, setProfile] = useState<ProfileDto | null>(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(() => {
    setFailed(false);
    api<ProfileDto>('/me/profile')
      .then(setProfile)
      .catch(() => setFailed(true));
  }, []);
  useEffect(reload, [reload]);
  return { profile, setProfile, failed, reload };
}
