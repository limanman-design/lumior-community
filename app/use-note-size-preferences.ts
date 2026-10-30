'use client';

import { useEffect, useSyncExternalStore } from 'react';
import {
  defaultNoteFitLimits,
  getNoteFitLimits,
  initializeNoteFitLimits,
  noteFitStorageKey,
  setNoteFitLimits,
  subscribeNoteFitLimits,
  synchronizeNoteFitLimits,
  type NoteFitStorage,
} from './note-size-preferences';

const getServerLimits = () => defaultNoteFitLimits;

export function useNoteSizePreferences() {
  const limits = useSyncExternalStore(
    subscribeNoteFitLimits,
    getNoteFitLimits,
    getServerLimits,
  );
  useEffect(() => {
    let storage: NoteFitStorage | undefined;
    try {
      storage = window.localStorage;
    } catch {
      // The core remains usable when storage access is denied.
    }
    initializeNoteFitLimits(storage);
    const synchronize = (event: StorageEvent) => {
      if (event.key !== noteFitStorageKey && event.key !== null) return;
      if (event.storageArea && event.storageArea !== storage) return;
      synchronizeNoteFitLimits(event.newValue);
    };
    window.addEventListener('storage', synchronize);
    return () => window.removeEventListener('storage', synchronize);
  }, []);
  return { limits, setLimits: setNoteFitLimits };
}
