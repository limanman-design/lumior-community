export type PdfScrollSide = 'source' | 'translation';

export type PdfScrollPart = { id: string; top: number; bottom: number };
export type PdfScrollPageGeometry = {
  page: number;
  top: number;
  bottom: number;
  parts: PdfScrollPart[];
};
export type PdfScrollGeometry = {
  pages: PdfScrollPageGeometry[];
  scrollHeight: number;
  viewportHeight: number;
};
export type PdfScrollPageMapping = { page: number; source: number; alignment?: 'page' };
export type PdfScrollAnchor = { source: number; translation: number };

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

/** Keep paragraph anchors in reading order; two columns can overlap vertically. */
function orderedParagraphAnchors(anchors: PdfScrollAnchor[]) {
  const ordered = anchors.toSorted(
    (a, b) => a.source - b.source || a.translation - b.translation,
  );
  const lengths = ordered.map(() => 1),
    previous = ordered.map(() => -1);
  let best = -1;
  for (let index = 0; index < ordered.length; index++) {
    for (let before = 0; before < index; before++) {
      if (
        ordered[before].source < ordered[index].source &&
        ordered[before].translation < ordered[index].translation &&
        lengths[before] + 1 > lengths[index]
      ) {
        lengths[index] = lengths[before] + 1;
        previous[index] = before;
      }
    }
    if (best < 0 || lengths[index] > lengths[best]) best = index;
  }
  const result: PdfScrollAnchor[] = [];
  while (best >= 0) {
    result.push(ordered[best]);
    best = previous[best];
  }
  return result.reverse();
}

/** A source page can correspond to several reflowed translation pages. */
export function pdfScrollAnchors(
  source: PdfScrollGeometry,
  translation: PdfScrollGeometry,
  mapping: PdfScrollPageMapping[],
): PdfScrollAnchor[] {
  const translatedPages = new Map(
    translation.pages.map((page) => [page.page, page]),
  );
  const result: PdfScrollAnchor[] = [];
  for (const sourcePage of source.pages) {
    const targets = mapping
      .filter((page) => page.source === sourcePage.page)
      .map((page) => translatedPages.get(page.page))
      .filter((page): page is PdfScrollPageGeometry => !!page)
      .toSorted((a, b) => a.top - b.top);
    if (!targets.length) continue;
    const first = targets[0],
      last = targets[targets.length - 1];
    const parts = new Map<string, number>();
    for (const target of targets) {
      for (const part of target.parts) {
        parts.set(part.id, Math.min(parts.get(part.id) ?? Infinity, part.top));
      }
    }
    const candidates = sourcePage.parts.flatMap((part) => {
      const top = parts.get(part.id);
      return top !== undefined &&
        part.top > sourcePage.top &&
        part.top < sourcePage.bottom &&
        top > first.top &&
        top < last.bottom
        ? [{ source: part.top, translation: top }]
        : [];
    });
    const group = [
      { source: sourcePage.top, translation: first.top },
      ...orderedParagraphAnchors(candidates),
      { source: sourcePage.bottom, translation: last.bottom },
    ];
    for (const anchor of group) {
      const preceding = result[result.length - 1];
      if (
        !preceding ||
        (anchor.source > preceding.source &&
          anchor.translation > preceding.translation)
      )
        result.push(anchor);
    }
  }
  if (!result.length) return result;
  const firstSource = source.pages[0],
    firstTarget = translation.pages[0];
  if (
    result[0].source === firstSource?.top &&
    result[0].translation === firstTarget?.top &&
    result[0].source > 0 &&
    result[0].translation > 0
  )
    result.unshift({ source: 0, translation: 0 });
  const last = result[result.length - 1];
  if (
    last.source === source.pages[source.pages.length - 1]?.bottom &&
    last.translation ===
      translation.pages[translation.pages.length - 1]?.bottom &&
    source.scrollHeight > last.source &&
    translation.scrollHeight > last.translation
  )
    result.push({
      source: source.scrollHeight,
      translation: translation.scrollHeight,
    });
  return result;
}

export function interpolatePdfScrollPoint(
  point: number,
  side: PdfScrollSide,
  anchors: PdfScrollAnchor[],
): number | null {
  if (!anchors.length || !Number.isFinite(point)) return null;
  const target = side === 'source' ? 'translation' : 'source';
  const first = anchors[0],
    last = anchors[anchors.length - 1];
  if (point <= first[side]) return first[target];
  if (point >= last[side]) return last[target];
  let left = 0,
    right = anchors.length - 1;
  while (right - left > 1) {
    const middle = Math.floor((left + right) / 2);
    if (anchors[middle][side] <= point) left = middle;
    else right = middle;
  }
  const before = anchors[left],
    after = anchors[right];
  const fraction = (point - before[side]) / (after[side] - before[side]);
  return before[target] + (after[target] - before[target]) * fraction;
}

/** Move the reference line through the viewport so both document ends align. */
export function mapPdfScrollTop(
  top: number,
  side: PdfScrollSide,
  source: PdfScrollGeometry,
  translation: PdfScrollGeometry,
  anchors: PdfScrollAnchor[],
  pageAligned = false,
): number | null {
  const from = side === 'source' ? source : translation;
  const to = side === 'source' ? translation : source;
  const fromRange = Math.max(0, from.scrollHeight - from.viewportHeight);
  const toRange = Math.max(0, to.scrollHeight - to.viewportHeight);
  if (!fromRange || !from.scrollHeight || !to.scrollHeight) return null;
  if (pageAligned) {
    // One reflow sheet belongs to one source page, but its height may differ.
    // Map page/paragraph tops directly; whole-document normalization would move
    // page boundaries into a preceding page when just one sheet grows taller.
    const sourceRange = Math.max(0, source.scrollHeight - source.viewportHeight);
    const targetRange = Math.max(0, translation.scrollHeight - translation.viewportHeight);
    const scrollAnchors = anchors.filter(anchor => anchor.source > 0 && anchor.translation > 0 && anchor.source < sourceRange && anchor.translation < targetRange);
    if (!anchors.length) return null;
    scrollAnchors.unshift({ source: 0, translation: 0 });
    scrollAnchors.push({ source: sourceRange, translation: targetRange });
    const mapped = interpolatePdfScrollPoint(clamp(top, 0, fromRange), side, scrollAnchors);
    return mapped === null ? null : clamp(mapped, 0, toRange);
  }
  const point = (clamp(top, 0, fromRange) * from.scrollHeight) / fromRange;
  const mapped = interpolatePdfScrollPoint(point, side, anchors);
  return mapped === null
    ? null
    : clamp((mapped * toRange) / to.scrollHeight, 0, toRange);
}

/** Programmatic target scroll events must never become another source update. */
export function createPdfScrollFeedbackGuard(timeout = 300) {
  const expected = new Map<PdfScrollSide, { top: number; at: number }>();
  return {
    mark(side: PdfScrollSide, top: number, at: number) {
      expected.set(side, { top, at });
    },
    user(side: PdfScrollSide) {
      expected.delete(side);
    },
    clear() {
      expected.clear();
    },
    consume(side: PdfScrollSide, top: number, at: number) {
      const request = expected.get(side);
      expected.delete(side);
      return (
        !!request &&
        at - request.at <= timeout &&
        Math.abs(top - request.top) <= 1
      );
    },
  };
}

export function pdfPartIsVisible(
  parts: Pick<PdfScrollPart, 'top' | 'bottom'>[],
  top: number,
  height: number,
) {
  return parts.some((part) => part.bottom > top && part.top < top + height);
}

export function readPdfScrollGeometry(root: HTMLElement): PdfScrollGeometry {
  const rootTop = root.getBoundingClientRect().top;
  const contentBounds = (element: HTMLElement) => {
    const box = element.getBoundingClientRect(),
      top = box.top - rootTop + root.scrollTop;
    return { top, bottom: top + box.height };
  };
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>('[data-pdf-page]'),
  )
    .map((sheet) => {
      const parts = new Map<string, PdfScrollPart>();
      for (const element of sheet.querySelectorAll<HTMLElement>(
        '[data-pdf-part-id]',
      )) {
        const id = element.dataset.pdfPartId;
        if (!id) continue;
        const { top, bottom } = contentBounds(element);
        const preceding = parts.get(id);
        parts.set(id, {
          id,
          top: Math.min(preceding?.top ?? top, top),
          bottom: Math.max(preceding?.bottom ?? bottom, bottom),
        });
      }
      return {
        page: Number(sheet.dataset.pdfPage),
        ...contentBounds(sheet),
        parts: [...parts.values()],
      };
    })
    .filter((page) => Number.isFinite(page.page) && page.bottom > page.top)
    .toSorted((a, b) => a.top - b.top);
  return {
    pages,
    scrollHeight: root.scrollHeight,
    viewportHeight: root.clientHeight,
  };
}

type PdfScrollSyncOptions = {
  source?: () => HTMLElement | null;
  translation?: () => HTMLElement | null;
  pages: () => PdfScrollPageMapping[];
  onSourcePage?: (page: number) => void;
};

export function createPdfScrollSync(options: PdfScrollSyncOptions) {
  const roots: Partial<Record<PdfScrollSide, HTMLElement>> = {};
  const cleanups: Partial<Record<PdfScrollSide, () => void>> = {};
  const feedback = createPdfScrollFeedbackGuard();
  const geometries: Partial<Record<PdfScrollSide, PdfScrollGeometry>> = {};
  let cachedAnchors:
    | {
        source: PdfScrollGeometry;
        translation: PdfScrollGeometry;
        pages: PdfScrollPageMapping[];
        values: PdfScrollAnchor[];
      }
    | undefined;
  let frame: number | undefined, queued: PdfScrollSide | undefined;
  let lastScroll = -Infinity;
  let drivingSide: PdfScrollSide = 'source';
  const pressed = new Set<PdfScrollSide>();
  const now = () => performance.now();
  const otherSide = (side: PdfScrollSide): PdfScrollSide =>
    side === 'source' ? 'translation' : 'source';
  const rootFor = (side: PdfScrollSide) =>
    roots[side] || options[side]?.() || null;
  const geometryFor = (side: PdfScrollSide) => {
    const root = rootFor(side);
    if (!root) return;
    return (geometries[side] ??= readPdfScrollGeometry(root));
  };
  const publishPage = (geometry?: PdfScrollGeometry) => {
    const root = rootFor('source');
    if (!root || !options.onSourcePage) return;
    const page = (geometry || geometryFor('source'))?.pages.find(
      (value) => value.bottom > root.scrollTop + 40,
    );
    if (page) options.onSourcePage(page.page);
  };
  const move = (side: PdfScrollSide, top: number) => {
    const root = rootFor(side);
    if (!root || !Number.isFinite(top)) return false;
    const target = clamp(
      top,
      0,
      Math.max(0, root.scrollHeight - root.clientHeight),
    );
    if (Math.abs(target - root.scrollTop) <= 0.5) return false;
    feedback.mark(side, target, now());
    root.scrollTo({ top: target, behavior: 'instant' });
    return true;
  };
  const synchronize = (side: PdfScrollSide) => {
    const source = rootFor('source'),
      translation = rootFor('translation');
    if (!source || !translation) return false;
    const sourceGeometry = geometryFor('source')!,
      translationGeometry = geometryFor('translation')!;
    const pages = options.pages();
    if (
      !cachedAnchors ||
      cachedAnchors.source !== sourceGeometry ||
      cachedAnchors.translation !== translationGeometry ||
      cachedAnchors.pages !== pages
    )
      cachedAnchors = {
        source: sourceGeometry,
        translation: translationGeometry,
        pages,
        values: pdfScrollAnchors(sourceGeometry, translationGeometry, pages),
      };
    const top = mapPdfScrollTop(
      rootFor(side)!.scrollTop,
      side,
      sourceGeometry,
      translationGeometry,
      cachedAnchors.values,
      pages.length > 0 && pages.every(page => page.alignment === 'page'),
    );
    const changed = top !== null && move(otherSide(side), top);
    publishPage(sourceGeometry);
    return changed;
  };
  // External calls follow a committed zoom, translated paragraph or page-map
  // change. Read that new geometry once; native scrolling reuses it thereafter.
  const syncFrom = (side: PdfScrollSide) => {
    delete geometries.source;
    delete geometries.translation;
    cachedAnchors = undefined;
    return synchronize(side);
  };
  const cancelFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    queued = undefined;
  };
  const queue = (side: PdfScrollSide) => {
    queued = side;
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      const pending = queued;
      frame = undefined;
      queued = undefined;
      if (pending) synchronize(pending);
    });
  };
  const attach = (side: PdfScrollSide, root: HTMLElement | null) => {
    cleanups[side]?.();
    delete cleanups[side];
    delete roots[side];
    delete geometries[side];
    cachedAnchors = undefined;
    feedback.user(side);
    pressed.delete(side);
    if (!root) return () => {};
    roots[side] = root;
    const intent = () => {
      feedback.user(side);
      drivingSide = side;
    };
    const down = () => {
      intent();
      pressed.add(side);
    };
    const up = () => {
      pressed.delete(side);
    };
    const scroll = () => {
      lastScroll = now();
      if (feedback.consume(side, root.scrollTop, lastScroll)) return;
      drivingSide = side;
      queue(side);
    };
    const resized = () => {
      if (roots[side] !== root) return;
      delete geometries[side];
      cachedAnchors = undefined;
      queue(drivingSide);
    };
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(resized);
    const observePages = () => {
      resizeObserver?.disconnect();
      resizeObserver?.observe(root);
      for (const sheet of root.querySelectorAll<HTMLElement>('[data-pdf-page]'))
        resizeObserver?.observe(sheet);
      resized();
    };
    // PDF pages initially use a placeholder aspect ratio and obtain their true
    // dimensions only when rendered. Reflow previews also replace their sheets.
    const mutationObserver =
      typeof MutationObserver === 'undefined'
        ? undefined
        : new MutationObserver((records) => {
            const pageChanged = records.some(
              (record) =>
                record.target === root ||
                [...record.addedNodes, ...record.removedNodes].some(
                  (node) =>
                    node.nodeType === 1 &&
                    ((node as Element).matches('[data-pdf-page]') ||
                      (node as Element).querySelector('[data-pdf-page]')),
                ),
            );
            if (pageChanged) observePages();
            else if (
              records.some((record) =>
                [...record.addedNodes, ...record.removedNodes].some(
                  (node) =>
                    node.nodeType === 1 &&
                    ((node as Element).matches('[data-pdf-part-id]') ||
                      (node as Element).querySelector('[data-pdf-part-id]')),
                ),
              )
            )
              resized();
          });
    resizeObserver?.observe(root);
    for (const sheet of root.querySelectorAll<HTMLElement>('[data-pdf-page]'))
      resizeObserver?.observe(sheet);
    mutationObserver?.observe(root, { childList: true, subtree: true });
    root.addEventListener('scroll', scroll, { passive: true });
    root.addEventListener('wheel', intent, { passive: true });
    root.addEventListener('touchstart', down, { passive: true });
    root.addEventListener('pointerdown', down, { passive: true });
    root.addEventListener('keydown', intent);
    const view = root.ownerDocument.defaultView;
    view?.addEventListener('pointerup', up);
    view?.addEventListener('pointercancel', up);
    view?.addEventListener('touchend', up);
    view?.addEventListener('touchcancel', up);
    const cleanup = () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      root.removeEventListener('scroll', scroll);
      root.removeEventListener('wheel', intent);
      root.removeEventListener('touchstart', down);
      root.removeEventListener('pointerdown', down);
      root.removeEventListener('keydown', intent);
      view?.removeEventListener('pointerup', up);
      view?.removeEventListener('pointercancel', up);
      view?.removeEventListener('touchend', up);
      view?.removeEventListener('touchcancel', up);
      if (roots[side] === root) {
        delete roots[side];
        pressed.delete(side);
      }
      if (queued === side) cancelFrame();
    };
    cleanups[side] = cleanup;
    return cleanup;
  };
  const reset = () => {
    cancelFrame();
    feedback.clear();
    lastScroll = -Infinity;
    drivingSide = 'source';
    pressed.clear();
    delete geometries.source;
    delete geometries.translation;
    cachedAnchors = undefined;
  };
  const isScrolling = () =>
    pressed.size > 0 || frame !== undefined || now() - lastScroll < 180;
  const hover = (side: PdfScrollSide, id: string) => {
    if (isScrolling()) return false;
    const targetSide = otherSide(side),
      root = rootFor(targetSide);
    if (!root) return false;
    const parts = geometryFor(targetSide)!
      .pages.flatMap((page) => page.parts)
      .filter((part) => part.id === id);
    if (
      !parts.length ||
      pdfPartIsVisible(parts, root.scrollTop, root.clientHeight)
    )
      return false;
    const center = root.scrollTop + root.clientHeight / 2;
    const closest = parts.toSorted(
      (a, b) =>
        Math.abs((a.top + a.bottom) / 2 - center) -
        Math.abs((b.top + b.bottom) / 2 - center),
    )[0];
    const changed = move(
      targetSide,
      (closest.top + closest.bottom - root.clientHeight) / 2,
    );
    if (changed) {
      lastScroll = now();
      publishPage();
    }
    return changed;
  };
  const connect = () => {
    const source = rootFor('source'),
      translation = rootFor('translation');
    attach('source', source);
    attach('translation', translation);
    return () => {
      attach('source', null);
      attach('translation', null);
      reset();
    };
  };
  return { attach, connect, syncFrom, hover, isScrolling, reset };
}
