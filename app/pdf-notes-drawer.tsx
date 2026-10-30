'use client';
import { useI18n } from './i18n';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  PdfReadingNotes,
  usePdfReadingNoteCount,
  type PdfReadingNotesProps,
} from './pdf-reading-notes';
import './pdf-notes-drawer.css';

const COLLAPSED_HEIGHT = 46;
const MIN_OPEN_HEIGHT = 160;
const COLLAPSE_THRESHOLD = 96;
const DEFAULT_RATIO = 0.58;
type Drag = {
  pointerId: number;
  y: number;
  height: number;
  parentHeight: number;
  currentHeight: number;
  moved: boolean;
};

/** The drawer shares the existing notes list; only its presentation changes. */
export function PdfNotesDrawer(props: PdfReadingNotesProps) {
  const { t } = useI18n();
  const count = usePdfReadingNoteCount(props);
  const contentId = useId();
  const drawer = useRef<HTMLElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const drag = useRef<Drag | null>(null);
  const suppressClick = useRef(false);
  const lastRatio = useRef(DEFAULT_RATIO);
  const [ratio, setRatio] = useState(0);
  const [parentHeight, setParentHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const maxHeight = Math.max(COLLAPSED_HEIGHT, Math.floor(parentHeight * 0.84));
  const height = ratio
    ? Math.min(
        maxHeight,
        Math.max(COLLAPSED_HEIGHT, Math.round(parentHeight * ratio)),
      )
    : COLLAPSED_HEIGHT;
  const expanded = ratio > 0;

  useLayoutEffect(() => {
    const parent = drawer.current?.parentElement;
    if (!parent) return;
    const measure = () =>
      setParentHeight(parent.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const parent = drawer.current?.parentElement;
    if (!expanded || !parent) return;
    let press: {
      pointerId: number;
      x: number;
      y: number;
      target: Element;
    } | null = null;
    // Match only empty surfaces, never PDF pages or note/editor descendants.
    const isBlank = (target: EventTarget | null): target is Element =>
      target instanceof Element &&
      (target === parent ||
        target === drawer.current ||
        target.matches(
          '.pdf-page-area, .pdf-paper-column, .pdf-notes-drawer-content, .pdf-reading-notes, .pdf-reading-notes-scroll',
        ));
    const cancel = () => {
      press = null;
    };
    const onDown = (event: globalThis.PointerEvent) => {
      press =
        event.button === 0 && event.isPrimary && isBlank(event.target)
          ? {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              target: event.target,
            }
          : null;
    };
    const onMove = (event: globalThis.PointerEvent) => {
      if (
        press?.pointerId === event.pointerId &&
        Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6
      )
        cancel();
    };
    const onUp = (event: globalThis.PointerEvent) => {
      const start = press;
      cancel();
      if (
        !start ||
        event.button !== 0 ||
        start.pointerId !== event.pointerId ||
        start.target !== event.target ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6 ||
        window.getSelection()?.isCollapsed === false
      )
        return;
      lastRatio.current = ratio;
      setRatio(0);
    };
    parent.addEventListener('pointerdown', onDown, true);
    parent.addEventListener('pointermove', onMove, true);
    parent.addEventListener('pointerup', onUp, true);
    parent.addEventListener('pointercancel', cancel, true);
    parent.addEventListener('scroll', cancel, true);
    parent.addEventListener('wheel', cancel, { capture: true, passive: true });
    return () => {
      parent.removeEventListener('pointerdown', onDown, true);
      parent.removeEventListener('pointermove', onMove, true);
      parent.removeEventListener('pointerup', onUp, true);
      parent.removeEventListener('pointercancel', cancel, true);
      parent.removeEventListener('scroll', cancel, true);
      parent.removeEventListener('wheel', cancel, true);
    };
  }, [expanded, ratio]);

  const close = () => {
    if (ratio) lastRatio.current = ratio;
    setRatio(0);
  };
  const open = () => setRatio(lastRatio.current || DEFAULT_RATIO);
  const setHeight = (next: number) => {
    const bounded = Math.min(maxHeight, Math.max(COLLAPSED_HEIGHT, next));
    setRatio(
      bounded <= COLLAPSED_HEIGHT ? 0 : bounded / Math.max(1, parentHeight),
    );
  };
  const startDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    window.getSelection()?.removeAllRanges();
    event.currentTarget.focus({ preventScroll: true });
    suppressClick.current = false;
    drag.current = {
      pointerId: event.pointerId,
      y: event.clientY,
      height,
      parentHeight,
      currentHeight: height,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const delta = current.y - event.clientY;
    if (!current.moved && Math.abs(delta) < 4) return;
    event.preventDefault();
    event.stopPropagation();
    current.moved = true;
    current.currentHeight = Math.min(
      Math.max(COLLAPSED_HEIGHT, Math.floor(current.parentHeight * 0.84)),
      Math.max(COLLAPSED_HEIGHT, current.height + delta),
    );
    setDragging(true);
    setRatio(
      current.currentHeight <= COLLAPSED_HEIGHT
        ? 0
        : current.currentHeight / Math.max(1, current.parentHeight),
    );
  };
  const finishDrag = (
    event: PointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (cancelled) {
      setRatio(
        current.height === COLLAPSED_HEIGHT
          ? 0
          : current.height / Math.max(1, current.parentHeight),
      );
      suppressClick.current = false;
      return;
    }
    if (!current.moved) return;
    suppressClick.current = true;
    if (current.currentHeight < COLLAPSE_THRESHOLD) setRatio(0);
    else {
      const nextRatio =
        Math.min(
          Math.max(COLLAPSED_HEIGHT, current.parentHeight * 0.84),
          Math.max(
            Math.min(MIN_OPEN_HEIGHT, current.parentHeight * 0.84),
            current.currentHeight,
          ),
        ) / Math.max(1, current.parentHeight);
      lastRatio.current = nextRatio;
      setRatio(nextRatio);
    }
  };

  return (
    <aside
      ref={drawer}
      className="pdf-notes-drawer"
      aria-label={t('PDF notes drawer', 'PDF 笔记抽屉')}
      data-expanded={expanded}
      data-dragging={dragging}
      style={{ height }}
    >
      <button
        ref={handle}
        className="pdf-notes-drawer-handle"
        aria-label={
          expanded
            ? t('Collapse PDF notes', '收起 PDF 笔记')
            : t('Expand PDF notes', '展开 PDF 笔记')
        }
        aria-expanded={expanded}
        aria-controls={contentId}
        title={t(
          'Click to expand or collapse; drag upward to resize',
          '点击展开或收起，向上拖动可调整高度',
        )}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => finishDrag(event)}
        onPointerCancel={(event) => finishDrag(event, true)}
        onLostPointerCapture={(event) => finishDrag(event, true)}
        onClick={(event) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            if (event.detail) return;
          }
          if (expanded) close();
          else open();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
            return;
          event.preventDefault();
          event.stopPropagation();
          if (event.key === 'Home') close();
          else if (event.key === 'End') setHeight(maxHeight);
          else if (event.key === 'ArrowUp') {
            if (expanded) setHeight(height + 48);
            else open();
          } else if (expanded) {
            if (height - 48 < MIN_OPEN_HEIGHT) close();
            else setHeight(height - 48);
          }
        }}
      >
        <span className="pdf-notes-drawer-grip" aria-hidden="true" />
        <span className="pdf-notes-drawer-label">
          {t('Notes', '笔记')}{' '}
          <span className="pdf-notes-drawer-count">{count}</span>
        </span>
        {expanded ? (
          <ChevronDown size={16} aria-hidden="true" />
        ) : (
          <ChevronUp size={16} aria-hidden="true" />
        )}
      </button>
      <div
        id={contentId}
        className="pdf-notes-drawer-content"
        hidden={!expanded}
      >
        <PdfReadingNotes {...props} />
      </div>
    </aside>
  );
}
