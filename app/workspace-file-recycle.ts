import type { Board } from './canvas-model';
import { contentIdentity, deleteWorkspaceContent, type RecycledContent, type WorkspaceFiles } from './workspace-files.ts';
import { dayMs, recycleRetentionDays } from './recycle-policy.ts';

export function pruneRecycledContents(files: WorkspaceFiles, now = Date.now()): WorkspaceFiles {
  const retained = files.recycledContents?.filter(item => item.expiresAt > now);
  return retained && retained.length !== files.recycledContents!.length ? { ...files, recycledContents: retained } : files;
}

export function recycleWorkspaceContent(files: WorkspaceFiles, boards: readonly Board[], id: string, now = Date.now()) {
  const content = files.contents.find(item => item.id === id);
  const entry = files.entries.find(item => item.kind === 'content' && item.contentId === id);
  if (!content || !entry) throw new Error('The file no longer exists.');
  if (!Number.isSafeInteger(now) || now < 0) throw new RangeError('Invalid recycle timestamp.');
  const retained = pruneRecycledContents(files, now).recycledContents || [];
  const references: RecycledContent['references'] = boards.flatMap(board => {
    const cards = board.cards.filter(card => contentIdentity(card) === id);
    if (!cards.length) return [];
    const ids = new Set(cards.map(card => card.id));
    // Retain connections to previously recycled files, whatever the restore order.
    const edges = new Map([...board.edges, ...retained.flatMap(item => item.references.filter(ref => ref.boardId === board.id).flatMap(ref => ref.edges))]
      .filter(edge => ids.has(edge.from) || ids.has(edge.to)).map(edge => [edge.id, edge]));
    return [{ boardId: board.id, cards, edges: [...edges.values()] }];
  });
  const removed = deleteWorkspaceContent(files, boards, id);
  const tombstoneIds = removed.files.deletedContentIds!.filter(value => value === id || !files.deletedContentIds?.includes(value));
  const recycled = structuredClone({ content, entry, references, tombstoneIds, deletedAt: now, expiresAt: now + recycleRetentionDays * dayMs });
  return { boards: removed.boards, files: { ...removed.files, recycledContents: [...retained, recycled] } };
}

export function restoreWorkspaceContent(files: WorkspaceFiles, boards: readonly Board[], id: string, now = Date.now()) {
  const item = files.recycledContents?.find(item => item.content.id === id);
  if (!item || item.expiresAt <= now) throw new Error('The file is no longer in the trash.');
  if (files.contents.some(content => content.id === id) || files.entries.some(entry => entry.id === item.entry.id)) throw new Error('A file with this identity already exists.');
  const restoredBoards = boards.map(board => {
    const reference = item.references.find(ref => ref.boardId === board.id);
    if (!reference) return board;
    // Never overwrite newer cards if a damaged/imported workspace reused an ID.
    if (reference.cards.some(card => board.cards.some(existing => existing.id === card.id))) throw new Error('A referenced card identity is already in use.');
    const cards = [...board.cards, ...structuredClone(reference.cards)];
    const ids = new Set(cards.map(card => card.id));
    const edges = reference.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to) && !board.edges.some(existing => existing.id === edge.id || existing.from === edge.from && existing.to === edge.to || existing.from === edge.to && existing.to === edge.from));
    return { ...board, cards, edges: [...board.edges, ...structuredClone(edges)] };
  });
  const remaining = (files.recycledContents || []).filter(other => other !== item);
  const reserved = new Set(remaining.flatMap(other => other.tombstoneIds));
  const folderId = files.folders.some(folder => folder.id === item.entry.folderId) ? item.entry.folderId : null;
  return {
    boards: restoredBoards,
    files: {
      ...files, contents: [...files.contents, structuredClone(item.content)],
      entries: [...files.entries, { ...item.entry, folderId }], recycledContents: remaining,
      deletedContentIds: files.deletedContentIds?.filter(value => !item.tombstoneIds.includes(value) || reserved.has(value)),
    },
  };
}
