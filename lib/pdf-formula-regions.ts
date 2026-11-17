import type { SourceRect } from './pdf-paragraphs';
import type { TranslationPart, TranslationUnit } from './pdf-translation';

export type PdfFormulaRegion = { id: string; page: number; partIds: string[]; rect: SourceRect };
type PageSize = { width: number; height: number };
type SourcePart = TranslationPart & { page: number; box: SourceRect; math: boolean };

function validRect(rect: SourceRect): boolean {
  return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) &&
    rect.x >= 0 && rect.y >= 0 && rect.width > 0 && rect.height > 0 &&
    rect.x + rect.width <= 100.001 && rect.y + rect.height <= 100.001;
}
function union(rects: SourceRect[]): SourceRect {
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x,
    height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}
const right = (rect: SourceRect) => rect.x + rect.width;
const bottom = (rect: SourceRect) => rect.y + rect.height;
const overlapsX = (a: SourceRect, b: SourceRect) => a.x < right(b) && b.x < right(a);

/** Source words are deliberately conservative: uncertain or mixed prose stays translated text. */
function mathText(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 350 || /[\p{Script=Han}]/u.test(value) || /^\s*\[\d+\]/.test(value)) return false;
  if (/\b(?:a[n]?|the|and|or|for|in|of|to|at|on|is|are|has|not|but|as|by|it|be|we|can|our)\b/i.test(value)) {
    // A single italic a is a common operator; a sentence of short words is not a formula.
    const words = value.match(/[A-Za-z]+/g) || [];
    if (words.some(word => /^(?:the|and|or|for|in|of|to|at|on|is|are|has|not|but|as|by|it|be|we|can|our|an)$/i.test(word))) return false;
  }
  return !/[A-Za-z]{4,}/.test(value.replace(/\b(?:arcsin|arccos|arctan|sinh|cosh|tanh|sqrt|log|exp|lim|max|min|det|dim|ker|Pr)\b/g, ''));
}
function matchingRects(a: SourceRect[], b: SourceRect[]) {
  return Array.isArray(b) && a.length === b.length && a.every((rect, index) => validRect(b[index]) &&
    (['x', 'y', 'width', 'height'] as const).every(key => Math.abs(rect[key] - b[index][key]) <= 0.00001));
}

/**
 * Identify isolated display equations from the ORIGINAL PDF text and positions.
 * Crops replace complete, geometry-verified saved parts only. Inline expressions,
 * ambiguous prose and incomplete translations are deliberately left untouched.
 */
export function findPdfFormulaRegions(
  source: TranslationUnit[], translated: TranslationUnit[], pageSizes?: Map<number, PageSize>,
): PdfFormulaRegion[] {
  const targets = new Map<string, { page: number; part: TranslationPart } | null>();
  for (const unit of translated) for (const part of unit.parts || []) {
    targets.set(part.id, targets.has(part.id) ? null : { page: unit.page, part });
  }
  const pages = new Map<number, SourcePart[]>(), sourceIds = new Set<string>(), duplicateIds = new Set<string>(), invalidPages = new Set<number>();
  for (const unit of source) {
    if (!unit.parts?.length && unit.text.trim()) invalidPages.add(unit.page);
    for (const part of unit.parts || []) {
    if (sourceIds.has(part.id)) duplicateIds.add(part.id);
    sourceIds.add(part.id);
    if (!part.rects?.length || !part.rects.every(validRect)) { invalidPages.add(unit.page); continue; }
    const parts = pages.get(unit.page) || [];
    parts.push({ ...part, page: unit.page, box: union(part.rects), math: mathText(part.text) });
    pages.set(unit.page, parts);
    }
  }
  const regions: PdfFormulaRegion[] = [];
  for (const [page, parts] of pages) {
    if (invalidPages.has(page)) continue;
    const rects = parts.flatMap(part => part.rects);
    const body = rects.filter(rect => rect.width > 15 && rect.height < 4);
    const h = body.length ? body.map(rect => rect.height).sort((a, b) => a - b)[Math.floor(body.length / 2)] :
      rects.map(rect => rect.height).sort((a, b) => a - b)[Math.floor(rects.length / 2)];
    const left = body.filter(rect => rect.x < 30 && right(rect) <= 51 && rect.width >= 18);
    const rightColumn = body.filter(rect => rect.x >= 47 && rect.x < 68 && rect.width >= 18);
    const twoColumns = left.length >= 3 && rightColumn.length >= 3;
    const side = (box: SourceRect) => !twoColumns ? 0 : right(box) <= 51 ? 1 : box.x >= 49 ? 2 : 0;
    const groups: SourcePart[][] = [];
    let group: SourcePart[] = [], box: SourceRect | undefined;
    const flush = () => { if (group.length) groups.push(group); group = []; box = undefined; };
    for (const part of parts) {
      if (!part.math) { flush(); continue; }
      if (box) {
        const gap = Math.max(part.box.y - bottom(box), box.y - bottom(part.box), 0);
        const combined = union([box, part.box]);
        if (side(box) !== side(part.box) || gap > h * 1.35 || combined.height > h * 7 || combined.height > 12) flush();
      }
      group.push(part); box = box ? union([box, part.box]) : part.box;
    }
    flush();
    for (const candidate of groups) {
      const text = candidate.map(part => part.text).join(' '), raw = union(candidate.flatMap(part => part.rects));
      // A relation or equality and a useful horizontal extent exclude page numbers,
      // isolated indices, reference markers and most tiny inline fragments.
      if (!/[=≠≈≃≡∝≤≥]/u.test(text) || raw.width < 8 || raw.height > 12) continue;
      const ids = new Set(candidate.map(part => part.id));
      const outside = parts.filter(part => !ids.has(part.id));
      const lane: SourceRect = twoColumns && side(raw) === 1 ? { x: 0, y: 0, width: 51, height: 100 } :
        twoColumns && side(raw) === 2 ? { x: 49, y: 0, width: 51, height: 100 } : { x: 0, y: 0, width: 100, height: 100 };
      const neighbours = outside.flatMap(part => part.rects).filter(rect => overlapsX(rect, lane));
      // An equation sharing a source line with any excluded text is inline or
      // incomplete. Never crop translated prose merely because nearby tokens look mathematical.
      if (neighbours.some(rect => rect.y < bottom(raw) - h * .12 && bottom(rect) > raw.y + h * .12)) continue;
      if (!candidate.every(part => {
        const target = targets.get(part.id);
        return !duplicateIds.has(part.id) && target?.page === page && !!target.part.text.trim() && matchingRects(part.rects, target.part.rects);
      })) continue;
      const size = pageSizes?.get(page), width = size && Number.isFinite(size.width) && size.width > 0 ? size.width : 595.28;
      const height = size && Number.isFinite(size.height) && size.height > 0 ? size.height : 841.89;
      // pdfParagraphs rectangles stop at the text baseline. Allow descenders and
      // large mathematical delimiters below it, while reserving neighbouring
      // prose's descender area above and its ascender area below the crop.
      const padX = 2 / width * 100, padY = Math.max(2 / height * 100, h * .45);
      let x = Math.max(0, raw.x - padX), y = Math.max(0, raw.y - padY);
      let endX = Math.min(100, right(raw) + padX), endY = Math.min(100, bottom(raw) + padY);
      for (const neighbour of neighbours) {
        if (bottom(neighbour) <= raw.y) y = Math.max(y, bottom(neighbour) + neighbour.height * .3 + h * .05);
        if (neighbour.y >= bottom(raw)) endY = Math.min(endY, neighbour.y + neighbour.height * .18 - h * .05);
        if (neighbour.y < endY && bottom(neighbour) > y) {
          if (right(neighbour) <= raw.x) x = Math.max(x, (right(neighbour) + raw.x) / 2);
          if (neighbour.x >= right(raw)) endX = Math.min(endX, (neighbour.x + right(raw)) / 2);
        }
      }
      // If neighbouring text leaves too little room, keep the saved text rather
      // than returning a crop that knowingly cuts through the formula's core.
      if (y > raw.y + h * .5 || endY < bottom(raw) || endY <= y) continue;
      regions.push({ id: `formula:${page}:${candidate[0].id}`, page, partIds: candidate.map(part => part.id), rect: { x, y, width: endX - x, height: endY - y } });
    }
  }
  return regions;
}
