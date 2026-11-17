import { OPS, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import type { PdfTranslation, TranslationUnit } from '../lib/pdf-translation';
import { translationUnits } from '../lib/pdf-translation.ts';
import { inlineGlyphWidths, prepareInlineFormulaPages, type InlineFormulaPage, type InlineFormulaPlan } from '../lib/pdf-inline-formulas.ts';
import { pdfParagraphs } from '../lib/pdf-paragraphs.ts';
import { findPdfFormulaRegions, type PdfFormulaRegion } from '../lib/pdf-formula-regions.ts';
import { awaitReadingTask, pdfPageText } from './document-reading.ts';
import { acquirePdf } from './pdf-runtime';

export type PdfFormulaImage = PdfFormulaRegion & {
  png: Uint8Array;
  /** Dimensions in the source viewport at scale 1, independent of raster density. */
  width: number;
  height: number;
  inline?: { marker: string; baseline: number; fontSize: number };
};
export type PdfSourcePageSize = { width: number; height: number };
type PageGeometry = PdfSourcePageSize & { page: PDFPageProxy; supported: boolean };
type SourcePage = PageGeometry & { units: TranslationUnit[] };
type CropRegion = PdfFormulaRegion & { inline?: { marker: string; baseline: number; fontSize: number } };
type FormulaCache = { pages: Map<number, Promise<PageGeometry>>; sourcePages: Map<number, Promise<SourcePage>>; images: Map<string, PdfFormulaImage>; inlinePages: Map<number, Promise<InlineFormulaPage>>; prepared?: InlineFormulaPlan; bytes: number };
const caches = new WeakMap<PDFDocumentProxy, FormulaCache>();
const MAX_IMAGES = 256, MAX_BYTES = 32 * 1024 * 1024, MAX_PIXELS = 4_000_000, MAX_EDGE = 8192;

function check(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('已取消公式预览。', 'AbortError');
}
function wait<T>(operation: Promise<T>, signal?: AbortSignal) {
  return signal ? awaitReadingTask(operation, signal) : operation;
}
function cacheFor(pdf: PDFDocumentProxy) {
  let cache = caches.get(pdf);
  if (!cache) {
    cache = { pages: new Map(), sourcePages: new Map(), images: new Map(), inlinePages: new Map(), bytes: 0 };
    caches.set(pdf, cache);
  }
  return cache;
}
function pageGeometry(pdf: PDFDocumentProxy, number: number, cache: FormulaCache) {
  let pending = cache.pages.get(number);
  if (!pending) {
    pending = (async () => {
      const page = await pdf.getPage(number), viewport = page.getViewport({ scale: 1 });
      if (![viewport.width, viewport.height].every(value => Number.isFinite(value) && value > 0))
        throw new Error('原 PDF 页面尺寸无效，无法对齐译文。');
      // Historical source rectangles use unrotated glyph widths/heights. Do not
      // silently crop a different region on rotated or nonstandard-unit pages.
      const supported = ((page.rotate % 360) + 360) % 360 === 0 && page.userUnit === 1 &&
        (!page.view || page.view[0] === 0 && page.view[1] === 0);
      return { page, width: viewport.width, height: viewport.height, supported };
    })();
    cache.pages.set(number, pending);
    void pending.catch(() => { if (cache.pages.get(number) === pending) cache.pages.delete(number); });
  }
  return pending;
}
function sourcePage(pdf: PDFDocumentProxy, number: number, cache: FormulaCache) {
  let pending = cache.sourcePages.get(number);
  if (!pending) {
    pending = (async () => {
      const geometry = await pageGeometry(pdf, number, cache), { page, supported } = geometry;
      if (!supported) return { ...geometry, units: [] };
      const content = await page.getTextContent(), items = content.items.filter(item => 'str' in item);
      const text = pdfPageText(items);
      const units = translationUnits([{ page: number, text, paragraphs: pdfParagraphs(items, text, page.getViewport({ scale: 1 })) }]);
      return { ...geometry, units };
    })();
    cache.sourcePages.set(number, pending);
    void pending.catch(() => { if (cache.sourcePages.get(number) === pending) cache.sourcePages.delete(number); });
  }
  return pending;
}

function inlinePage(pdf: PDFDocumentProxy, number: number, cache: FormulaCache) {
  let pending = cache.inlinePages.get(number);
  if (!pending) {
    pending = (async () => {
      const geometry = await pageGeometry(pdf, number, cache), { page, supported, width, height } = geometry;
      const content = await page.getTextContent(), items = content.items.filter(item => 'str' in item), text = pdfPageText(items);
      const paragraphs = pdfParagraphs(items, text, page.getViewport({ scale: 1 }));
      // Font programs supply the exact advances needed to separate a closing
      // bracket or accent from prose in the same text item. No estimated cuts.
      const operators = supported ? await page.getOperatorList() : undefined;
      return { page: number, width, height, text, paragraphs, items, styles: content.styles, supported,
        glyphWidths: operators ? inlineGlyphWidths(operators, OPS.setFont, OPS.showText) : undefined };
    })();
    cache.inlinePages.set(number, pending);
    void pending.catch(() => { if (cache.inlinePages.get(number) === pending) cache.inlinePages.delete(number); });
  }
  return pending;
}
async function preparedSource(pdf: PDFDocumentProxy, cache: FormulaCache, signal?: AbortSignal) {
  if (cache.prepared) return cache.prepared;
  const pages: InlineFormulaPage[] = [];
  for (let number = 1; number <= pdf.numPages; number++) {
    check(signal);
    pages.push(await wait(inlinePage(pdf, number, cache), signal));
  }
  check(signal);
  const prepared = await wait(prepareInlineFormulaPages(pages), signal);
  check(signal);
  cache.prepared = prepared;
  return prepared;
}

/** Reproducible source-only segmentation shared by translation and PDF export. */
export async function preparePdfInlineTranslation(sourceUrl: string, signal?: AbortSignal): Promise<InlineFormulaPlan> {
  check(signal);
  const handle = acquirePdf(sourceUrl);
  try {
    const pdf = await wait(handle.promise, signal);
    return await preparedSource(pdf, cacheFor(pdf), signal);
  } finally { handle.release(); }
}

async function renderFormula(page: PDFPageProxy, region: CropRegion, signal?: AbortSignal): Promise<PdfFormulaImage> {
  check(signal);
  const base = page.getViewport({ scale: 1 }), r = region.rect;
  if (![r.x, r.y, r.width, r.height].every(Number.isFinite) || r.x < 0 || r.y < 0 || r.width <= 0 || r.height <= 0 || r.x + r.width > 100.001 || r.y + r.height > 100.001)
    throw new Error('公式位置超出原 PDF 页面，未替换原文字。');
  const x = r.x / 100 * base.width, y = r.y / 100 * base.height;
  const width = r.width / 100 * base.width, height = r.height / 100 * base.height;
  const density = Math.min(4, Math.sqrt(MAX_PIXELS / (width * height)), MAX_EDGE / width, MAX_EDGE / height);
  if (!Number.isFinite(density) || density < 3) throw new Error('公式区域过大，无法生成清晰的原文裁片。');
  // Round the viewport bounds outward so no fractional edge pixel is lost.
  const left = Math.floor(x * density), top = Math.floor(y * density);
  const pixelWidth = Math.ceil((x + width) * density) - left;
  const pixelHeight = Math.ceil((y + height) * density) - top;
  if (pixelWidth * pixelHeight > MAX_PIXELS + 2 * MAX_EDGE || pixelWidth > MAX_EDGE + 1 || pixelHeight > MAX_EDGE + 1)
    throw new Error('公式区域过大，无法生成清晰的原文裁片。');
  const canvas = document.createElement('canvas');
  canvas.width = pixelWidth; canvas.height = pixelHeight;
  let render: ReturnType<PDFPageProxy['render']> | undefined;
  const cancel = () => render?.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    check(signal);
    render = page.render({ canvas, viewport: page.getViewport({ scale: density }), transform: [1, 0, 0, 1, -left, -top], annotationMode: 0 });
    await wait(render.promise, signal);
    check(signal);
    const blob = await wait(new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(value => value ? resolve(value) : reject(new Error('无法保存公式裁片。')), 'image/png');
    }), signal);
    const png = new Uint8Array(await wait(blob.arrayBuffer(), signal));
    check(signal);
    return { ...region, png, width: pixelWidth / density, height: pixelHeight / density,
      ...(region.inline ? { inline: { ...region.inline, baseline: region.inline.baseline / 100 * base.height - top / density } } : {}) };
  } finally {
    signal?.removeEventListener('abort', cancel);
    if (signal?.aborted) render?.cancel();
    canvas.width = 0; canvas.height = 0;
  }
}

async function formulaImages(pdf: PDFDocumentProxy, translation: PdfTranslation, cache: FormulaCache, signal?: AbortSignal): Promise<PdfFormulaImage[]> {
  const numbers = [...new Set(translation.units.map(unit => unit.page))].sort((a, b) => a - b);
  const prepared = translation.inlineMathVersion === 1 && numbers.length ? await preparedSource(pdf, cache, signal) : undefined;
  const source: TranslationUnit[] = [], sizes = new Map<number, { width: number; height: number }>();
  const pages = new Map<number, PDFPageProxy>();
  for (const number of numbers) {
    check(signal);
    if (!Number.isInteger(number) || number < 1 || number > pdf.numPages) throw new Error('译文页码与原 PDF 不一致，无法读取公式。');
    const value = prepared
      ? { ...await wait(pageGeometry(pdf, number, cache), signal), units: prepared.units.filter(unit => unit.page === number) }
      : await wait(sourcePage(pdf, number, cache), signal);
    check(signal);
    if (!value.supported) continue;
    source.push(...value.units); pages.set(number, value.page);
    sizes.set(number, { width: value.width, height: value.height });
  }
  const regions: CropRegion[] = findPdfFormulaRegions(source, translation.units, sizes), images: PdfFormulaImage[] = [];
  if (prepared) {
    const originals = new Map(prepared.units.flatMap(unit => (unit.parts || []).map(part => [part.id, { part, page: unit.page }] as const)));
    for (const unit of translation.units) for (const part of unit.parts || []) {
      // A migrated, paused draft may still contain old prose. Only parts with
      // saved formula metadata may replace text with a source crop.
      if (!part.inlineFormulas?.length) continue;
      const original = originals.get(part.id);
      if (!original || original.page !== unit.page || !part.sourceHash || original.part.sourceHash !== part.sourceHash ||
          JSON.stringify(original.part.inlineFormulas) !== JSON.stringify(part.inlineFormulas))
        throw new Error('行内公式与原 PDF 不一致，请重新翻译对应段落。');
      for (const formula of part.inlineFormulas) {
        if (part.text.split(formula.marker).length !== 2) throw new Error('行内公式标记不完整，请重新翻译对应段落。');
        regions.push({ id: `inline:${unit.page}:${part.id}:${formula.marker}`, page: unit.page, partIds: [part.id], rect: formula.rect,
          inline: { marker: formula.marker, baseline: formula.baseline, fontSize: formula.fontSize } });
      }
    }
  }
  for (const region of regions) {
    check(signal);
    const page = pages.get(region.page);
    if (!page) throw new Error('公式所在的原 PDF 页面不可用。');
    const key = JSON.stringify([region.page, region.partIds, region.rect, region.inline]);
    let image = cache.images.get(key);
    if (image) { cache.images.delete(key); cache.images.set(key, image); }
    else {
      image = await renderFormula(page, region, signal);
      check(signal);
      if (image.png.byteLength <= MAX_BYTES) {
        cache.images.set(key, image); cache.bytes += image.png.byteLength;
        while (cache.images.size > MAX_IMAGES || cache.bytes > MAX_BYTES) {
          const oldest = cache.images.entries().next().value;
          if (!oldest) break;
          cache.images.delete(oldest[0]); cache.bytes -= oldest[1].png.byteLength;
        }
      }
    }
    images.push(image);
  }
  return images;
}

/** Source-only crops: no DOM overlays, PDF annotations, network model or saved-data mutation. */
export async function loadTranslationFormulas(sourceUrl: string, translation: PdfTranslation, signal?: AbortSignal): Promise<PdfFormulaImage[]> {
  check(signal);
  if (!translation.units.length) return [];
  const handle = acquirePdf(sourceUrl);
  try {
    const pdf = await wait(handle.promise, signal);
    return await formulaImages(pdf, translation, cacheFor(pdf), signal);
  } finally {
    handle.release();
  }
}

/** Sizes include pending, empty, rotated and nonstandard-unit pages, even when
 * their text geometry cannot safely supply a formula crop. Index 0 is page 1. */
export async function loadTranslationSource(sourceUrl: string, translation: PdfTranslation, signal?: AbortSignal): Promise<{ formulas: PdfFormulaImage[]; pageSizes: PdfSourcePageSize[] }> {
  check(signal);
  const handle = acquirePdf(sourceUrl);
  try {
    const pdf = await wait(handle.promise, signal), cache = cacheFor(pdf);
    if (!Number.isInteger(translation.totalPages) || translation.totalPages !== pdf.numPages)
      throw new Error('译文页数与原 PDF 不一致，无法对齐页面。');
    const pageSizes: PdfSourcePageSize[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      check(signal);
      const { width, height } = await wait(pageGeometry(pdf, number, cache), signal);
      check(signal);
      pageSizes.push({ width, height });
    }
    const formulas = await formulaImages(pdf, translation, cache, signal);
    check(signal);
    return { formulas, pageSizes };
  } finally {
    handle.release();
  }
}
