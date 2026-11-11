import { pdfPageText } from './document-reading.ts';
import type { SourceRect } from '../lib/pdf-paragraphs';

type TextItem = { str: string; hasEOL?: boolean; transform: number[]; width: number; height: number };
type Viewport = { width: number; height: number; convertToViewportPoint: (x: number, y: number) => number[] };
export type PdfCitationLocation = { rects: SourceRect[]; stops: SourceRect[] };

// Match the saved evidence, never the model's paraphrase. Whitespace and font
// ligatures may differ between extraction versions; preserve original offsets.
function normalized(text: string, joinLineBreaks = false) {
  let value = '';
  const offsets: number[] = [];
  for (let i = 0; i < text.length; i++) {
    // Only repair hyphens at a physical line ending, retaining source offsets.
    if (joinLineBreaks && text[i] === '-' && /\p{L}/u.test(text[i - 1] || '') && /^-\s*\n\s*\p{L}/u.test(text.slice(i))) continue;
    for (const char of text[i].normalize('NFKC')) {
      if (/\s/u.test(char) || char === '\u00ad') continue;
      value += char;
      offsets.push(i);
    }
  }
  return { value, offsets };
}

export function locatePdfCitation(items: TextItem[], viewport: Viewport, quote: string): PdfCitationLocation | undefined {
  const text = pdfPageText(items);
  let source = normalized(text), wanted = normalized(quote).value;
  if (wanted.length < 8 || !Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) return;
  let match = source.value.indexOf(wanted);
  if (match < 0) {
    source = normalized(text, true); wanted = normalized(quote, true).value;
    match = source.value.indexOf(wanted);
  }
  // Repeated text is ambiguous. Showing the saved quote is safer than guessing.
  if (match < 0 || source.value.indexOf(wanted, match + 1) !== -1) return;
  const start = source.offsets[match], end = source.offsets[match + wanted.length - 1] + 1;
  const rects: SourceRect[] = [];
  let cursor = 0;
  for (const item of items) {
    const value = item.str.split('\u0000').join('').trim();
    if (!value) continue;
    const at = text.indexOf(value, cursor);
    if (at < 0) return; // Extraction order cannot be mapped reliably.
    cursor = at + value.length;
    if (cursor <= start || at >= end) continue;
    const [a, b, , , x, y] = item.transform;
    const length = Math.hypot(a, b), height = Math.abs(item.height);
    if (![a, b, x, y, length, height, item.width].every(Number.isFinite) || length === 0 || height === 0 || item.width <= 0) return;
    const dx = a / length, dy = b / length;
    const points = [[x, y], [x + dx * item.width, y + dy * item.width],
      [x - dy * height, y + dx * height], [x + dx * item.width - dy * height, y + dy * item.width + dx * height]]
      .map(([px, py]) => viewport.convertToViewportPoint(px, py));
    const left = Math.max(0, Math.min(...points.map(p => p[0]))), top = Math.max(0, Math.min(...points.map(p => p[1])));
    const right = Math.min(viewport.width, Math.max(...points.map(p => p[0]))), bottom = Math.min(viewport.height, Math.max(...points.map(p => p[1])));
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return;
    rects.push({ x: left / viewport.width * 100, y: top / viewport.height * 100, width: (right - left) / viewport.width * 100, height: (bottom - top) / viewport.height * 100 });
  }
  if (!rects.length) return;
  // Stops follow reading order, including a jump from the bottom of one column
  // to the top of the next. The overlay retains separate line rectangles.
  const rows: SourceRect[] = [];
  for (const rect of rects) {
    const row = rows.at(-1);
    if (row && Math.abs(rect.y - row.y) < Math.max(row.height, rect.height) * .35 && rect.x >= row.x && rect.x - (row.x + row.width) < 10) {
      row.width = Math.max(row.x + row.width, rect.x + rect.width) - row.x;
      row.height = Math.max(row.height, rect.height);
    } else rows.push({ ...rect });
  }
  const stops: SourceRect[] = [];
  for (let i = 0; i < rows.length; i++) {
    const rect = rows[i], prev = rows[i - 1];
    if (!prev || rect.y < prev.y - prev.height || rect.y > prev.y + prev.height * 2.5 || Math.abs(rect.x - prev.x) > 25) stops.push(rect);
  }
  return { rects, stops };
}
