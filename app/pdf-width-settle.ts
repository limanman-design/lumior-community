// Keep layout responsive while holding the expensive raster/text scale steady.
// A trailing delay spans resize/slide frames; pointer resizing waits for release.
export function createPdfWidthSettler(
  commit: (width: number) => void,
  isDragging: () => boolean = () => false,
  delay = 140,
) {
  let timer: ReturnType<typeof setTimeout> | undefined,
    latest = 0,
    previous = 0;
  const settle = () => {
    if (isDragging()) {
      timer = setTimeout(settle, delay);
      return;
    }
    timer = undefined;
    if (latest !== previous) {
      previous = latest;
      commit(latest);
    }
  };
  return {
    update(width: number) {
      if (width <= 0 || !Number.isFinite(width)) return;
      if (width === latest && timer !== undefined) return;
      latest = width;
      clearTimeout(timer);
      timer = setTimeout(settle, delay);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}
