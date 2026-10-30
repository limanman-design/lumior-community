'use client';
import { useI18n } from './i18n';
import { translate as tr } from './i18n-core';
import { pdfSystemMessage } from './pdf-system-messages';
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PdfMark, PdfRect } from './pdf-annotations';
import { getPdfText, preparePdfPage } from './pdf-page-paint';
export { getPdfText } from './pdf-page-paint';
export type MarkGesture = (e: React.PointerEvent, mark: PdfMark) => void;
function urlForPage(pdf: PDFDocumentProxy, number: number) {
  return (pdf as PDFDocumentProxy & { __lumiorUrl?: string }).__lumiorUrl ===
    '/research/bloch-review.pdf'
    ? `/research/bloch-pages/page-${String(number).padStart(2, '0')}.jpg`
    : null;
}
export type SearchHit = { page: number; start: number; end: number };
export const PdfPage = memo(
  function PdfPage({
    pdf,
    number,
    width,
    renderWidth = width,
    zoom,
    rasterZoom,
    defaultRatio = 1.3,
    hits,
    activeHit,
    root,
    highlight,
    marks,
    onMarkDown,
    onMarkMove,
    onMarkUp,
    hoverRects = [],
    hoverId,
    onHover,
  }: {
    pdf: PDFDocumentProxy;
    number: number;
    width: number;
    renderWidth?: number;
    zoom: number;
    rasterZoom: number;
    defaultRatio?: number;
    hits: SearchHit[];
    activeHit?: SearchHit;
    root: React.RefObject<HTMLDivElement | null>;
    highlight?: PdfRect;
    marks: PdfMark[];
    onMarkDown: MarkGesture;
    onMarkMove: MarkGesture;
    onMarkUp: MarkGesture;
    hoverRects?: { id: string; rect: PdfRect }[];
    hoverId?: string;
    onHover?: (id?: string) => void;
  }) {
    const { t } = useI18n();
    const holder = useRef<HTMLDivElement>(null),
      canvas = useRef<HTMLCanvasElement>(null),
      text = useRef<HTMLDivElement>(null);
    const [near, setNear] = useState(false),
      [pageRatio, setRatio] = useState<number | undefined>(),
      [error, setError] = useState('');
    const ratio = pageRatio ?? defaultRatio;
    const hoverTargets = useMemo(() => {
      const groups = new Map<string, PdfRect>();
      for (const { id, rect } of hoverRects) {
        const old = groups.get(id);
        if (!old) groups.set(id, { ...rect });
        else {
          const x = Math.min(old.x, rect.x),
            y = Math.min(old.y, rect.y);
          groups.set(id, {
            x,
            y,
            width: Math.max(old.x + old.width, rect.x + rect.width) - x,
            height: Math.max(old.y + old.height, rect.y + rect.height) - y,
          });
        }
      }
      return [...groups].map(([id, rect]) => ({ id, rect }));
    }, [hoverRects]);
    const commentMarkers = useMemo(() => {
      const comments = marks.flatMap((mark) => {
        if (!mark.note?.trim()) return [];
        const fragments = mark.fragments
          .filter((fragment) => fragment.rects.length)
          .toSorted((a, b) => a.page - b.page);
        const first = fragments[0],
          last = fragments.at(-1);
        if (!first || !last) return [];
        const start = first.rects[0];
        return [{ mark, first, last, start }];
      });
      // Position-based numbering stays consistent when editing reorders saved marks.
      comments.sort(
        (a, b) =>
          a.first.page - b.first.page ||
          a.start.y - b.start.y ||
          a.start.x - b.start.x ||
          a.mark.id.localeCompare(b.mark.id),
      );
      return comments.map(({ mark, last }, index) => {
        const right = Math.max(
          ...last.rects.map((rect) => rect.x + rect.width),
        );
        const line = last.rects.find(
          (rect) => Math.abs(rect.x + rect.width - right) < 0.1,
        )!;
        // Place the badge beside the first line reaching the excerpt's outer edge.
        return {
          mark,
          label: index + 1,
          page: last.page,
          x: right,
          y: line.y + line.height / 2,
        };
      });
    }, [marks]);
    const pageWidth = Math.max(80, width - 24) * zoom;
    const preRendered = urlForPage(pdf, number);
    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => setNear(entry.isIntersecting),
        // Paint before the page reaches the viewport. Leaving the viewport
        // alone no longer tears down its canvas and text layer immediately.
        { root: root.current, rootMargin: '900px 0px' },
      );
      if (holder.current) observer.observe(holder.current);
      return () => observer.disconnect();
    }, [root]);
    useEffect(() => {
      if (!near || renderWidth <= 0) return;
      let live = true;
      const controller = new AbortController();
      setError('');
      if (!preRendered) {
        void preparePdfPage(pdf, number, renderWidth, rasterZoom, {
          signal: controller.signal,
          priority: () => {
            const sheet = holder.current?.getBoundingClientRect(),
              viewport = root.current?.getBoundingClientRect();
            return sheet &&
              viewport &&
              sheet.bottom > viewport.top &&
              sheet.top < viewport.bottom
              ? 0
              : 1;
          },
        })
          .then((paint) => {
            if (!live || !canvas.current || !text.current) return;
            setRatio(paint.ratio);
            canvas.current.width = paint.bitmap.width;
            canvas.current.height = paint.bitmap.height;
            canvas.current.getContext('2d')?.drawImage(paint.bitmap, 0, 0);
            const staged = paint.text.cloneNode(true) as HTMLElement;
            text.current.style.setProperty(
              '--total-scale-factor',
              String(paint.scale),
            );
            text.current.style.setProperty(
              '--min-font-size',
              staged.style.getPropertyValue('--min-font-size'),
            );
            text.current.replaceChildren(...Array.from(staged.childNodes));
          })
          .catch((error) => {
            if (
              live &&
              error.name !== 'RenderingCancelledException' &&
              error.name !== 'AbortException' &&
              error.name !== 'AbortError'
            )
              setError(
                tr(
                  'This page cannot be displayed right now.',
                  '此页暂时无法显示',
                ),
              );
          });
        return () => {
          live = false;
          controller.abort();
        };
      }
      pdf
        .getPage(number)
        .then(async (page) => {
          if (!live || (!canvas.current && !preRendered) || !text.current)
            return;
          const base = page.getViewport({ scale: 1 });
          setRatio(base.height / base.width);
          const viewport = page.getViewport({
            scale: (Math.max(80, renderWidth - 24) * rasterZoom) / base.width,
          });
          if (preRendered) {
            const content = await getPdfText(pdf, number);
            if (!live || !text.current) return;
            const container = text.current;
            container.replaceChildren();
            container.classList.add('pdf-light-text');
            const chunks: {
              x: number;
              y: number;
              width: number;
              height: number;
              value: string;
            }[] = [];
            for (const item of content.items) {
              if (!('str' in item) || !item.str) continue;
              const pt = viewport.convertToViewportPoint(
                item.transform[4],
                item.transform[5],
              );
              const x = pt[0],
                y = pt[1] - item.height * viewport.scale,
                w = item.width * viewport.scale,
                h = Math.max(3, item.height * viewport.scale);
              const last = chunks.at(-1);
              if (
                last &&
                Math.abs(last.y - y) < h * 0.32 &&
                x >= last.x + last.width - 3 &&
                x - last.x - last.width < Math.max(8, h * 0.8)
              ) {
                last.value +=
                  (x - last.x - last.width > h * 0.2 ? ' ' : '') + item.str;
                last.width = Math.max(last.width, x + w - last.x);
                last.height = Math.max(last.height, h);
              } else
                chunks.push({ x, y, width: w, height: h, value: item.str });
            }
            const fragment = document.createDocumentFragment();
            const measure = document.createElement('canvas').getContext('2d');
            for (const chunk of chunks) {
              const span = document.createElement('span');
              span.textContent = chunk.value;
              span.style.left = `${chunk.x}px`;
              span.style.top = `${chunk.y}px`;
              span.style.fontSize = `${chunk.height}px`;
              span.style.lineHeight = `${chunk.height}px`;
              if (measure) {
                measure.font = `${chunk.height}px Arial`;
                const width = measure.measureText(chunk.value).width;
                if (width > 0)
                  span.style.transform = `scaleX(${chunk.width / width})`;
              }
              fragment.append(span);
            }
            if (live) container.appendChild(fragment);
            return;
          }
        })
        .catch((e) => {
          if (
            live &&
            e.name !== 'RenderingCancelledException' &&
            e.name !== 'AbortException'
          )
            setError(
              tr(
                'This page cannot be displayed right now.',
                '此页暂时无法显示',
              ),
            );
        });
      return () => {
        live = false;
        controller.abort();
      };
    }, [pdf, number, renderWidth, rasterZoom, near]);
    const [searchRects, setSearchRects] = useState<
      { rect: PdfRect; active: boolean }[]
    >([]);
    useEffect(() => {
      let live = true;
      if (!near || !hits.length) {
        setSearchRects([]);
        return;
      }
      getPdfText(pdf, number).then((content) => {
        pdf.getPage(number).then((p) => {
          if (!live) return;
          const v = p.getViewport({ scale: 1 });
          let offset = 0;
          const result: { rect: PdfRect; active: boolean }[] = [];
          for (const item of content.items) {
            if (!('str' in item)) continue;
            const start = offset,
              end = offset + item.str.length;
            for (const hit of hits) {
              if (hit.page !== number || hit.end <= start || hit.start >= end)
                continue;
              const a =
                  Math.max(0, hit.start - start) / Math.max(1, item.str.length),
                b =
                  Math.min(item.str.length, hit.end - start) /
                  Math.max(1, item.str.length);
              const point = v.convertToViewportPoint(
                item.transform[4],
                item.transform[5],
              );
              result.push({
                rect: {
                  x: ((point[0] + item.width * a) / v.width) * 100,
                  y: ((point[1] - item.height) / v.height) * 100,
                  width: ((item.width * (b - a)) / v.width) * 100,
                  height: (item.height / v.height) * 100,
                },
                active: hit === activeHit,
              });
            }
            offset = end + 1;
          }
          setSearchRects(result);
        });
      });
      return () => {
        live = false;
      };
    }, [pdf, number, near, hits, activeHit]);
    return (
      <div
        ref={holder}
        className="pdf-sheet"
        data-pdf-page={number}
        onPointerMove={(event) => {
          if (!onHover || event.buttons) return;
          const box = event.currentTarget.getBoundingClientRect(),
            x = ((event.clientX - box.left) / box.width) * 100,
            y = ((event.clientY - box.top) / box.height) * 100;
          onHover(
            hoverTargets.find(
              ({ rect }) =>
                x >= rect.x &&
                x <= rect.x + rect.width &&
                y >= rect.y &&
                y <= rect.y + rect.height,
            )?.id,
          );
        }}
        onPointerLeave={() => onHover?.(undefined)}
        style={{ width: pageWidth, height: pageWidth * ratio }}
      >
        {near && (
          <>
            {preRendered ? (
              <img
                className="pdf-prerendered-page"
                src={preRendered}
                alt={t('PDF page {page}', 'PDF 第 {page} 页', { page: number })}
                draggable={false}
              />
            ) : (
              <canvas
                ref={canvas}
                aria-label={t('PDF page {page}', 'PDF 第 {page} 页', {
                  page: number,
                })}
                style={{ width: '100%', height: '100%' }}
              />
            )}
            <div
              ref={text}
              className="pdf-selectable-text"
              style={{
                width: Math.max(80, renderWidth - 24) * rasterZoom,
                height: Math.max(80, renderWidth - 24) * rasterZoom * ratio,
                transform: `scale(${pageWidth / (Math.max(80, renderWidth - 24) * rasterZoom)})`,
              }}
            />
          </>
        )}
        {hoverTargets.map(({ id, rect }) => (
          <div
            key={id}
            data-pdf-part-id={id}
            className={`pdf-paragraph-highlight ${hoverId === id ? 'is-active' : ''}`}
            style={{
              left: `${rect.x}%`,
              top: `${rect.y}%`,
              width: `${rect.width}%`,
              height: `${rect.height}%`,
            }}
          />
        ))}
        {searchRects.map((h, i) => (
          <div
            key={i}
            className={`pdf-search-hit ${h.active ? 'active' : ''}`}
            style={{
              left: `${h.rect.x}%`,
              top: `${h.rect.y}%`,
              width: `${h.rect.width}%`,
              height: `${h.rect.height}%`,
            }}
          />
        ))}
        {commentMarkers
          .filter((comment) => comment.page === number)
          .map(({ mark, label, x, y }) => (
            <button
              key={mark.id}
              className="pdf-note-marker"
              data-pdf-comment={mark.id}
              title={mark.note}
              aria-label={t('Comment {label}: {note}', '评论 {label}：{note}', {
                label,
                note: mark.note || '',
              })}
              style={{
                left: `clamp(0px, calc(${x}% + 7px), calc(100% - 32px))`,
                top: `${y}%`,
              }}
              onPointerDown={(e) => onMarkDown(e, mark)}
              onPointerMove={(e) => onMarkMove(e, mark)}
              onPointerUp={(e) => onMarkUp(e, mark)}
              onPointerCancel={(e) => onMarkUp(e, mark)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                const rect = e.currentTarget.getBoundingClientRect();
                onMarkDown(
                  {
                    button: 0,
                    clientX: rect.left,
                    clientY: rect.bottom,
                    stopPropagation: () => {},
                    preventDefault: () => {},
                    currentTarget: {},
                  } as React.PointerEvent,
                  mark,
                );
                onMarkUp({ type: 'keyboard' } as React.PointerEvent, mark);
              }}
            >
              {label}
            </button>
          ))}
        {error && <span role="alert">{pdfSystemMessage(error)}</span>}
        {highlight && (
          <div
            className="pdf-citation-highlight"
            style={{
              left: `${highlight.x}%`,
              top: `${highlight.y}%`,
              width: `${highlight.width}%`,
              height: `${highlight.height}%`,
            }}
          />
        )}
        {marks.flatMap((mark) =>
          (mark.fragments.find((f) => f.page === number)?.rects || []).map(
            (rect, i) => (
              <button
                key={mark.id + ':' + i}
                data-pdf-mark={mark.id}
                className="pdf-highlight-mark"
                title={t(
                  'Click to change color · Drag to the whiteboard to create an excerpt card',
                  '点击修改颜色 · 拖到画板创建摘录卡',
                )}
                aria-label={t(
                  'Highlighted excerpt: {text}',
                  '高亮摘录：{text}',
                  { text: mark.text.slice(0, 60) },
                )}
                style={
                  {
                    left: `${rect.x}%`,
                    top: `${rect.y}%`,
                    width: `${rect.width}%`,
                    height: `${rect.height}%`,
                    '--mark-color': mark.color,
                  } as CSSProperties
                }
                onPointerDown={(e) => onMarkDown(e, mark)}
                onPointerMove={(e) => onMarkMove(e, mark)}
                onPointerUp={(e) => onMarkUp(e, mark)}
                onPointerCancel={(e) => onMarkUp(e, mark)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    onMarkDown(
                      {
                        button: 0,
                        clientX: r.left,
                        clientY: r.top,
                        stopPropagation: () => {},
                        preventDefault: () => {},
                        currentTarget: {},
                      } as React.PointerEvent,
                      mark,
                    );
                    onMarkUp({ type: 'keyboard' } as React.PointerEvent, mark);
                  }
                }}
              />
            ),
          ),
        )}
      </div>
    );
  },
  (a, b) =>
    a.pdf === b.pdf &&
    a.number === b.number &&
    a.width === b.width &&
    a.renderWidth === b.renderWidth &&
    a.zoom === b.zoom &&
    a.rasterZoom === b.rasterZoom &&
    a.marks === b.marks &&
    a.hits === b.hits &&
    a.activeHit === b.activeHit &&
    a.highlight === b.highlight &&
    a.hoverRects === b.hoverRects &&
    a.hoverId === b.hoverId &&
    a.onHover === b.onHover,
);
