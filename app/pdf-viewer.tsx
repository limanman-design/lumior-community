'use client';
import { useI18n } from './i18n';
import { translate as tr } from './i18n-core';
import { pdfSystemMessage } from './pdf-system-messages';
import {
  selectionToolbarPosition,
  selectionToolbarVisibility,
  type CursorPoint,
} from './pdf-selection-position';
import { PdfRegionExcerpt } from './pdf-region-excerpt';
import { PdfAnnotationEditor } from './pdf-annotation-editor';
import { PDF_TRANSLATION_ENABLED } from './feature-flags';
import { usePdfTranslation } from './use-pdf-translation';
import { PdfTranslationPanel } from './pdf-translation-panel';
import { PdfTranslationConfirmation } from './pdf-translation-confirmation';
import {
  acknowledgeTranslationConsent,
  needsTranslationConsent,
} from './pdf-translation-consent';
import {
  createPdfScrollSync,
  type PdfScrollPageMapping,
  type PdfScrollSide,
} from './pdf-scroll-sync';
import type { ImportedCard } from './file-import';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  PdfPage,
  getPdfText as getText,
  type MarkGesture,
  type SearchHit,
} from './pdf-sheet';
import { Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { PdfNavigation, PdfPageControl } from './pdf-navigation';
import { PdfReadingNotes } from './pdf-reading-notes';
import { PdfNotesDrawer } from './pdf-notes-drawer';
import type { Card } from './canvas-model';
import { acquirePdf } from './pdf-runtime';
import { trackPdfPage } from './pdf-page-tracker';
import { createPdfWidthSettler } from './pdf-width-settle';
import { createPdfResizeAnchor } from './pdf-resize-anchor';
import { createPdfMarkDrag, type PdfMarkPreview } from './pdf-mark-drag';
import { useTabReadingSession } from './tab-reading-session';
import {
  capturePdfReadingScroll,
  pdfReadingRestoreState,
  restorePdfReadingScroll,
  type PdfReadingPageGeometry,
  type PdfReadingScrollSnapshot,
  type PdfReadingSessionSnapshot,
  type PdfReadingViewport,
} from './pdf-reading-session-model';
import {
  usePdfAnnotations,
  type PdfMark,
  type PdfRect,
} from './pdf-annotations';
import './pdf-viewer.css';
import './pdf-horizontal-pages.css';
const colors = ['#f5d84a', '#77cd82', '#64bfee', '#ee83af', '#b196ee'];
const EMPTY_MARKS: PdfMark[] = [];

function readingGeometry(root: HTMLElement, horizontal = false) {
  const box = root.getBoundingClientRect();
  const viewport: PdfReadingViewport = {
    scrollLeft: root.scrollLeft,
    scrollTop: root.scrollTop,
    width: root.clientWidth,
    height: root.clientHeight,
    scrollWidth: root.scrollWidth,
    scrollHeight: root.scrollHeight,
    horizontal,
  };
  const pages: PdfReadingPageGeometry[] = Array.from(
    root.querySelectorAll<HTMLElement>('[data-pdf-page]'),
    sheet => {
      const bounds = sheet.getBoundingClientRect();
      return {
        page: Number(sheet.dataset.pdfPage),
        left: bounds.left - box.left + root.scrollLeft,
        top: bounds.top - box.top + root.scrollTop,
        width: bounds.width,
        height: bounds.height,
      };
    },
  );
  return { viewport, pages };
}

export default function PdfViewer({
  card,
  initialPage,
  focusRequest,
  highlight,
  focusMark,
  layout = 'sidebar',
  controlsTarget,
  translationStatusTarget,
  aiOpen = false,
  showReadingNotes = true,
  pageFlow = 'vertical',
  excerptCards = [],
  onNoteChange,
  linkedCards,
  onCardChange,
  initialTranslation = false,
  onExpandTranslate,
  onTranslationCreated,
}: {
  card: Card;
  initialPage?: number;
  focusRequest?: object;
  highlight?: PdfRect;
  focusMark?: PdfMark;
  layout?: 'sidebar' | 'expanded';
  controlsTarget?: HTMLElement | null;
  translationStatusTarget?: HTMLElement | null;
  aiOpen?: boolean;
  showReadingNotes?: boolean;
  pageFlow?: 'vertical' | 'horizontal';
  excerptCards?: Card[];
  onNoteChange?: (id: string, note: string) => void;
  linkedCards?: Card[];
  onCardChange?: (id: string, patch: Partial<Card>) => void;
  initialTranslation?: boolean;
  onExpandTranslate?: () => void;
  onTranslationCreated?: (card: ImportedCard) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const url = card.pdf!.url;
  const readingSession = useTabReadingSession<PdfReadingSessionSnapshot>(
    card.id, 'pdf-expanded', url,
  );
  const sessionKey = `${layout}:${readingSession.sessionKey}`;
  const savedSession = layout === 'expanded' ? readingSession.snapshot : undefined;
  const initialReading = pdfReadingRestoreState(savedSession, card.pdf!.pages, {
    page: initialPage,
    markPage: focusMark?.fragments[0]?.page,
    requested: !!focusRequest,
  });
  const pendingRestore = useRef<PdfReadingSessionSnapshot | undefined>(
    initialReading.restoreScroll ? savedSession : undefined,
  );
  const [restoringSession, setRestoringSession] = useState(initialReading.restoreScroll);
  const translationScroll = useRef<PdfReadingScrollSnapshot | undefined>(savedSession?.translation);
  const [sessionPageRatios, setSessionPageRatios] = useState<Record<number, number>>(
    savedSession?.pageRatios || {},
  );
  const readerRoot = useRef<HTMLDivElement>(null);
  const measuredWidth = useRef(false);
  const saveFrame = useRef<number | undefined>(undefined);
  const captureSession = useRef(() => {});
  const queueSessionSave = useCallback(() => {
    if (saveFrame.current !== undefined) return;
    saveFrame.current = requestAnimationFrame(() => {
      saveFrame.current = undefined;
      captureSession.current();
    });
  }, []);
  const [translationOpen, setTranslationOpen] = useState(PDF_TRANSLATION_ENABLED && (savedSession?.translationOpen || false)),
    [hoveredPart, setHoveredPart] = useState<string | undefined>();
  const [translationControls, setTranslationControls] =
    useState<HTMLDivElement | null>(null);
  const [translationConfirmation, setTranslationConfirmation] = useState(false),
    [rememberTranslationConsent, setRememberTranslationConsent] =
      useState(false);
  const currentCard = useRef(card);
  currentCard.current = card;
  const translator = usePdfTranslation(card, (translation) =>
    onCardChange?.(card.id, {
      pdf: { ...currentCard.current.pdf!, translation },
    }),
  );
  const translatorStart = useRef(() =>
    translator.start(translator.requestedMode),
  );
  translatorStart.current = () => translator.start(translator.requestedMode);
  const openTranslation = () => {
    if (!PDF_TRANSLATION_ENABLED) return;
    if (layout === 'sidebar' && onExpandTranslate) {
      onExpandTranslate();
      return;
    }
    setTranslationOpen(true);
    void translatorStart.current();
  };
  const requestTranslation = () => {
    if (!PDF_TRANSLATION_ENABLED) return;
    if (needsTranslationConsent(card.pdf!.url)) {
      setRememberTranslationConsent(false);
      setTranslationConfirmation(true);
    } else openTranslation();
  };
  const initialTranslationAction = useRef(requestTranslation);
  const previousTranslationRequest = useRef<{ key: string; requested: boolean } | null>(null);
  useLayoutEffect(() => {
    initialTranslationAction.current = requestTranslation;
  });
  useEffect(() => {
    const previous = previousTranslationRequest.current;
    const newlyRequested = previous?.key === sessionKey && !previous.requested;
    previousTranslationRequest.current = { key: sessionKey, requested: initialTranslation };
    // Reopening a saved pane only displays its cache; a fresh request still starts translation.
    if (initialTranslation && (!savedSession || newlyRequested))
      initialTranslationAction.current();
  }, [initialTranslation, sessionKey, savedSession]);
  const toggleTranslation = () => {
    if (translationOpen) {
      translator.stop();
      setTranslationOpen(false);
    } else requestTranslation();
  };
  const sourceHoverRects = useMemo(() => {
    const pages = new Map<number, { id: string; rect: PdfRect }[]>(),
      translation = translator.translation;
    if (
      (translator.requestedMode === 'original-layout') !==
      (translation?.mode === 'original-layout')
    )
      return pages;
    if (translation?.mode === 'original-layout') {
      if (translation.complete)
        translation.layout?.pages.forEach((layout) =>
          pages.set(layout.source, [
            ...(pages.get(layout.source) || []),
            ...layout.sourceRects,
          ]),
        );
    } else
      translation?.units.forEach((unit) =>
        unit.parts?.forEach((part) =>
          pages.set(unit.page, [
            ...(pages.get(unit.page) || []),
            ...part.rects.map((rect) => ({ id: part.id, rect })),
          ]),
        ),
      );
    return pages;
  }, [translator.translation, translator.requestedMode]);
  const annotations = usePdfAnnotations();
  const horizontalPages = pageFlow === 'horizontal' && !translationOpen;
  const marks = annotations.marks[url] || EMPTY_MARKS;
  const displayed = marks;
  useEffect(() => {
    if (focusMark && !marks.some((m) => m.id === focusMark.id))
      annotations.save(url, focusMark);
  }, [focusMark, url]);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null),
    [page, setPage] = useState(initialReading.page),
    [zoom, setZoom] = useState(initialReading.zoom),
    [width, setWidth] = useState(400),
    [viewportHeight, setViewportHeight] = useState(0),
    [renderWidth, setRenderWidth] = useState(0),
    [pageRatio, setPageRatio] = useState(1.3),
    [error, setError] = useState('');
  const [rasterZoom, setRasterZoom] = useState(initialReading.zoom),
    [searchOpen, setSearchOpen] = useState(false),
    [query, setQuery] = useState(''),
    [hits, setHits] = useState<SearchHit[]>([]),
    [hitIndex, setHitIndex] = useState(0),
    [searching, setSearching] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setRasterZoom(zoom), 180);
    return () => clearTimeout(id);
  }, [zoom]);
  useEffect(() => {
    let cancelled = false;
    setHits([]);
    setHitIndex(0);
    if (!pdf || !query.trim()) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const id = setTimeout(async () => {
      const results: SearchHit[] = [];
      try {
        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) return;
          const content = await getText(pdf, n);
          const text = content.items
            .filter((i) => 'str' in i)
            .map((i) => ('str' in i ? i.str : ''))
            .join(' ')
            .toLocaleLowerCase();
          const needle = query.trim().toLocaleLowerCase();
          let start = 0;
          while ((start = text.indexOf(needle, start)) !== -1) {
            results.push({ page: n, start, end: start + needle.length });
            start += needle.length;
          }
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (!cancelled) {
          setHits(results);
          setSearching(false);
        }
      } catch {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [pdf, query]);
  const area = useRef<HTMLDivElement>(null);
  const [resizeAnchor] = useState(createPdfResizeAnchor);
  const resizeMode = useRef({ expanded: layout === 'expanded', horizontal: horizontalPages });
  useLayoutEffect(() => {
    resizeMode.current = { expanded: layout === 'expanded', horizontal: horizontalPages };
  }, [layout, horizontalPages]);
  const requestedPage = useRef<number | null>(null);
  const cancelReadingRestore = useCallback((keepScrollGeometry = false) => {
    if (keepScrollGeometry) resizeAnchor.interrupt();
    else resizeAnchor.reset();
    if (!pendingRestore.current) return;
    pendingRestore.current = undefined;
    requestedPage.current = null;
    setRestoringSession(false);
    queueSessionSave();
  }, [queueSessionSave, resizeAnchor]);
  const translationArea = useRef<HTMLDivElement | null>(null),
    translationPages = useRef<PdfScrollPageMapping[]>([]);
  // The controller captures ref readers; it only reads them from DOM events/effects.
  // oxlint-disable-next-line react/react-compiler
  const scrollSync = useMemo(
    () =>
      createPdfScrollSync({
        source: () => area.current,
        translation: () => translationArea.current,
        pages: () => translationPages.current,
        onSourcePage: (n) => {
          if (requestedPage.current === null && !resizeAnchor.isPending()) setPage(n);
        },
      }),
    [resizeAnchor],
  );
  useEffect(() => {
    scrollSync.reset();
    if (!translationOpen || restoringSession) return;
    return scrollSync.connect();
  }, [scrollSync, translationOpen, restoringSession, url]);
  useLayoutEffect(() => {
    if (!translationOpen || pendingRestore.current) return;
    const frame = requestAnimationFrame(() => scrollSync.syncFrom('source'));
    return () => cancelAnimationFrame(frame);
  }, [scrollSync, translationOpen, zoom, width, sourceHoverRects]);
  // React invokes these registrations after committing the PDF DOM.
  // oxlint-disable-next-line react/react-compiler
  const registerTranslationRoot = useCallback(
    (node: HTMLDivElement | null) => {
      translationArea.current = node;
      if (!pendingRestore.current) scrollSync.attach('translation', node);
    },
    [scrollSync],
  );
  // oxlint-disable-next-line react/react-compiler
  const registerTranslationPages = useCallback(
    (pages: PdfScrollPageMapping[]) => {
      translationPages.current = pages;
      if (!pendingRestore.current) scrollSync.syncFrom('source');
    },
    [scrollSync],
  );
  const clearRequestedPage = useCallback(() => {
    cancelReadingRestore();
    requestedPage.current = null;
  }, [cancelReadingRestore]);
  const hoverPart = (side: PdfScrollSide, id?: string) => {
    if (scrollSync.isScrolling()) return;
    setHoveredPart(id);
    if (id) {
      if (side === 'translation') requestedPage.current = null;
      scrollSync.hover(side, id);
    }
  };
  const jumpPage = (n: number) => {
    cancelReadingRestore();
    n = Math.min(pdf?.numPages || card.pdf!.pages, Math.max(1, n));
    const el = area.current?.querySelector<HTMLElement>(
      `[data-pdf-page="${n}"]`,
    );
    requestedPage.current = n;
    if (el)
      area.current?.scrollTo({
        top: horizontalPages ? 0 : el.offsetTop - (translationOpen ? 20 : 12),
        ...(horizontalPages ? { left: el.offsetLeft - 12 } : {}),
      });
    setPage(n);
    if (translationOpen)
      requestAnimationFrame(() => scrollSync.syncFrom('source'));
  };
  useEffect(() => {
    const hit = hits[hitIndex];
    if (!hit || !pdf) return;
    let live = true;
    jumpPage(hit.page);
    getText(pdf, hit.page).then(async (content) => {
      const p = await pdf.getPage(hit.page);
      if (!live) return;
      const v = p.getViewport({ scale: 1 });
      let offset = 0;
      for (const item of content.items) {
        if (!('str' in item)) continue;
        if (offset + item.str.length > hit.start) {
          const el = area.current?.querySelector<HTMLElement>(
            `[data-pdf-page="${hit.page}"]`,
          );
          if (el)
            area.current?.scrollTo({
              top:
                el.offsetTop +
                (v.convertToViewportPoint(
                  item.transform[4],
                  item.transform[5],
                )[1] /
                  v.height) *
                  el.offsetHeight -
                120,
            });
          break;
        }
        offset += item.str.length + 1;
      }
    });
    return () => {
      live = false;
    };
  }, [hits, hitIndex]);
  const selectionToolbar = useRef<HTMLDivElement>(null),
    selectionEnd = useRef<CursorPoint>({ x: 0, y: 0 });
  const [menuOpacity, setMenuOpacity] = useState(1);
  const [menu, setMenu] = useState<{
      mark: PdfMark;
      x: number;
      y: number;
      saved: boolean;
    } | null>(null),
    [ghost, setGhost] = useState<{
      mark: PdfMark;
      x: number;
      y: number;
    } | null>(null);
  useEffect(() => {
    if (!menu) return;
    setMenuOpacity(1);
    const move = (event: PointerEvent) => {
      const node = selectionToolbar.current;
      if (!node) return;
      if (
        node.contains(document.activeElement) &&
        document.activeElement?.matches('input,textarea')
      )
        return;
      const visibility = selectionToolbarVisibility(
        { x: event.clientX, y: event.clientY },
        selectionEnd.current,
        node.getBoundingClientRect(),
      );
      if (visibility === 'closed') setMenu(null);
      else setMenuOpacity(visibility === 'visible' ? 1 : 0.18);
    };
    document.addEventListener('pointermove', move, { passive: true });
    return () => document.removeEventListener('pointermove', move);
  }, [menu]);
  const markDrag = useRef<ReturnType<typeof createPdfMarkDrag> | null>(null);
  const dragCallbacks = useRef({
    preview: (preview: PdfMarkPreview | null) => {
      if (preview) setMenu(null);
      setGhost(preview);
    },
    drop: (mark: PdfMark, point: { clientX: number; clientY: number }) => annotations.drop(card, mark, point),
  });
  useLayoutEffect(() => {
    dragCallbacks.current.drop = (mark, point) => annotations.drop(card, mark, point);
  });
  useEffect(() => () => markDrag.current?.cancel(), [url]);
  const anchor = useRef<{
      x: number;
      y: number;
      left: number;
      top: number;
      zoom: number;
      page: number;
      fraction: number;
      fractionX: number;
    } | null>(null),
    zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  useEffect(() => {
    resizeAnchor.reset();
    const snapshot = layout === 'expanded' ? readingSession.snapshot : undefined;
    const restored = pdfReadingRestoreState(snapshot, card.pdf!.pages, {
      page: initialPage,
      markPage: focusMark?.fragments[0]?.page,
      requested: !!focusRequest,
    });
    pendingRestore.current = restored.restoreScroll ? snapshot : undefined;
    translationScroll.current = snapshot?.translation;
    setRestoringSession(restored.restoreScroll);
    setSessionPageRatios(snapshot?.pageRatios || {});
    if (snapshot) setTranslationOpen(PDF_TRANSLATION_ENABLED && snapshot.translationOpen);
    else if (!initialTranslation) setTranslationOpen(false);
    setPdf(null);
    setHoveredPart(undefined);
    setError('');
    setZoom(restored.zoom);
    setPage(restored.page);
    requestedPage.current = restored.page;
    area.current?.scrollTo({ top: 0, left: 0 });
    setRasterZoom(restored.zoom);
    setSearchOpen(false);
    setQuery('');
    setMenu(null);
    const task = acquirePdf(url);
    let live = true;
    task.promise
      .then(async (doc) => {
        const first = await doc.getPage(1);
        if (live) {
          const viewport = first.getViewport({ scale: 1 });
          setPageRatio(viewport.height / viewport.width);
          (doc as PDFDocumentProxy & { __lumiorUrl?: string }).__lumiorUrl =
            url;
          const loaded = pdfReadingRestoreState(snapshot, doc.numPages, {
            page: initialPage,
            markPage: focusMark?.fragments[0]?.page,
            requested: !!focusRequest,
          });
          setPage(loaded.page);
          requestedPage.current = loaded.page;
          setPdf(doc);
        }
      })
      .catch(() => {
        if (live)
          setError(
            tr(
              'Could not load the PDF. Upload the file again.',
              '无法加载 PDF，请重新上传文件。',
            ),
          );
      });
    return () => {
      live = false;
      task.release();
    };
  }, [url, sessionKey, resizeAnchor]);
  useEffect(() => {
    if (!area.current) return;
    const root = area.current;
    const settler = createPdfWidthSettler(
      setRenderWidth,
      () =>
        !!root
          .closest('.canvas-side-panel')
          ?.querySelector('[data-dragging="true"]'),
    );
    const ro = new ResizeObserver(([e]) => {
      measuredWidth.current = e.contentRect.width > 0;
      resizeAnchor.measure(e.contentRect.width, e.contentRect.height,
        !resizeMode.current.expanded || resizeMode.current.horizontal || !!pendingRestore.current,
        { scrollLeft: root.scrollLeft, scrollTop: root.scrollTop });
      setWidth(e.contentRect.width);
      setViewportHeight(e.contentRect.height);
      settler.update(e.contentRect.width);
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
      settler.cancel();
    };
  }, [resizeAnchor]);
  useEffect(() => {
    const root = area.current;
    if (!root || !pdf || translationOpen) return;
    return trackPdfPage(root, setPage, () => requestedPage.current === null && !resizeAnchor.isPending(),
      horizontalPages ? 'horizontal' : 'vertical');
  }, [pdf, translationOpen, horizontalPages, resizeAnchor]);
  useLayoutEffect(() => {
    if (!horizontalPages) return;
    const root = area.current;
    const sheet = root?.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`);
    if (root && sheet) root.scrollLeft = sheet.offsetLeft - 12;
    // Preserve the selected page when its available width changes.
  }, [width, horizontalPages, pdf]);
  useLayoutEffect(() => {
    const root = area.current;
    if (layout !== 'expanded' || horizontalPages || pendingRestore.current || !pdf || !root)
      return;
    const source = readingGeometry(root);
    const position = resizeAnchor.restore(source.viewport, source.pages);
    if (position) root.scrollTo({ ...position, behavior: 'instant' });
  }, [width, viewportHeight, layout, horizontalPages, pdf, resizeAnchor]);
  const changeZoom = (next: number, x?: number, y?: number) => {
    cancelReadingRestore();
    const root = area.current;
    if (!root) return;
    const r = root.getBoundingClientRect();
    const py = y ?? r.height / 2;
    const sheets = Array.from(
      root.querySelectorAll<HTMLElement>('[data-pdf-page]'),
    );
    const sheet = horizontalPages
      ? sheets.find(el => Number(el.dataset.pdfPage) === page)
      : sheets.find(
        (el) => el.offsetTop + el.offsetHeight >= root.scrollTop + py,
      ) || sheets[sheets.length - 1];
    anchor.current = {
      x: x ?? r.width / 2,
      y: py,
      left: root.scrollLeft,
      top: root.scrollTop,
      zoom: zoomRef.current,
      page: Number(sheet?.dataset.pdfPage || 1),
      fraction: sheet
        ? (root.scrollTop + py - sheet.offsetTop) / sheet.offsetHeight
        : 0,
      fractionX: sheet ? (root.scrollLeft + (x ?? r.width / 2) - sheet.offsetLeft) / sheet.offsetWidth : 0,
    };
    setMenu(null);
    setZoom(Math.min(4, Math.max(0.5, next)));
  };
  useEffect(() => {
    const root = area.current;
    if (!root) return;
    const wheel = (e: WheelEvent) => {
      e.stopPropagation();
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const r = root.getBoundingClientRect();
      changeZoom(
        zoomRef.current * Math.exp(-e.deltaY * 0.008),
        e.clientX - r.left,
        e.clientY - r.top,
      );
    };
    root.addEventListener('wheel', wheel, { passive: false });
    return () => root.removeEventListener('wheel', wheel);
  }, []);
  useLayoutEffect(() => {
    const a = anchor.current,
      root = area.current;
    if (a && root) {
      const ratio = zoom / a.zoom;
      const sheet = root.querySelector<HTMLElement>(
        `[data-pdf-page="${a.page}"]`,
      );
      root.scrollLeft = horizontalPages && sheet
        ? sheet.offsetLeft + a.fractionX * sheet.offsetWidth - a.x
        : (a.left + a.x) * ratio - a.x;
      root.scrollTop = sheet
        ? sheet.offsetTop + a.fraction * sheet.offsetHeight - a.y
        : (a.top + a.y) * ratio - a.y;
      anchor.current = null;
    }
  }, [zoom]);
  useLayoutEffect(() => {
    if (initialPage !== undefined || focusMark || focusRequest)
      cancelReadingRestore();
  }, [initialPage, focusMark, focusRequest, cancelReadingRestore]);
  useLayoutEffect(() => {
    captureSession.current = () => {
      const root = area.current;
      if (layout !== 'expanded' || pendingRestore.current || !root || !pdf ||
        !measuredWidth.current ||
        (pdf as PDFDocumentProxy & { __lumiorUrl?: string }).__lumiorUrl !== url)
        return;
      const source = readingGeometry(root, horizontalPages);
      if (!source.pages.length) return;
      if (!horizontalPages && !resizeAnchor.capture(source.viewport, source.pages)) return;
      const visiblePage = source.pages.find(sheet => horizontalPages
        ? sheet.left + sheet.width > source.viewport.scrollLeft + 40
        : sheet.top + sheet.height > source.viewport.scrollTop + 40)?.page || page;
      const translatedRoot = translationArea.current;
      if (translationOpen && translatedRoot) {
        const translated = readingGeometry(translatedRoot);
        if (translated.pages.length)
          translationScroll.current = capturePdfReadingScroll(translated.viewport, translated.pages);
      }
      readingSession.save({
        ...capturePdfReadingScroll(source.viewport, source.pages),
        page: visiblePage,
        zoom,
        translationOpen,
        translation: translationScroll.current,
        pageRatios: Object.fromEntries(source.pages
          .filter(sheet => sheet.width > 0 && sheet.height > 0)
          .map(sheet => [sheet.page, sheet.height / sheet.width])),
      });
    };
    queueSessionSave();
  });
  // Layout cleanup can still read the departing DOM, including a final scroll
  // event that has not reached its scheduled animation frame yet.
  useLayoutEffect(() => () => {
    captureSession.current();
    if (saveFrame.current !== undefined) cancelAnimationFrame(saveFrame.current);
    saveFrame.current = undefined;
  }, [sessionKey]);
  useEffect(() => {
    const viewer = readerRoot.current;
    if (layout !== 'expanded' || !viewer) return;
    const observer = new ResizeObserver(queueSessionSave);
    const observePages = () => {
      observer.observe(viewer);
      for (const element of viewer.querySelectorAll<HTMLElement>(
        '.pdf-page-area, .pdf-translation-pages, [data-pdf-page]',
      )) observer.observe(element);
    };
    observePages();
    const mutations = new MutationObserver(records => {
      if (records.some(record => [...record.addedNodes].some(node =>
        node instanceof Element && (node.matches('[data-pdf-page]') ||
          node.querySelector('[data-pdf-page]'))))) observePages();
      queueSessionSave();
    });
    mutations.observe(viewer, { childList: true, subtree: true });
    viewer.addEventListener('scroll', queueSessionSave, { capture: true, passive: true });
    return () => {
      mutations.disconnect();
      observer.disconnect();
      viewer.removeEventListener('scroll', queueSessionSave, true);
    };
  }, [layout, pdf, translationOpen, sessionKey, queueSessionSave]);
  useEffect(() => {
    const snapshot = pendingRestore.current;
    const root = area.current;
    const viewer = readerRoot.current;
    if (layout !== 'expanded' || !restoringSession || !snapshot || !pdf || !root || !viewer ||
      !measuredWidth.current || renderWidth <= 0 || width <= 0 ||
      (pdf as PDFDocumentProxy & { __lumiorUrl?: string }).__lumiorUrl !== url)
      return;
    let live = true, prepared = false, queued = false, lastGeometry = '';
    let settle: ReturnType<typeof setTimeout> | undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const frames = new Set<number>();
    const nextFrame = (callback: () => void) => {
      const id = requestAnimationFrame(() => {
        frames.delete(id);
        if (live) callback();
      });
      frames.add(id);
    };
    const finish = () => {
      if (!live || pendingRestore.current !== snapshot) return;
      pendingRestore.current = undefined;
      requestedPage.current = null;
      setRestoringSession(false);
      queueSessionSave();
    };
    const apply = (force = false) => {
      if (!live || !prepared || pendingRestore.current !== snapshot) return;
      const source = readingGeometry(root, horizontalPages);
      const anchorPage = snapshot.anchor?.page || snapshot.page;
      const sheet = source.pages.find(value => value.page === anchorPage) || source.pages.at(-1);
      if (!sheet || !source.viewport.width || !source.viewport.height) return;
      root.scrollTo({ ...restorePdfReadingScroll(snapshot, source.viewport, source.pages), behavior: 'instant' });
      const translatedRoot = translationArea.current;
      const translated = translatedRoot ? readingGeometry(translatedRoot) : undefined;
      const cache = translator.translation;
      const expectsTranslation = translationOpen && !!snapshot.translation && !!cache &&
        (translator.requestedMode === 'original-layout'
          ? cache.mode === 'original-layout' && cache.complete && !!cache.layout
          : cache.mode !== 'original-layout' && cache.units.length > 0);
      const translatedSheet = translatedRoot?.querySelector<HTMLElement>(snapshot.translation?.anchor
        ? `[data-pdf-page="${snapshot.translation.anchor.page}"]`
        : '[data-pdf-page]');
      // First move its placeholder into view, so lazy painting can obtain the
      // true dimensions; only then consider the translated position settled.
      if (translatedRoot && translated && snapshot.translation && (translatedSheet || force))
        translatedRoot.scrollTo({
          ...restorePdfReadingScroll(snapshot.translation, translated.viewport, translated.pages),
          behavior: 'instant',
        });
      const translatedCanvas = translatedSheet?.querySelector('canvas');
      const translatedImage = translatedSheet?.querySelector('img');
      const translatedReady = !expectsTranslation || !!translatedSheet && (
        !!translatedCanvas?.hasAttribute('width') ||
        !!translatedImage?.complete && translatedImage.naturalWidth > 0 ||
        !!translatedSheet.querySelector('[role="alert"]')
      );
      const geometry = JSON.stringify([
        source.viewport.width, source.viewport.height, source.viewport.scrollHeight,
        sheet, translated?.viewport.width, translated?.viewport.height,
        translated?.viewport.scrollHeight, translated?.pages,
      ]);
      if (geometry !== lastGeometry || !translatedReady) {
        lastGeometry = geometry;
        clearTimeout(settle);
        settle = undefined;
      }
      if (translatedReady && settle === undefined)
        settle = setTimeout(finish, 180);
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      nextFrame(() => { queued = false; apply(); });
    };
    const observer = new ResizeObserver(queue);
    const observePages = () => {
      observer.observe(root);
      if (translationArea.current) observer.observe(translationArea.current);
      for (const sheet of viewer.querySelectorAll<HTMLElement>('[data-pdf-page]'))
        observer.observe(sheet);
    };
    const mutations = new MutationObserver(() => { observePages(); queue(); });
    mutations.observe(viewer, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'],
    });
    observePages();
    const target = Math.max(1, Math.min(pdf.numPages, snapshot.anchor?.page || snapshot.page));
    const nearby = [...new Set([1, 2, 3, target - 2, target - 1, target, target + 1, target + 2])]
      .filter(number => number >= 1 && number <= pdf.numPages);
    void Promise.all(nearby.map(async number => {
      try {
        const sheet = await pdf.getPage(number);
        const viewport = sheet.getViewport({ scale: 1 });
        return [number, viewport.height / viewport.width] as const;
      } catch { return null; }
    })).then(values => {
      if (!live || pendingRestore.current !== snapshot) return;
      setSessionPageRatios(previous => ({
        ...previous,
        ...Object.fromEntries(values.filter(value => value !== null)),
      }));
      // Commit the real page ratios and the observed pane width before scrolling.
      nextFrame(() => nextFrame(() => {
        prepared = true;
        apply();
        deadline = setTimeout(() => { apply(true); finish(); }, 8000);
      }));
    });
    return () => {
      live = false;
      clearTimeout(settle);
      clearTimeout(deadline);
      for (const frame of frames) cancelAnimationFrame(frame);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [layout, restoringSession, pdf, width, renderWidth, zoom, translationOpen,
    sessionKey, url, horizontalPages, translator.translation, translator.requestedMode,
    initialPage, focusMark, focusRequest, queueSessionSave]);
  useEffect(() => {
    // Clearing an AI citation must not reset the user's reading position.
    if (!pdf || (initialPage === undefined && !focusMark)) return;
    const id = requestAnimationFrame(() => {
      const root = area.current;
      if (!root) return;
      const fragment = focusMark?.fragments[0],
        n = Math.min(
          pdf.numPages,
          Math.max(1, fragment?.page || initialPage || 1),
        );
      const el = root.querySelector<HTMLElement>(`[data-pdf-page="${n}"]`);
      if (el) {
        requestedPage.current = n;
        root.scrollTo({
          ...(horizontalPages ? { left: el.offsetLeft - 12 } : {}),
          top:
            el.offsetTop +
            ((fragment?.rects[0]?.y || 0) / 100) * el.offsetHeight -
            (fragment ? 80 : 12),
        });
        setPage(n);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [pdf, initialPage, focusMark, focusRequest, horizontalPages]);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (
        !(e.target as HTMLElement).closest(
          '.pdf-selection-toolbar,.pdf-highlight-mark,.pdf-note-marker',
        )
      )
        setMenu(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenu(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  const selectText = (point: CursorPoint) => {
    if (markDrag.current?.pending()) return;
    const selection = window.getSelection();
    if (
      !selection ||
      selection.isCollapsed ||
      !selection.rangeCount ||
      !area.current
    )
      return;
    const range = selection.getRangeAt(0);
    if (
      !area.current.contains(range.startContainer) ||
      !area.current.contains(range.endContainer)
    )
      return;
    const text = selection.toString().trim();
    if (!text) return;
    const fragments: PdfMark['fragments'] = [];
    for (const sheet of area.current.querySelectorAll<HTMLElement>(
      '.pdf-sheet',
    )) {
      const box = sheet.getBoundingClientRect();
      const rects: PdfRect[] = [];
      for (const span of sheet.querySelectorAll('.pdf-selectable-text span')) {
        if (
          !range.intersectsNode(span) ||
          !span.firstChild ||
          span.children.length
        )
          continue;
        const piece = document.createRange();
        piece.selectNodeContents(span);
        if (span.contains(range.startContainer))
          piece.setStart(range.startContainer, range.startOffset);
        if (span.contains(range.endContainer))
          piece.setEnd(range.endContainer, range.endOffset);
        for (const r of piece.getClientRects()) {
          if (r.width < 0.5 || r.height < 0.5) continue;
          rects.push({
            x: ((r.left - box.left) / box.width) * 100,
            y: ((r.top - box.top) / box.height) * 100,
            width: (r.width / box.width) * 100,
            height: (r.height / box.height) * 100,
          });
        }
      }
      if (rects.length)
        fragments.push({ page: Number(sheet.dataset.pdfPage), rects });
    }
    if (!fragments.length) return;
    selectionEnd.current = point;
    setMenu({
      mark: { id: crypto.randomUUID(), text, color: colors[0], fragments },
      ...selectionToolbarPosition(point, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
      saved: false,
    });
  };
  const down: MarkGesture = (e, mark) => {
    e.stopPropagation();
    e.preventDefault();
    if (e.button !== 0) return;
    markDrag.current ??= createPdfMarkDrag({
      onPreview: preview => dragCallbacks.current.preview(preview),
      onDrop: (mark, point) => dragCallbacks.current.drop(mark, point),
    });
    markDrag.current.start(e, mark);
    selectionEnd.current = { x: e.clientX, y: e.clientY };
    setMenu({
      mark,
      ...selectionToolbarPosition(selectionEnd.current, {
        width: window.innerWidth,
        height: window.innerHeight,
      }),
      saved: true,
    });
  };
  const move: MarkGesture = e => markDrag.current?.move(e);
  const up: MarkGesture = e => {
    e.stopPropagation?.();
    markDrag.current?.end(e);
  };
  const gestures = useRef({ down, move, up });
  gestures.current = { down, move, up };
  const handleDown = useCallback<MarkGesture>(
    (e, m) => gestures.current.down(e, m),
    [],
  );
  const handleMove = useCallback<MarkGesture>(
    (e, m) => gestures.current.move(e, m),
    [],
  );
  const handleUp = useCallback<MarkGesture>(
    (e, m) => gestures.current.up(e, m),
    [],
  );
  const color = (value: string) => {
    if (!menu) return;
    const mark = { ...menu.mark, color: value };
    annotations.save(url, mark);
    window.getSelection()?.removeAllRanges();
    setMenu({ ...menu, mark, saved: true });
  };
  const controls = (
    <div
      className="pdf-controls"
      role="toolbar"
      aria-label={t('PDF reading tools', 'PDF 阅读工具')}
    >
      {PDF_TRANSLATION_ENABLED && <button
        aria-label={t('Translate PDF with AI', 'AI 翻译 PDF')}
        title={t(
          'AI translation · Translate into Chinese',
          'AI 翻译 · 自动译成中文',
        )}
        aria-pressed={translationOpen}
        onClick={toggleTranslation}
      >
        <span className="pdf-translation-icon" aria-hidden="true" />
      </button>}
      <PdfRegionExcerpt area={area} card={card} />
      <button
        aria-label={t('Search PDF text', '搜索 PDF 文本')}
        title={t('Search PDF', '搜索 PDF')}
        onClick={() => setSearchOpen((v) => !v)}
      >
        <img src="/assets/pdf-toolbar/search.svg" alt="" />
      </button>
      <span className="tool-divider" />
      {horizontalPages && <button
        aria-label={t('Previous PDF page', 'PDF 上一页')}
        disabled={page <= 1}
        onClick={() => jumpPage(page - 1)}
      ><ChevronLeft size={16} /></button>}
      <PdfPageControl
        page={page}
        total={pdf?.numPages || card.pdf!.pages}
        onPage={jumpPage}
      />
      {horizontalPages && <button
        aria-label={t('Next PDF page', 'PDF 下一页')}
        disabled={page >= (pdf?.numPages || card.pdf!.pages)}
        onClick={() => jumpPage(page + 1)}
      ><ChevronRight size={16} /></button>}
      <span className="tool-divider" />
      <button
        data-pdf-action="zoom-out"
        aria-label={t('Zoom PDF out', '缩小 PDF')}
        disabled={zoom <= 0.5}
        onClick={() => changeZoom(zoom - 0.25)}
      >
        <img src="/assets/pdf-toolbar/minus.svg" alt="" />
      </button>
      <button
        data-pdf-action="fit-width"
        aria-label={t('Fit PDF width', '适应 PDF 宽度')}
        onClick={() => changeZoom(1)}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        data-pdf-action="zoom-in"
        aria-label={t('Zoom PDF in', '放大 PDF')}
        disabled={zoom >= 4}
        onClick={() => changeZoom(zoom + 0.25)}
      >
        <img src="/assets/pdf-toolbar/plus.svg" alt="" />
      </button>
      {translationOpen && (
        <>
          <span className="tool-divider" />
          <div
            className="pdf-translation-actions-slot"
            ref={setTranslationControls}
          />
        </>
      )}
    </div>
  );
  return (
    <div
      ref={readerRoot}
      className={`pdf-viewer pdf-layout-${layout} ${horizontalPages ? 'pdf-page-flow-horizontal' : ''} ${translationOpen ? 'pdf-viewer-translating' : layout === 'expanded' && aiOpen && showReadingNotes ? 'pdf-viewer-notes-drawer' : ''}`}
      data-reading-notes={showReadingNotes}
      data-page-flow={horizontalPages ? 'horizontal' : 'vertical'}
      aria-label={t('PDF preview: {title}', 'PDF 预览：{title}', {
        title: card.title,
      })}
      onPointerDownCapture={(event) => {
        cancelReadingRestore(true);
        if ((event.target as HTMLElement).closest('.pdf-notes-drawer-handle'))
          setMenu(null);
      }}
      onWheelCapture={() => cancelReadingRestore(true)}
      onKeyDownCapture={() => cancelReadingRestore(true)}
      onKeyDown={(e) => {
        if (horizontalPages && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey &&
          !((e.target as HTMLElement).closest('input,textarea,[contenteditable="true"]')) &&
          (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          e.stopPropagation();
          jumpPage(page + (e.key === 'ArrowRight' ? 1 : -1));
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
          e.preventDefault();
          e.stopPropagation();
          setSearchOpen(true);
        }
      }}
    >
      {layout === 'expanded' && (
        <PdfNavigation pdf={pdf} page={page} onPage={jumpPage} />
      )}
      <div className="pdf-paper-column">
        {searchOpen && (
          <div className="pdf-search-bar">
            <Search size={15} />
            <input
              autoFocus
              aria-label={t('Search PDF', '搜索 PDF')}
              placeholder={t('Search PDF…', '搜索 PDF…')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hits.length)
                  setHitIndex(
                    (i) =>
                      (i + (e.shiftKey ? hits.length - 1 : 1)) % hits.length,
                  );
              }}
            />
            <span role="status">
              {searching
                ? t('Searching…', '搜索中…')
                : query
                  ? hits.length
                    ? `${hitIndex + 1}/${hits.length}`
                    : t('No results', '无结果')
                  : ''}
            </span>
            <button
              aria-label={t('Previous result', '上一个结果')}
              disabled={!hits.length}
              onClick={() =>
                setHitIndex((i) => (i + hits.length - 1) % hits.length)
              }
            >
              <ChevronUp size={15} />
            </button>
            <button
              aria-label={t('Next result', '下一个结果')}
              disabled={!hits.length}
              onClick={() => setHitIndex((i) => (i + 1) % hits.length)}
            >
              <ChevronDown size={15} />
            </button>
            <button
              aria-label={t('Close PDF search', '关闭 PDF 搜索')}
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        {layout === 'expanded' && controlsTarget
          ? createPortal(controls, controlsTarget)
          : controls}
        <div
          ref={area}
          className="pdf-page-area"
          onWheelCapture={() => {
            requestedPage.current = null;
          }}
          onPointerDownCapture={() => {
            requestedPage.current = null;
          }}
          onKeyDownCapture={() => {
            requestedPage.current = null;
          }}
          onPointerUp={(event) => {
            if (event.button !== 0) return;
            const point = { x: event.clientX, y: event.clientY };
            requestAnimationFrame(() => selectText(point));
          }}
          onScroll={(event) => {
            if (layout === 'expanded' && !horizontalPages && !pendingRestore.current) {
              const root = event.currentTarget;
              // A sidebar may open before the deferred session save runs.
              // Capture this scroll now against the last stable page geometry.
              resizeAnchor.scroll({
                scrollLeft: root.scrollLeft,
                scrollTop: root.scrollTop,
                width: root.clientWidth,
                height: root.clientHeight,
              });
            }
            setMenu(null);
            queueSessionSave();
          }}
        >
          {error ? (
            <p role="alert">{pdfSystemMessage(error)}</p>
          ) : pdf ? (
            Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage
                key={i}
                pdf={pdf}
                number={i + 1}
                width={width}
                renderWidth={renderWidth}
                zoom={zoom}
                rasterZoom={rasterZoom}
                defaultRatio={sessionPageRatios[i + 1] || pageRatio}
                hits={hits}
                activeHit={hits[hitIndex]}
                root={area}
                highlight={i + 1 === initialPage ? highlight : undefined}
                marks={displayed}
                onMarkDown={handleDown}
                onMarkMove={handleMove}
                onMarkUp={handleUp}
                hoverRects={
                  translationOpen ? sourceHoverRects.get(i + 1) : undefined
                }
                hoverId={translationOpen ? hoveredPart : undefined}
                onHover={
                  translationOpen ? (id) => hoverPart('source', id) : undefined
                }
              />
            ))
          ) : (
            <p role="status">{t('Loading PDF…', '正在加载 PDF…')}</p>
          )}
        </div>
      </div>
      {translationOpen ? (
        <PdfTranslationPanel
          card={card}
          {...translator}
          controlsTarget={translationControls}
          statusTarget={translationStatusTarget}
          onScrollRoot={registerTranslationRoot}
          onScrollPages={registerTranslationPages}
          onScrollIntent={clearRequestedPage}
          hoverId={hoveredPart}
          onHover={(id) => hoverPart('translation', id)}
          zoom={zoom}
          rasterZoom={rasterZoom}
          onPage={jumpPage}
          onRetry={() => void translator.start(translator.requestedMode, true)}
          onStop={translator.stop}
          onReflow={() => void translator.start('reflow')}
          onOriginal={() => void translator.start('original-layout')}
          onCreated={onTranslationCreated}
        />
      ) : (
        layout === 'expanded' && showReadingNotes &&
        (aiOpen ? (
          <PdfNotesDrawer
            card={card}
            cards={excerptCards}
            page={page}
            onPage={jumpPage}
            onNoteChange={onNoteChange}
            linkedCards={linkedCards}
            onCardChange={onCardChange}
          />
        ) : (
          <PdfReadingNotes
            card={card}
            cards={excerptCards}
            page={page}
            onPage={jumpPage}
            onNoteChange={onNoteChange}
            linkedCards={linkedCards}
            onCardChange={onCardChange}
          />
        ))
      )}
      <PdfTranslationConfirmation
        open={translationConfirmation}
        remember={rememberTranslationConsent}
        onRemember={setRememberTranslationConsent}
        onOpenChange={setTranslationConfirmation}
        onConfirm={() => {
          acknowledgeTranslationConsent(
            card.pdf!.url,
            rememberTranslationConsent,
          );
          setTranslationConfirmation(false);
          openTranslation();
        }}
      />
      {menu &&
        createPortal(
          <PdfAnnotationEditor
            key={menu.mark.id}
            toolbarRef={selectionToolbar}
            anchor={selectionEnd.current}
            opacity={menuOpacity}
            note={menu.mark.note || ''}
            onNoteChange={note => setMenu({ ...menu, mark: { ...menu.mark, note } })}
            copyText={menu.mark.image ? undefined : menu.mark.text}
            allowEmpty={!!menu.mark.image}
            color={menu.saved ? menu.mark.color : undefined}
            onColorChange={menu.mark.image ? undefined : color}
            canDelete={menu.saved}
            onDelete={() => {
              annotations.remove(url, menu.mark.id);
              setMenu(null);
            }}
            onSave={() => {
              annotations.save(url, menu.mark);
              onNoteChange?.(menu.mark.id, menu.mark.note || '');
              window.getSelection()?.removeAllRanges();
              setMenu(null);
            }}
          />,
          document.body,
        )}
      {ghost &&
        createPortal(
          <div
            className="pdf-excerpt-ghost"
            style={{
              left: ghost.x + 16,
              top: ghost.y + 16,
              borderColor: ghost.mark.color,
            }}
          >
            <span style={{ background: ghost.mark.color }} />
            <strong>
              {t('PDF excerpt · Page {page}', 'PDF 摘录 · 第 {page} 页', {
                page: ghost.mark.fragments[0].page,
              })}
            </strong>
            <p>{ghost.mark.text.slice(0, 180)}</p>
            <small>
              {t('Release to place on the whiteboard', '松开放到画板')}
            </small>
          </div>,
          document.body,
        )}
    </div>
  );
}
