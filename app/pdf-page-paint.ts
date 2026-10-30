import { TextLayer, type PDFDocumentProxy } from 'pdfjs-dist';
import { createPdfRenderCache } from './pdf-render-cache';
import { pdfRenderScheduler } from './pdf-render-scheduler';

type PdfText = Awaited<
  ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getTextContent']>
>;
const textCache = new WeakMap<
  PDFDocumentProxy,
  Map<number, Promise<PdfText>>
>();
export function getPdfText(pdf: PDFDocumentProxy, number: number) {
  let cache = textCache.get(pdf);
  if (!cache) textCache.set(pdf, (cache = new Map()));
  let value = cache.get(number);
  if (!value) {
    value = pdf.getPage(number).then((page) => page.getTextContent());
    cache.set(number, value);
    void value.catch(() => cache?.delete(number));
  }
  return value;
}

export type PdfPagePaint = {
  bitmap: ImageBitmap;
  text: HTMLElement;
  scale: number;
  ratio: number;
  pixels: number;
  warm?: symbol;
};
const paintCache = new WeakMap<
  PDFDocumentProxy,
  ReturnType<typeof createPdfRenderCache<PdfPagePaint>>
>();
const warmPaints = new Map<
  PdfPagePaint,
  {
    cache: ReturnType<typeof createPdfRenderCache<PdfPagePaint>>;
    key: string;
    timer: ReturnType<typeof setTimeout>;
  }
>();
const WARM_PIXELS = 8_000_000;
function promote(paint: PdfPagePaint) {
  const warm = warmPaints.get(paint);
  if (warm) clearTimeout(warm.timer);
  warmPaints.delete(paint);
  paint.warm = undefined;
}
function cacheFor(pdf: PDFDocumentProxy) {
  let cache = paintCache.get(pdf);
  if (!cache) {
    cache = createPdfRenderCache<PdfPagePaint>((paint) => {
      promote(paint);
      paint.bitmap.close();
    });
    paintCache.set(pdf, cache);
  }
  return cache;
}
export function clearPdfPaint(pdf: PDFDocumentProxy) {
  paintCache.get(pdf)?.clear();
  textCache.delete(pdf);
}
export function pdfPaintDimensions(
  width: number,
  ratio: number,
  zoom = 1,
  dpr = globalThis.devicePixelRatio || 1,
) {
  const pageWidth = Math.max(80, width - 24) * zoom,
    pageHeight = pageWidth * ratio,
    density = Math.min(
      dpr,
      1.5,
      Math.sqrt(6_000_000 / (pageWidth * pageHeight)),
    );
  return {
    width: Math.ceil(pageWidth * density),
    height: Math.ceil(pageHeight * density),
    density,
  };
}

export async function preparePdfPage(
  pdf: PDFDocumentProxy,
  number: number,
  width: number,
  zoom: number,
  {
    signal,
    priority = () => 0,
    warm,
  }: { signal?: AbortSignal; priority?: () => number; warm?: symbol } = {},
) {
  const check = () => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  };
  check();
  const page = await pdf.getPage(number);
  check();
  const base = page.getViewport({ scale: 1 }),
    ratio = base.height / base.width,
    viewport = page.getViewport({
      scale: (Math.max(80, width - 24) * zoom) / base.width,
    }),
    size = pdfPaintDimensions(width, ratio, zoom),
    key = `${number}:${size.width}:${size.height}`,
    cache = cacheFor(pdf);
  const reuse = () => {
    const paint = cache.get(key);
    if (paint && !warm) promote(paint);
    return paint;
  };
  const cached = reuse();
  if (cached) return cached;
  return pdfRenderScheduler.schedule(
    priority,
    async () => {
      check();
      const existing = reuse();
      if (existing) return existing;
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const render = page.render({
        canvas,
        viewport,
        transform: [size.density, 0, 0, size.density, 0, 0],
      });
      const cancel = () => render.cancel();
      signal?.addEventListener('abort', cancel, { once: true });
      render.onContinue = (resume: () => void) =>
        setTimeout(() => {
          if (!signal?.aborted) resume();
        }, 0);
      let layer: TextLayer | undefined;
      try {
        await render.promise;
        check();
        const content = await getPdfText(pdf, number);
        check();
        // PDF.js measures each next span after appending the previous one.
        // Staging disconnected retains its exact font/geometry while avoiding
        // hundreds of repeated style/layout flushes in a live sidebar.
        const text = document.createElement('div');
        text.className = 'pdf-selectable-text';
        text.style.setProperty('--total-scale-factor', String(viewport.scale));
        layer = new TextLayer({
          textContentSource: content,
          container: text,
          viewport,
        });
        await layer.render();
        check();
        const bitmap = await createImageBitmap(canvas);
        if (signal?.aborted) {
          bitmap.close();
          check();
        }
        const paint: PdfPagePaint = {
          bitmap,
          text,
          ratio,
          scale: viewport.scale,
          pixels: size.width * size.height,
          warm,
        };
        cache.set(key, paint, paint.pixels);
        if (warm) {
          const timer = setTimeout(() => {
            if (paint.warm === warm) cache.delete(key);
          }, 30_000);
          warmPaints.set(paint, { cache, key, timer });
          while (
            warmPaints.size > 4 ||
            [...warmPaints.keys()].reduce((sum, p) => sum + p.pixels, 0) >
              WARM_PIXELS
          ) {
            const oldest = warmPaints.entries().next().value;
            if (!oldest) break;
            oldest[1].cache.delete(oldest[1].key);
          }
        }
        return paint;
      } finally {
        signal?.removeEventListener('abort', cancel);
        layer?.cancel();
        canvas.width = canvas.height = 0;
      }
    },
    signal,
  );
}
