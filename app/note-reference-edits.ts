import { normalizeDoi } from '../lib/bibliography.ts';
import type { NoteSource } from './note-source';

/** Per-note text only. Numbers and source navigation are always generated. */
export type NoteReferenceEdit = { sourceId: string; doi?: string; text: string };
export const referenceTextLimit = 10000;
export function validNoteReferenceEdits(value: unknown): value is NoteReferenceEdit[] {
  if (!Array.isArray(value) || value.length > 2000) return false;
  const ids = new Set<string>();
  let total = 0;
  return value.every(edit => {
    if (!edit || typeof edit !== 'object' || Object.keys(edit).some(key => !['sourceId', 'doi', 'text'].includes(key))
      || typeof edit.sourceId !== 'string' || !edit.sourceId || edit.sourceId.length > 512 || ids.has(edit.sourceId)
      || typeof edit.text !== 'string' || !edit.text.trim() || edit.text.length > referenceTextLimit || /[\p{Cc}]/u.test(edit.text)
      || edit.doi !== undefined && normalizeDoi(edit.doi) !== edit.doi) return false;
    ids.add(edit.sourceId); total += edit.text.length;
    return total <= 2000000;
  });
}
const matches = (edit: NoteReferenceEdit, source: NoteSource) => edit.sourceId === source.contentId
  || !!edit.doi && edit.doi === normalizeDoi(source.bibliography?.doi);
export function findReferenceEdit(edits: readonly NoteReferenceEdit[] | undefined, source: NoteSource) {
  return edits?.find(edit => edit.sourceId === source.contentId) || edits?.find(edit => matches(edit, source));
}
export function normalizeReferenceText(text: string): string {
  const body = text.replace(/^\s*\[\d+\]\s*/u, '').replace(/\s+/gu, ' ').trim();
  if (!body || body.length > referenceTextLimit || /[\p{Cc}]/u.test(body)) throw new RangeError('Invalid reference text');
  return body;
}
export function setReferenceEdit(edits: readonly NoteReferenceEdit[] | undefined, source: NoteSource, text: string | undefined): NoteReferenceEdit[] | undefined {
  const next = (edits || []).filter(edit => !matches(edit, source));
  if (text !== undefined) {
    // Pasting a complete entry must not freeze its old [number] into the body.
    const body = normalizeReferenceText(text);
    const doi = normalizeDoi(source.bibliography?.doi);
    next.push({ sourceId: source.contentId, ...(doi ? { doi } : {}), text: body });
  }
  if (!validNoteReferenceEdits(next)) throw new RangeError('Invalid reference edit');
  return next.length ? next : undefined;
}
export function remapReferenceEdits(edits: NoteReferenceEdit[] | undefined, ids: ReadonlyMap<string, string>) {
  return edits?.map(edit => ({ ...edit, sourceId: ids.get(edit.sourceId) || edit.sourceId }));
}
