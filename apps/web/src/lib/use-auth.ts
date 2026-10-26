'use client';

import { useSyncExternalStore } from 'react';
import { getServerState, getState, subscribe, type AuthState } from './auth-store';

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getState, getServerState);
}
