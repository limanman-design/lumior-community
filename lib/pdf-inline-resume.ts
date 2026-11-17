import { validateProtectedTranslation, validateInlineTranslationPart, type PdfTranslationSnapshot, type TranslationPart, type TranslationUnit } from './pdf-translation.ts';

export type InlineTranslationPlan = {
  units: TranslationUnit[];
  legacyUnits: TranslationUnit[];
  legacyPartIds: Record<string, string[]>;
  totalPages: number;
  emptyPages: number[];
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
function verified(source: TranslationPart, candidate?: TranslationPart) {
  if (!candidate?.text.trim() || !source.sourceHash || candidate.sourceHash !== source.sourceHash ||
      !same(source.inlineFormulas || [], candidate.inlineFormulas || [])) return false;
  try { validateInlineTranslationPart(source, candidate.text); return true; } catch { return false; }
}
function translatedPart(source: TranslationPart, text: string): TranslationPart {
  const { reuseText: _reuse, ...part } = source;
  return { ...part, text };
}

/** A long merged paragraph gives every new slice the same historical IDs.
 * Recover exact source overlap before deciding which old text belongs to it. */
function legacyAliases(plan: InlineTranslationPlan) {
  const pages = new Map<number, { text: string; cursor: number; ranges: Map<string, { start: number; end: number }> }>();
  for (const unit of plan.legacyUnits) {
    const page = pages.get(unit.page) || { text: '', cursor: 0, ranges: new Map() };
    let cursor = 0;
    for (const part of unit.parts || []) {
      const start = unit.text.indexOf(part.text, cursor);
      if (start < 0) continue;
      page.ranges.set(part.id, { start: page.text.length + start, end: page.text.length + start + part.text.length });
      cursor = start + part.text.length;
    }
    page.text += unit.text; pages.set(unit.page, page);
  }
  const key = (page: number, ids: string[]) => JSON.stringify([page, ids]), shared = new Map<string, number>();
  for (const unit of plan.units) for (const part of unit.parts || []) {
    const group = key(unit.page, plan.legacyPartIds[part.id] || []);
    shared.set(group, (shared.get(group) || 0) + 1);
  }
  const aliases = new Map<string, string[]>();
  for (const unit of plan.units) for (const part of unit.parts || []) {
    const ids = plan.legacyPartIds[part.id] || [], page = pages.get(unit.page);
    const text = part.text.replace(/\{v\d+\}/g, marker => part.inlineFormulas?.find(formula => formula.marker === marker)?.text || marker);
    const start = page?.text.indexOf(text, page.cursor) ?? -1;
    let matches = ids;
    if (page && start >= 0) {
      const end = start + text.length; page.cursor = end;
      if ((shared.get(key(unit.page, ids)) || 0) > 1) matches = ids.filter(id => {
        const range = page.ranges.get(id); return range && range.start < end && range.end > start;
      });
    }
    aliases.set(part.id, matches);
  }
  return aliases;
}

/** Old plain paragraphs can be reused only through their original source
 * geometry. New protected paragraphs require the exact source fingerprint. */
export function resumeInlineTranslation(plan: InlineTranslationPlan, saved?: PdfTranslationSnapshot) {
  const oldParts = new Map((saved?.units || []).flatMap(unit => (unit.parts || []).map(part => [part.id, { page: unit.page, part }] as const)));
  const legacy = new Map(plan.legacyUnits.flatMap(unit => (unit.parts || []).map(part => [part.id, { page: unit.page, part }] as const)));
  const aliases = legacyAliases(plan), fallbackOwner = new Map<string, string>();
  // A historical translation cannot be cut at a new source boundary safely.
  // Keep it once, on its last slice, until all preceding slices are replaced.
  for (const unit of plan.units) for (const part of unit.parts || [])
    for (const id of aliases.get(part.id) || []) fallbackOwner.set(id, part.id);
  const previous: TranslationUnit[] = [], remaining: TranslationUnit[] = [];
  for (const unit of plan.units) {
    const ready = new Map<string, TranslationPart>(), visible: TranslationPart[] = [];
    for (const source of unit.parts || []) {
      const existing = oldParts.get(source.id), candidate = existing?.page === unit.page ? existing.part : undefined;
      if (saved?.inlineMathVersion === 1 && verified(source, candidate)) ready.set(source.id, translatedPart(source, candidate!.text));
      const ids = aliases.get(source.id) || [];
      if (saved?.inlineMathVersion !== 1 && !source.inlineFormulas?.length && ids.length === 1) {
        const original = legacy.get(ids[0]), old = oldParts.get(ids[0]);
        if (original?.page === unit.page && old?.page === unit.page && source.text === original.part.text &&
            same(source.rects, original.part.rects) && same(original.part.rects, old.part.rects) && old.part.text.trim()) {
          try { validateProtectedTranslation(source.text, old.part.text); ready.set(source.id, translatedPart(source, old.part.text)); } catch { /* Retranslate stale markers. */ }
        }
      }
      const reuse = ready.get(source.id);
      if (reuse) visible.push(reuse);
      else {
        // Retain the previous reading result while its replacement is pending.
        // No fingerprint/inline metadata means it cannot be counted as finished.
        const fallback = saved?.inlineMathVersion === 1 ? candidate?.text.replace(/\{v\d+\}/g, marker =>
          candidate.inlineFormulas?.find(formula => formula.marker === marker)?.text ||
          source.inlineFormulas?.find(formula => formula.marker === marker)?.text || marker) : ids.filter(id => fallbackOwner.get(id) === source.id).flatMap(id => {
          const old = oldParts.get(id), original = legacy.get(id);
          return old?.page === unit.page && original?.page === unit.page && same(old.part.rects, original.part.rects) ? [old.part.text] : [];
        }).join('\n\n');
        if (fallback?.trim()) visible.push({ id: source.id, rects: source.rects, text: fallback });
      }
    }
    if (visible.length) previous.push({ ...unit, parts: visible, text: visible.map(part => part.text).join('\n\n') });
    if (ready.size !== unit.parts?.length) remaining.push({ ...unit, parts: unit.parts?.map(part => ready.has(part.id) ? { ...part, reuseText: ready.get(part.id)!.text } : part) });
  }
  return { previous, remaining };
}

/** Validate partial events before persistence, and keep pending historical
 * text until each corresponding sentence has a verified replacement. */
export function mergeInlineTranslationUnit(source: TranslationUnit, current: TranslationUnit | undefined, received: TranslationUnit): TranslationUnit {
  if (received.id !== source.id || received.page !== source.page || received.inlineMathVersion !== 1 || !received.parts?.length)
    throw new Error('行内公式译文无法核对，已保留完成的句段。');
  const sourceParts = new Map(source.parts?.map(part => [part.id, part]));
  const values = new Map(current?.parts?.map(part => [part.id, part])), ids = new Set<string>();
  for (const part of received.parts) {
    const original = sourceParts.get(part.id);
    if (!original || ids.has(part.id) || !verified(original, part)) throw new Error('行内公式或句段标记不完整，本段未替换，可继续重试。');
    ids.add(part.id); values.set(part.id, translatedPart(original, part.text));
  }
  const parts = source.parts!.flatMap(part => values.has(part.id) ? [values.get(part.id)!] : []);
  return { ...source, parts, text: parts.map(part => part.text).join('\n\n') };
}
