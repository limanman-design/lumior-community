export type NoteFitLimits = { minHeight: number; maxHeight: number };

export const defaultNoteFitLimits: NoteFitLimits = Object.freeze({
  minHeight: 120,
  maxHeight: 800,
});
export const noteFitHeightRange = Object.freeze({ min: 120, max: 2400 });
export const noteFitStorageKey = 'lumior.note-fit-limits.v1';

// An injected storage interface keeps the core independent of React and the DOM.
export type NoteFitStorage = Pick<Storage, 'getItem' | 'setItem'>;
let currentLimits = defaultNoteFitLimits;
let storage: NoteFitStorage | undefined;
let initialized = false;
const listeners = new Set<() => void>();

function hasIntegerHeights(value: unknown): value is NoteFitLimits {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<NoteFitLimits>;
  return (
    typeof candidate.minHeight === 'number' &&
    Number.isInteger(candidate.minHeight) &&
    typeof candidate.maxHeight === 'number' &&
    Number.isInteger(candidate.maxHeight)
  );
}

export function isNoteFitLimits(value: unknown): value is NoteFitLimits {
  return (
    hasIntegerHeights(value) &&
    value.minHeight >= noteFitHeightRange.min &&
    value.maxHeight <= noteFitHeightRange.max &&
    value.minHeight <= value.maxHeight
  );
}

/** Recover a safe pair from storage; malformed/non-integer data uses defaults. */
export function normalizeNoteFitLimits(value: unknown): NoteFitLimits {
  if (!hasIntegerHeights(value)) return defaultNoteFitLimits;
  const bound = (height: number) =>
    Math.max(noteFitHeightRange.min, Math.min(noteFitHeightRange.max, height));
  const first = bound(value.minHeight);
  const second = bound(value.maxHeight);
  return {
    minHeight: Math.min(first, second),
    maxHeight: Math.max(first, second),
  };
}

/** Only height is returned: callers retain the note's width and content. */
export function clampNoteContentHeight(
  measured: number,
  limits: NoteFitLimits = defaultNoteFitLimits,
): number {
  const safe = normalizeNoteFitLimits(limits);
  const height = Number.isFinite(measured)
    ? Math.ceil(measured)
    : safe.minHeight;
  return Math.max(safe.minHeight, Math.min(safe.maxHeight, height));
}

export function getNoteFitLimits(): NoteFitLimits {
  return currentLimits;
}

export function subscribeNoteFitLimits(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(limits: NoteFitLimits) {
  if (
    limits.minHeight === currentLimits.minHeight &&
    limits.maxHeight === currentLimits.maxHeight
  )
    return;
  currentLimits = Object.freeze({
    minHeight: limits.minHeight,
    maxHeight: limits.maxHeight,
  });
  for (const listener of listeners) listener();
}

/** Invalid settings are rejected as a pair, without changing or saving state. */
export function setNoteFitLimits(limits: NoteFitLimits): boolean {
  if (!isNoteFitLimits(limits)) return false;
  try {
    storage?.setItem(
      noteFitStorageKey,
      JSON.stringify({
        minHeight: limits.minHeight,
        maxHeight: limits.maxHeight,
      }),
    );
  } catch {
    // A blocked/full storage area still permits a preference for this session.
  }
  publish(limits);
  return true;
}

export function synchronizeNoteFitLimits(serialized: string | null) {
  let value: unknown;
  try {
    value = serialized === null ? undefined : JSON.parse(serialized);
  } catch {
    value = undefined;
  }
  publish(normalizeNoteFitLimits(value));
}

/** Called after mounting, so neither SSR nor the hydration snapshot reads storage. */
export function initializeNoteFitLimits(preferenceStorage?: NoteFitStorage) {
  if (initialized) return;
  initialized = true;
  storage = preferenceStorage;
  if (!storage) return;
  try {
    synchronizeNoteFitLimits(storage.getItem(noteFitStorageKey));
  } catch {
    // Retain the stable default when browser storage is unavailable.
  }
}
