import type { Board, Card } from './canvas-model';
import type { PdfMark } from './pdf-annotations';

export type PdfReadingNote = { mark: PdfMark; title?: string };

/** Shared by library backfill and explicit-deletion tombstones. */
export const pdfReadingNoteIdentity = (url: string, markId: string) =>
  `pdf-note:${encodeURIComponent(url)}:${encodeURIComponent(markId)}`;

export function linkedPdfNotes(source: Card, board: Board): Card[] {
  const sources = new Set(board.cards.filter(card => card.pdf?.url === source.pdf?.url).map(card => card.id));
  const linked = new Set(board.edges.flatMap(edge => sources.has(edge.from) ? [edge.to] : sources.has(edge.to) ? [edge.from] : []));
  return board.cards.filter(card => linked.has(card.id) && card.kind === 'note' && !card.pdfExcerpt);
}

export function pdfReadingNotes(url: string, marks: PdfMark[], cards: Card[]): PdfReadingNote[] {
  const result = new Map<string, PdfReadingNote>();
  for (const card of cards) {
    if (card.pdfExcerpt?.pdf.url !== url || card.pdfExcerpt.independent) continue;
    const mark = card.pdfExcerpt.mark;
    if (!result.has(mark.id)) result.set(mark.id, {
      mark: { ...mark, note: card.body },
      title: card.title !== mark.text ? card.title : undefined,
    });
  }
  for (const mark of marks) {
    const item = result.get(mark.id);
    const excerpt = cards.find(card => card.pdfExcerpt?.pdf.url === url && card.pdfExcerpt.mark.id === mark.id && !card.pdfExcerpt.independent);
    // A canvas/NotePage edit may contain newer text than the annotation store.
    // A changed annotation note still wins until the registry reconciles it.
    const note = excerpt && (excerpt.pdfExcerpt!.mark.note || '') === (mark.note || '') ? excerpt.body : mark.note;
    result.set(mark.id, { ...item, mark: { ...mark, note } });
  }
  return [...result.values()].sort((a, b) =>
    (a.mark.fragments[0]?.page || 1) - (b.mark.fragments[0]?.page || 1));
}

export function updatePdfExcerptNote(board: Board, url: string, id: string, note: string, now = new Date().toISOString()): Board {
  let changed = false;
  const cards = board.cards.map(card => {
    if (card.pdfExcerpt?.pdf.url !== url || card.pdfExcerpt.mark.id !== id || card.pdfExcerpt.independent) return card;
    if (card.body === note && card.pdfExcerpt.mark.note === note && !card.blocks) return card;
    changed = true;
    return { ...card, updatedAt: now, body: note, blocks: undefined,
      pdfExcerpt: { ...card.pdfExcerpt, mark: { ...card.pdfExcerpt.mark, note } } };
  });
  return changed ? { ...board, cards } : board;
}
