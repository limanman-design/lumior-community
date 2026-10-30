import type { Board, Card } from './canvas-model';
import { bibliographyFields, validBibliography, type Bibliography, type BibliographyField } from '../lib/bibliography.ts';

/** Merge into the latest canonical record, protecting manual edits and legacy metadata. */
export function automaticBibliographyPatch(card: Card, incoming: Bibliography): Partial<Card> {
  if (!validBibliography(incoming)) throw new TypeError('Invalid bibliography result.');
  const previous = card.bibliography;
  const manual = new Set<BibliographyField>(previous?.manualFields || []);
  for (const key of bibliographyFields) if (previous?.origins?.[key] === 'manual') manual.add(key);
  if (card.authors?.length && !previous?.origins?.authors) manual.add('authors');
  if (card.year !== undefined && !previous?.origins?.year) manual.add('year');
  const bibliography: Bibliography = { ...previous, status: incoming.status, updatedAt: new Date().toISOString(), origins: { ...previous?.origins } };
  delete bibliography.reason;
  if (incoming.reason) bibliography.reason = incoming.reason;
  if (manual.size) bibliography.manualFields = [...manual];
  for (const key of bibliographyFields) {
    if (manual.has(key)) {
      bibliography.origins![key] = 'manual';
      if (key === 'authors') bibliography.authors = card.authors;
      if (key === 'year') bibliography.year = card.year;
      continue;
    }
    if (Object.hasOwn(incoming, key) && incoming[key] !== undefined) {
      Object.assign(bibliography, { [key]: incoming[key] });
      bibliography.origins![key] = incoming.origins?.[key] || (incoming.status === 'resolved' ? 'doi' : 'pdf');
    }
  }
  const patch: Partial<Card> = { bibliography };
  if (!manual.has('authors') && bibliography.authors) patch.authors = [...bibliography.authors];
  if (!manual.has('year') && bibliography.year !== undefined) patch.year = bibliography.year;
  const fileTitle = (card.sourceName || card.pdf?.name || '').replace(/\.pdf$/i, '');
  if (!manual.has('title') && bibliography.title && (card.title === fileTitle || card.title === previous?.title || !card.title.trim())) patch.title = bibliography.title;
  return patch;
}

/** Keep canvas undo/redo about the user's canvas edit, rather than undoing a
 * separately saved metadata correction or a completed background recognition. */
export function rebaseBibliographyMetadata(board: Board, source: Card, patch: Partial<Card>): Board {
  if (source.kind !== 'pdf' || !source.pdf) return board;
  const keys = (['bibliography', 'title', 'authors', 'year'] as const).filter(key => Object.hasOwn(patch, key));
  if (!keys.length) return board;
  if (patch.bibliography !== undefined && !validBibliography(patch.bibliography)) throw new TypeError('Invalid bibliography result.');
  const identity = source.sharedId || source.id;
  let changed = false;
  const cards = board.cards.map(card => {
    if (card.kind !== 'pdf' || (card.sharedId || card.id) !== identity
      || card.pdf?.url !== source.pdf!.url || card.pdf?.size !== source.pdf!.size
      || keys.every(key => Object.is(card[key], patch[key]) || JSON.stringify(card[key]) === JSON.stringify(patch[key]))) return card;
    changed = true;
    return { ...card, ...Object.fromEntries(keys.map(key => [key, structuredClone(patch[key])])) };
  });
  return changed ? { ...board, cards } : board;
}
