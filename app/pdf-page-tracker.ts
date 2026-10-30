type PdfPageBounds = { page: number; bottom: number };

export function pdfPageAtScrollTop(pages: PdfPageBounds[], scrollTop: number) {
  let low = 0,
    high = pages.length;
  const threshold = scrollTop + 40;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (pages[middle].bottom > threshold) high = middle;
    else low = middle + 1;
  }
  return pages[low]?.page;
}

// Geometry changes on resize/zoom/page materialization, not on every scroll.
// One passive listener and one frame callback suffice for a long document.
export function trackPdfPage(
  root: HTMLElement,
  onPage: (page: number) => void,
  shouldTrack: () => boolean,
  axis: 'vertical' | 'horizontal' = 'vertical',
) {
  let pages: PdfPageBounds[] = [],
    dirty = true;
  let frame: number | undefined;
  const queue = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (dirty) {
        pages = Array.from(
          root.querySelectorAll<HTMLElement>('[data-pdf-page]'),
        ).map((sheet) => ({
          page: Number(sheet.dataset.pdfPage),
          bottom: axis === 'horizontal'
            ? sheet.offsetLeft + sheet.offsetWidth
            : sheet.offsetTop + sheet.offsetHeight,
        }));
        dirty = false;
      }
      if (!shouldTrack()) return;
      const page = pdfPageAtScrollTop(pages, axis === 'horizontal' ? root.scrollLeft : root.scrollTop);
      if (page !== undefined) onPage(page);
    });
  };
  const resized = () => {
    dirty = true;
    queue();
  };
  const observer =
    typeof ResizeObserver === 'undefined'
      ? undefined
      : new ResizeObserver(resized);
  observer?.observe(root);
  for (const sheet of root.querySelectorAll<HTMLElement>('[data-pdf-page]'))
    observer?.observe(sheet);
  root.addEventListener('scroll', queue, { passive: true });
  queue();
  return () => {
    observer?.disconnect();
    root.removeEventListener('scroll', queue);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
