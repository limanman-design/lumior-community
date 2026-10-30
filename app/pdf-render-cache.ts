// Bound retained raster data by both page count and actual pixel memory.
// A high zoom page must not evict an unbounded amount of browser memory.
export function createPdfRenderCache<T>(
  dispose: (value: T) => void,
  maxPixels = 18_000_000,
  maxEntries = 20,
) {
  const entries = new Map<string, { value: T; pixels: number }>();
  let pixels = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    pixels -= entry.pixels;
    dispose(entry.value);
  };
  return {
    get(key: string) {
      const entry = entries.get(key);
      if (!entry) return;
      entries.delete(key);
      entries.set(key, entry);
      return entry.value;
    },
    set(key: string, value: T, size: number) {
      remove(key);
      entries.set(key, { value, pixels: Math.max(0, size) });
      pixels += Math.max(0, size);
      while (entries.size > maxEntries || pixels > maxPixels) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        remove(oldest);
      }
    },
    clear() {
      for (const key of entries.keys()) remove(key);
    },
    delete(key: string) {
      remove(key);
    },
    get size() {
      return entries.size;
    },
    get pixels() {
      return pixels;
    },
  };
}
