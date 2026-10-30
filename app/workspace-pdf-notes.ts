import type { Board, Card } from './canvas-model';
import type { PdfMark } from './pdf-annotations';
import { pdfReadingNoteIdentity } from './pdf-notes.ts';
import {
  addWorkspaceContent,
  contentEntryId,
  contentIdentity,
  deleteWorkspaceContent,
  patchWorkspaceContent,
  type WorkspaceFiles,
} from './workspace-files.ts';

export { pdfReadingNoteIdentity } from './pdf-notes.ts';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const validMark = (mark: PdfMark) =>
  mark && typeof mark.id === 'string' && !!mark.id &&
  typeof mark.text === 'string' && typeof mark.color === 'string' &&
  (mark.note === undefined || typeof mark.note === 'string') &&
  (mark.image === undefined || typeof mark.image === 'string') &&
  Array.isArray(mark.fragments) && mark.fragments.length > 0 &&
  mark.fragments.every(fragment => fragment && Number.isInteger(fragment.page) && fragment.page > 0 && Array.isArray(fragment.rects));
const hasNote = (mark: PdfMark) => !!mark.note?.trim();
const hasMaterial = (mark: PdfMark) => hasNote(mark) || !!mark.text.trim() || !!mark.image;

/**
 * Saved page notes and annotated passages become library materials, without
 * creating canvas references. Annotation changes update existing shared copies.
 * Missing source files never imply deletion of their saved notes.
 */
export function reconcileWorkspacePdfNotes(
  files: WorkspaceFiles,
  boards: readonly Board[],
  marks: Record<string, PdfMark[]>,
  now = new Date().toISOString(),
): { files: WorkspaceFiles; boards: readonly Board[] } {
  let current = files;
  let currentBoards = boards;
  const patch = (id: string, change: Partial<Card>) => {
    const next = patchWorkspaceContent(current, currentBoards, id, { ...change, updatedAt: now });
    current = next.files;
    if (next.boards.some((board, index) => board !== currentBoards[index])) currentBoards = next.boards;
  };

  // Only an explicitly present annotation collection can retire an automatic
  // material. Keep material already placed on a board as the user's own card.
  for (const content of current.contents) {
    const excerpt = content.card.pdfExcerpt;
    if (!excerpt?.readingNote || excerpt.independent || !Object.hasOwn(marks, excerpt.pdf.url) || !Array.isArray(marks[excerpt.pdf.url])) continue;
    const mark = marks[excerpt.pdf.url].find(candidate => validMark(candidate) && candidate.id === excerpt.mark.id);
    if (mark && hasMaterial(mark)) continue;
    const referenced = currentBoards.some(board => board.cards.some(card => contentIdentity(card) === content.id));
    if (referenced) {
      const { readingNote: _automatic, ...independent } = excerpt;
      patch(content.id, { pdfExcerpt: { ...independent, independent: true } });
    } else {
      const tombstones = current.deletedContentIds;
      const removed = deleteWorkspaceContent(current, currentBoards, content.id);
      current = { ...removed.files, deletedContentIds: tombstones };
      if (removed.boards.some((board, index) => board !== currentBoards[index])) currentBoards = removed.boards;
    }
  }

  for (const [url, saved] of Object.entries(marks)) {
    if (!Array.isArray(saved)) continue;
    // A shared PDF may have several board references; its canonical identity is
    // the provenance key, while the original URL matches pre-registry excerpts.
    const source = current.contents.find(content => content.card.kind === 'pdf' && content.card.pdf?.url === url);
    for (const mark of saved) {
      if (!validMark(mark)) continue;
      const matches = current.contents.filter(content => content.card.pdfExcerpt?.pdf.url === url && content.card.pdfExcerpt.mark.id === mark.id && !content.card.pdfExcerpt.independent);
      if (matches.length) {
        for (const content of matches) {
          const card = content.card;
          const excerpt = card.pdfExcerpt!;
          if (same(excerpt.mark, mark)) continue;
          const noteChanged = (excerpt.mark.note || '') !== (mark.note || '');
          // Legacy manual excerpts can contain independently authored body text.
          // Loading an old annotation collection must not overwrite that work.
          const updateBody = noteChanged && (excerpt.readingNote || card.body === (excerpt.mark.note || ''));
          patch(content.id, {
            pdfExcerpt: { ...excerpt, mark: structuredClone(mark) },
            ...(updateBody ? { body: mark.note || '', blocks: undefined } : {}),
            ...(mark.image !== excerpt.mark.image ? { image: mark.image } : {}),
          });
        }
        continue;
      }
      // Plain highlights remain annotations. A written note or saved region is
      // enough to be useful independently; blank/cancelled page notes are not.
      if (!source || (!hasNote(mark) && !mark.image)) continue;
      const identity = pdfReadingNoteIdentity(url, mark.id);
      if (current.deletedContentIds?.includes(identity)) continue;
      // A previously placed material can detach under the original identity.
      // Recreating the PDF note must create a new live material beside it.
      let id = identity;
      for (let suffix = 1; current.contents.some(content => content.id === id); suffix++) id = `${identity}:${suffix}`;
      const body = mark.note || '';
      const title = mark.text.trim().replace(/\s+/g, ' ') || body.trim().split('\n')[0].slice(0, 100) || `${source.card.title} · p.${mark.fragments[0].page}`;
      const card: Card = {
        id, sharedId: id, contentRole: 'summary', sourceContentId: source.id,
        kind: mark.image ? 'image' : 'note', title, body,
        x: 0, y: 0, width: 420, createdAt: now, updatedAt: now, creationDateSource: 'actual',
        ...(mark.image ? { image: mark.image } : {}),
        pdfExcerpt: { sourceId: source.id, sourceTitle: source.card.title, pdf: structuredClone(source.card.pdf!), mark: structuredClone(mark), readingNote: true },
      };
      const folderId = current.entries.find(entry => entry.id === contentEntryId(source.id))?.folderId || null;
      current = addWorkspaceContent(current, card, folderId, 'summary');
    }
  }
  return { files: current, boards: currentBoards };
}
