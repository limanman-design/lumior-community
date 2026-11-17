import type { SourceRect } from './pdf-paragraphs';
import type { PdfFormulaRegion } from './pdf-formula-regions.ts';
import { parseTranslationMarkdown, type TranslationMarkdownBlock, type TranslationMarkdownRun } from './pdf-translation-markdown.ts';

export type ReflowPart = { id: string; text: string; rects?: SourceRect[] };
export type ReflowRun = TranslationMarkdownRun & { id: string };
export type ReflowBlock = {
  kind: 'paragraph' | 'heading' | 'list' | 'quote' | 'code';
  level?: number;
  marker?: string;
  runs: ReflowRun[];
  placement: 'span' | 'left' | 'right' | 'flow';
  centered?: boolean;
  metadata?: boolean;
  formula?: PdfFormulaRegion;
};
export type ReflowSection = { columns: ReflowBlock[][] };

function validRect(rect: SourceRect) {
  return !!rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}
function bounds(rects: SourceRect[]): SourceRect | undefined {
  if (!rects.length) return;
  const x = Math.min(...rects.map(rect => rect.x)), y = Math.min(...rects.map(rect => rect.y));
  return { x, y, width: Math.max(...rects.map(rect => rect.x + rect.width)) - x, height: Math.max(...rects.map(rect => rect.y + rect.height)) - y };
}
function separator(before: string, after: string) {
  return /[\p{Script=Han}]$/u.test(before) || /^[\p{Script=Han}，。！？；：、）】]/u.test(after) ? '' : ' ';
}
const list = /^\s*(?:[•●▪◦*\-–]|\d+[.)、]|[（(]\d+[）)])\s+/u;
const mathFragment = (text: string) => text.trim().length <= 45 && !/[\p{Script=Han}]/u.test(text) && !/[A-Za-z]{4}/.test(text);
const markdownStart = (text: string) => /^\s*(?:#{1,6}\s|>\s|```|~~~)/.test(text) || list.test(text);

/** Use existing source geometry only. Saved translations and their part IDs stay unchanged. */
export function translationStructure(parts: ReflowPart[], sourcePage: number, formulas: PdfFormulaRegion[] = []): { sections: ReflowSection[]; columns: 1 | 2; hasTitle: boolean; balanced: boolean } {
  const entries = parts.map(part => ({ ...part, rects: (part.rects || []).filter(validRect) }));
  const indices = new Map(entries.map((part, index) => [part.id, index]));
  const formulaParts = new Map<string, PdfFormulaRegion>();
  for (const formula of formulas) {
    const first = indices.get(formula.partIds[0]);
    if (formula.page !== sourcePage || first === undefined || !formula.partIds.length || !validRect(formula.rect) ||
        !formula.partIds.every((id, index) => indices.get(id) === first + index && !formulaParts.has(id))) continue;
    for (const id of formula.partIds) formulaParts.set(id, formula);
  }
  const rects = entries.flatMap(part => part.rects);
  const bodyRects = rects.filter(rect => rect.width >= 15 && rect.height < 4);
  const heights = new Map<number, number>();
  for (const rect of bodyRects) { const height = Math.round(rect.height * 10) / 10; heights.set(height, (heights.get(height) || 0) + rect.width); }
  const bodyHeight = [...heights].sort((a, b) => b[1] - a[1])[0]?.[0] || 1.3;
  const left = bodyRects.filter(rect => rect.x < 30 && rect.x + rect.width <= 51 && rect.width >= 18);
  const right = bodyRects.filter(rect => rect.x >= 47 && rect.x < 68 && rect.width >= 18);
  const extent = (values: SourceRect[]) => [Math.min(...values.map(rect => rect.y)), Math.max(...values.map(rect => rect.y + rect.height))];
  const [ly, lb] = extent(left), [ry, rb] = extent(right);
  const sourceColumns = left.length >= 3 && right.length >= 3 && Math.min(lb, rb) - Math.max(ly, ry) > bodyHeight * 3;
  // Legacy translations without coordinates retain their readable balanced layout.
  const columns: 1 | 2 = sourceColumns || (!rects.length && parts.reduce((sum, part) => sum + part.text.length, 0) >= 500) ? 2 : 1;
  const columnStart = sourceColumns ? Math.min(ly, ry) : Infinity;
  const leftEdge = sourceColumns ? Math.min(...left.map(rect => rect.x)) : 8;
  const leftEnd = sourceColumns ? Math.max(...left.map(rect => rect.x + rect.width)) : 48;
  const rightEdge = sourceColumns ? Math.min(...right.map(rect => rect.x)) : 52;
  const rightEnd = sourceColumns ? Math.max(...right.map(rect => rect.x + rect.width)) : 92;
  const gutter = (leftEnd + rightEdge) / 2;
  type Group = { parts: typeof entries; placement: ReflowBlock['placement']; math: boolean; metadata: boolean; formula?: PdfFormulaRegion };
  const groups: Group[] = [];
  for (const part of entries) {
    const sourceFormula = formulaParts.get(part.id);
    if (sourceFormula && sourceFormula.partIds[0] !== part.id) continue;
    const box = sourceFormula?.rect || bounds(part.rects), first = part.rects[0];
    const metadata = !!box && (/^arXiv\s*:/i.test(part.text.trim()) || (/^\d+$/.test(part.text.trim()) && box.y < 6));
    const placement: ReflowBlock['placement'] = metadata ? 'span' : !sourceColumns ? 'flow' : !box ? 'span' :
      box.y < columnStart - bodyHeight || (box.x < gutter - 1 && box.x + box.width > gutter + 1) ? 'span' :
      box.x + box.width / 2 < gutter ? 'left' : 'right';
    if (sourceFormula) {
      groups.push({ parts: sourceFormula.partIds.map(id => entries[indices.get(id)!]), placement, math: true, metadata: false, formula: sourceFormula });
      continue;
    }
    const group = groups.at(-1), previous = group?.parts.at(-1), last = previous?.rects.at(-1);
    let join = false;
    if (group && !group.formula && previous && last && first && group.placement === placement && !metadata && !group.metadata && !markdownStart(part.text) && !markdownStart(previous.text)) {
      const h = Math.max(bodyHeight, last.height, first.height);
      const sameSource = JSON.stringify(previous.rects) === JSON.stringify(part.rects);
      const sameLine = first.x >= last.x && first.x - last.x - last.width < h * 3 && Math.abs(first.y - last.y) < h * .85;
      const fragments = mathFragment(part.text) && group.parts.every(value => mathFragment(value.text));
      const groupBox = bounds(group.parts.flatMap(value => value.rects))!;
      const formula = fragments && Math.abs(first.y - groupBox.y) < h * 3.5 && first.x >= groupBox.x && first.x - groupBox.x - groupBox.width < h * 3;
      const gap = first.y - last.y - last.height;
      const wrapsFragment = Math.abs(first.x - groupBox.x) < h * 1.5 && last.x + last.width >= (placement === 'left' ? leftEnd : rightEnd) - h * 2;
      const nextLine = gap >= -h * .35 && gap <= h * .55 && (Math.abs(first.x - last.x) < h * 1.5 || wrapsFragment) &&
        Math.abs(first.height - last.height) < h * .25 && !previous.text.includes('\n\n') && !part.text.includes('\n\n') &&
        !(/[.!?。！？:]\s*$/.test(previous.text) && first.x > last.x + h * .7);
      join = sameSource || sameLine || formula || nextLine;
      if (formula) group.math = true;
    }
    if (join) group!.parts.push(part);
    else groups.push({ parts: [part], placement, math: false, metadata });
  }
  const blocks: ReflowBlock[] = [];
  for (const group of groups) {
    if (group.formula) {
      blocks.push({ kind: 'paragraph', runs: group.parts.map(part => ({ id: part.id, text: part.text })), placement: group.placement, formula: group.formula });
      continue;
    }
    const groupRects = group.parts.flatMap(part => part.rects), box = bounds(groupRects);
    const text = group.parts.map(part => part.text.trim()).join(' ');
    const maxHeight = Math.max(...groupRects.map(rect => rect.height), 0);
    const firstPageTitle = sourcePage === 1 && !!box && box.y < 12 && maxHeight >= bodyHeight * 1.15 && !group.metadata && text.length < 250;
    const center = box ? box.x + box.width / 2 : 0;
    const columnCenter = group.placement === 'left' ? (leftEdge + leftEnd) / 2 : group.placement === 'right' ? (rightEdge + rightEnd) / 2 : 50;
    const centered = !!box && Math.abs(center - columnCenter) < 3;
    const shortHeading = !group.math && !group.metadata && !!box && groupRects.length <= 2 && text.length <= 80 && centered &&
      box.width < (group.placement === 'span' ? 65 : 32) && !/[。！？；;.!?]$/.test(text) && box.y >= columnStart - bodyHeight;
    const metadata = group.metadata || (sourceColumns && !firstPageTitle && group.placement === 'span' && !!box && box.y < columnStart && groupRects.length < 6 && text.length < 500);
    const groupStart = blocks.length;
    for (const part of group.parts) {
      const parsed: TranslationMarkdownBlock[] = group.math ? [{kind: 'paragraph', runs: [{text: part.text.replace(/\s+/g, ' ').trim()}]}] : parseTranslationMarkdown(part.text);
      for (let index = 0; index < parsed.length; index++) {
        const block = parsed[index];
        const inferredHeading = block.kind === 'paragraph' && (firstPageTitle || shortHeading);
        const previous = blocks.at(-1);
        // Only join plain fragments in this geometry group, never explicit Markdown blocks.
        const continuation = blocks.length > groupStart && part !== group.parts[0] && index === 0 && block.kind === 'paragraph' && previous &&
          (previous.kind === 'paragraph' || firstPageTitle || shortHeading);
        const runs = block.runs.map(run => ({ ...run, id: part.id }));
        if (continuation && runs.length) {
          runs[0].text = separator(previous.runs.at(-1)?.text || '', runs[0].text) + runs[0].text;
          previous.runs.push(...runs);
        } else blocks.push({ ...block, kind: inferredHeading ? 'heading' : block.kind, level: inferredHeading ? (firstPageTitle ? 1 : 2) : block.level,
          runs, placement: group.placement, centered: inferredHeading || (metadata && centered && block.kind === 'paragraph'), metadata });
      }
    }
  }
  const sections: ReflowSection[] = [];
  let lanes: ReflowBlock[][] | undefined;
  for (const block of blocks) {
    if (sourceColumns && block.placement !== 'span') {
      if (!lanes) { lanes = [[], []]; sections.push({ columns: lanes }); }
      lanes[block.placement === 'right' ? 1 : 0].push(block);
    } else {
      lanes = undefined;
      const section = sections.at(-1);
      if (section?.columns.length === 1) section.columns[0].push(block);
      else sections.push({ columns: [[block]] });
    }
  }
  return { sections, columns, hasTitle: blocks.some(block => block.kind === 'heading' && block.level === 1), balanced: columns === 2 && !sourceColumns };
}
