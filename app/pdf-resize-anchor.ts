import {
  capturePdfReadingScroll,
  restorePdfReadingScroll,
  type PdfReadingPageGeometry,
  type PdfReadingScrollSnapshot,
  type PdfReadingViewport,
} from './pdf-reading-session-model.ts';

/** Retain a source point while responsive layout changes its page dimensions. */
export function createPdfResizeAnchor() {
  let stable:
    | {
        width: number;
        height: number;
        viewport: PdfReadingViewport;
        pages: PdfReadingPageGeometry[];
        snapshot: PdfReadingScrollSnapshot;
      }
    | undefined;
  let pending: PdfReadingScrollSnapshot | undefined;
  let measured: { width: number; height: number } | undefined;
  const reset = () => {
    stable = undefined;
    pending = undefined;
  };
  return {
    reset,
    interrupt() {
      // Ordinary scrolling keeps the last measured sheet geometry available.
      // Input during a resize cancels the queued correction and its old point.
      if (pending) reset();
    },
    isPending: () => !!pending,
    scroll(
      viewport: Pick<
        PdfReadingViewport,
        'width' | 'height' | 'scrollLeft' | 'scrollTop'
      >,
    ) {
      if (
        !stable ||
        pending ||
        viewport.width !== stable.width ||
        viewport.height !== stable.height
      )
        return;
      stable.viewport = { ...stable.viewport, ...viewport };
      stable.snapshot = capturePdfReadingScroll(stable.viewport, stable.pages);
    },
    measure(
      width: number,
      height: number,
      blocked: boolean,
      scroll?: Pick<PdfReadingViewport, 'scrollLeft' | 'scrollTop'>,
    ) {
      if (blocked) reset();
      else if (
        measured &&
        stable &&
        (width !== measured.width || height !== measured.height)
      )
        pending ??= scroll
          ? capturePdfReadingScroll(
              { ...stable.viewport, ...scroll },
              stable.pages,
            )
          : stable.snapshot;
      measured = { width, height };
    },
    capture(viewport: PdfReadingViewport, pages: PdfReadingPageGeometry[]) {
      if (!pages.length || !viewport.width || !viewport.height) return false;
      // A parent render may expose the new pane box before ResizeObserver has
      // committed its width to the PDF sheets. Do not save that mixed geometry.
      if (
        stable &&
        (viewport.width !== stable.width || viewport.height !== stable.height)
      )
        pending ??= capturePdfReadingScroll(
          {
            ...stable.viewport,
            scrollLeft: viewport.scrollLeft,
            scrollTop: viewport.scrollTop,
          },
          stable.pages,
        );
      if (pending) return false;
      stable = {
        width: viewport.width,
        height: viewport.height,
        viewport: { ...viewport },
        pages: pages.map((page) => ({ ...page })),
        snapshot: capturePdfReadingScroll(viewport, pages),
      };
      return true;
    },
    restore(viewport: PdfReadingViewport, pages: PdfReadingPageGeometry[]) {
      if (!pending || !pages.length) return undefined;
      const position = restorePdfReadingScroll(pending, viewport, pages);
      pending = undefined;
      stable = {
        width: viewport.width,
        height: viewport.height,
        viewport: {
          ...viewport,
          scrollLeft: position.left,
          scrollTop: position.top,
        },
        pages: pages.map((page) => ({ ...page })),
        snapshot: capturePdfReadingScroll(
          {
            ...viewport,
            scrollLeft: position.left,
            scrollTop: position.top,
          },
          pages,
        ),
      };
      return position;
    },
  };
}
