export type PdfReadingPageGeometry = {
  page: number;
  left: number;
  top: number;
  width: number;
  height: number;
};

export type PdfReadingViewport = {
  scrollLeft: number;
  scrollTop: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  horizontal?: boolean;
};

export type PdfReadingScrollSnapshot = {
  scrollLeft: number;
  scrollTop: number;
  anchor?: { page: number; fractionX: number; fractionY: number };
};

export type PdfReadingSessionSnapshot = PdfReadingScrollSnapshot & {
  page: number;
  zoom: number;
  translationOpen: boolean;
  translation?: PdfReadingScrollSnapshot;
  // Preserve true dimensions of previously visited pages across a remount.
  pageRatios?: Record<number, number>;
};

const finite = (value: number, fallback = 0) =>
  Number.isFinite(value) ? value : fallback;
const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, finite(value, minimum)));
const reference = (viewport: PdfReadingViewport) => ({
  x: Math.max(0, viewport.width) / 2,
  y: Math.min(120, Math.max(0, viewport.height) / 4),
});

export function pdfReadingRestoreState(
  snapshot: PdfReadingSessionSnapshot | undefined,
  total: number,
  focus: { page?: number; markPage?: number; requested?: boolean } = {},
) {
  const explicit = focus.page !== undefined ||
    focus.markPage !== undefined || !!focus.requested;
  return {
    page: Math.round(clamp(
      focus.markPage ?? focus.page ?? snapshot?.page ?? 1,
      1,
      Math.max(1, finite(total, 1)),
    )),
    zoom: clamp(snapshot?.zoom ?? 1, 0.5, 4),
    restoreScroll: !!snapshot && !explicit,
  };
}

/** Store a point inside the visible page, rather than a document-wide ratio. */
export function capturePdfReadingScroll(
  viewport: PdfReadingViewport,
  pages: PdfReadingPageGeometry[],
): PdfReadingScrollSnapshot {
  const offset = reference(viewport);
  const point = {
    x: viewport.scrollLeft + offset.x,
    y: viewport.scrollTop + offset.y,
  };
  const valid = pages.filter(page => page.width > 0 && page.height > 0);
  const sheet = valid.find(page => viewport.horizontal
    ? page.left + page.width > point.x
    : page.top + page.height > point.y) || valid.at(-1);
  return {
    scrollLeft: Math.max(0, finite(viewport.scrollLeft)),
    scrollTop: Math.max(0, finite(viewport.scrollTop)),
    ...(sheet ? {
      anchor: {
        page: sheet.page,
        fractionX: clamp((point.x - sheet.left) / sheet.width, 0, 1),
        fractionY: clamp((point.y - sheet.top) / sheet.height, 0, 1),
      },
    } : {}),
  };
}

/** Keep the same page point visible after zoom, pane or window size changes. */
export function restorePdfReadingScroll(
  snapshot: PdfReadingScrollSnapshot,
  viewport: PdfReadingViewport,
  pages: PdfReadingPageGeometry[],
) {
  const offset = reference(viewport);
  const anchor = snapshot.anchor;
  const sheet = anchor && pages.find(page => page.page === anchor.page &&
    page.width > 0 && page.height > 0);
  return {
    left: clamp(sheet && anchor
      ? sheet.left + clamp(anchor.fractionX, 0, 1) * sheet.width - offset.x
      : snapshot.scrollLeft, 0, Math.max(0, viewport.scrollWidth - viewport.width)),
    top: clamp(sheet && anchor
      ? sheet.top + clamp(anchor.fractionY, 0, 1) * sheet.height - offset.y
      : snapshot.scrollTop, 0, Math.max(0, viewport.scrollHeight - viewport.height)),
  };
}
