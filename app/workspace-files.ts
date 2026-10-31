import { validNoteAiChange } from './note-ai-change.ts';
import {validBibliography} from '../lib/bibliography.ts';
import type { Board, Card } from './canvas-model';
import type { WorkspaceSnapshot } from './workspace-store';
import { cardContentKeys, cardCreatedTime, cardUpdatedTime, cardTimestamp } from './card-metadata.ts';
import { isDatabaseCard } from './canvas-database.ts';
import { validVideoProviderMetadata } from './video-url.ts';
import { pdfReadingNoteIdentity } from './pdf-notes.ts';
import { validStoredDocument, validObsidianSource } from './stored-document-schema.ts';
import { pruneWorkspaceFileNavigation, validWorkspaceFileNavigation, type WorkspaceFilesNavigation } from './workspace-file-navigation.ts';
export type { WorkspaceFilesNavigation, WorkspaceFileScopeNavigation, WorkspaceFileScopeState } from './workspace-file-navigation.ts';

export type WorkspaceContentRole = 'literature' | 'notePage' | 'note' | 'summary' | 'video' | 'image' | 'text';
export type WorkspaceContentVariant = { boardId: string; cardId: string; card: Card };
export type WorkspaceContent = { id: string; role: WorkspaceContentRole; card: Card; sourceContentId?: string; authors?: string[]; year?: number; variants?: WorkspaceContentVariant[] };
export type WorkspaceFolder = { id: string; title: string; parentId: string | null };
export type WorkspaceFileEntry = { id: string; kind: 'content' | 'board'; contentId?: string; boardId?: string; folderId: string | null; pinnedAt?: number; lastOpenedAt?: number; addedAt?: number };
export type RecycledContent = {
  content: WorkspaceContent;
  entry: WorkspaceFileEntry;
  references: { boardId: string; cards: Card[]; edges: Board['edges'] }[];
  tombstoneIds: string[];
  deletedAt: number;
  expiresAt: number;
};
export type WorkspaceFiles = { version: 1; contents: WorkspaceContent[]; folders: WorkspaceFolder[]; entries: WorkspaceFileEntry[]; navigation?: WorkspaceFilesNavigation; deletedContentIds?: string[]; recycledContents?: RecycledContent[] };
export type WorkspaceHomeKind = 'literature' | 'board' | 'notePage' | 'video' | 'image';
export type WorkspaceHomeItem = { id: string; kind: WorkspaceHomeKind; title: string; entry: WorkspaceFileEntry; content?: WorkspaceContent; board?: Board; authors?: string[]; year?: number; tags: string[]; lastOpenedAt?: number; updatedAt?: number };

export const contentIdentity = (card: Card) => card.sharedId || card.id;
export const contentEntryId = (id: string) => `content:${id}`;
export const boardEntryId = (id: string) => `board:${id}`;
const copy = <T,>(value: T): T => structuredClone(value);
const same = (a: unknown, b: unknown) => Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
const timestamp = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const optionalTime = (value: unknown) => value === undefined || timestamp(value);
function pruneFilesNavigation(files: WorkspaceFiles): WorkspaceFiles {
  return files.navigation ? { ...files, navigation: pruneWorkspaceFileNavigation(
    files.navigation, new Set(files.folders.map(folder => folder.id)), new Set(files.entries.map(entry => entry.id)),
    new Map(files.folders.map(folder => [folder.id, folder.parentId])), new Map(files.entries.map(entry => [entry.id, entry.folderId])),
  ) } : files;
}
const roles = new Set(['literature', 'notePage', 'note', 'summary', 'video', 'image', 'text']);
const knownSummaries = new Map<string, string>();
// Workspace records are immutable snapshots. A normalized pair can be reused
// until either the files or the committed board array changes.
const synchronizedBoards = new WeakMap<WorkspaceFiles, readonly Board[]>();
const documentEditKeys = new Set<keyof Card>(['title', 'body', 'blocks', 'storedDocument', 'aiNoteChange', 'updatedAt']);

export function workspaceCardRole(card: Card): WorkspaceContentRole {
  if (card.kind === 'database') throw new Error('Database links are not knowledge content.');
  if (card.pdfExcerpt || card.contentRole === 'summary' || knownSummaries.has(card.id) || knownSummaries.has(contentIdentity(card))) return 'summary';
  if (card.contentRole) return card.contentRole;
  return card.kind === 'pdf' ? 'literature' : card.kind === 'note' ? 'note' : card.kind;
}

// Registry migration is additive. Original boards and every differing shared copy
// are retained; variants are also the baseline for later field-level edits.
export function syncWorkspaceFiles(files: WorkspaceFiles | undefined, boards: readonly Board[]): WorkspaceFiles {
  if (files && synchronizedBoards.get(files) === boards) return files;
  const original = files;
  const result: WorkspaceFiles = files ? copy(files) : { version: 1, contents: [], folders: [], entries: [] };
  const contents = new Map(result.contents.map(content => [content.id, content]));
  const recycledIds = new Set(result.recycledContents?.map(item => item.content.id));
  const aliases = new Map<string, string>();
  for (const board of boards) for (const card of board.cards) aliases.set(card.id, contentIdentity(card));
  for (const content of result.contents) aliases.set(content.card.id, content.id);
  const sourceId = (card: Card) => {
    const source = card.sourceContentId || card.pdfExcerpt?.sourceId || knownSummaries.get(card.id) || knownSummaries.get(contentIdentity(card));
    return source ? aliases.get(source) || source : undefined;
  };
  for (const board of boards) {
    for (const card of board.cards) {
      if (isDatabaseCard(card)) continue;
      const id = contentIdentity(card);
      if (recycledIds.has(id)) continue;
      let content = contents.get(id);
      if (!content) {
        content = { id, role: workspaceCardRole(card), card: { ...copy(card), id, sharedId: id }, variants: [] };
        contents.set(id, content);
        result.contents.push(content);
      } else {
        const previous = content.variants?.find(variant => variant.boardId === board.id && variant.cardId === card.id);
        if (previous) {
          const edited = cardContentKeys.filter(key => !same(previous.card[key], card[key]));
          if (edited.length) {
            content.card = { ...content.card, ...Object.fromEntries(edited.map(key => [key, copy(card[key])])), ...(card.updatedAt ? { updatedAt: card.updatedAt } : {}) };
            content.role = workspaceCardRole(content.card);
          }
        }
      }
      const variants = content.variants || [];
      const index = variants.findIndex(variant => variant.boardId === board.id && variant.cardId === card.id);
      const variant = { boardId: board.id, cardId: card.id, card: copy(card) };
      if (index < 0) variants.push(variant); else variants[index] = variant;
      content.variants = variants;
      const source = sourceId(content.card) || sourceId(card);
      if (source) content.sourceContentId = source; else delete content.sourceContentId;
      if (content.card.authors) content.authors = [...content.card.authors]; else delete content.authors;
      if (content.card.year !== undefined) content.year = content.card.year; else delete content.year;
    }
  }
  // Library cards carry canonical classification and provenance themselves.
  // Legacy board instances and their variant baselines stay byte-for-byte intact.
  for (const content of result.contents) {
    const source = sourceId(content.card) || content.sourceContentId;
    content.card = { ...content.card, contentRole: content.role, ...(source ? { sourceContentId: source } : {}) };
    if (source) content.sourceContentId = source;
  }
  // Excerpts retain enough source information to keep the original readable even
  // after its final canvas instance is removed. No titles are used to infer links.
  for (const content of result.contents) {
    const excerpt = content.card.pdfExcerpt;
    const id = content.sourceContentId;
    if (!excerpt || !id || contents.has(id) || result.deletedContentIds?.includes(id)) continue;
    const card: Card = { id, sharedId: id, kind: 'pdf', contentRole: 'literature', title: excerpt.sourceTitle, body: '', pdf: copy(excerpt.pdf), x: 0, y: 0, width: 360 };
    const source: WorkspaceContent = { id, role: 'literature', card, variants: [] };
    contents.set(id, source); result.contents.push(source);
  }
  // A removed reference remains in the registry, while its stale baseline is
  // discarded so re-adding it cannot overwrite the canonical content.
  for (const content of result.contents) if (content.variants) content.variants = content.variants.filter(variant => boards.some(board => board.id === variant.boardId && board.cards.some(card => card.id === variant.cardId && contentIdentity(card) === content.id)));
  const boardIds = new Set(boards.map(board => board.id));
  result.entries = result.entries.filter(entry => entry.kind !== 'board' || boardIds.has(entry.boardId!));
  const entryById = new Map(result.entries.map(entry => [entry.id, entry]));
  for (const content of result.contents) if (!entryById.has(contentEntryId(content.id))) {
    const owner = content.variants?.find(variant => boardIds.has(variant.boardId));
    const folderId = owner ? entryById.get(boardEntryId(owner.boardId))?.folderId ?? null : null;
    const entry: WorkspaceFileEntry = { id: contentEntryId(content.id), kind: 'content', contentId: content.id, folderId };
    result.entries.push(entry); entryById.set(entry.id, entry);
  }
  for (const board of boards) {
    if (!entryById.has(boardEntryId(board.id))) {
      const entry: WorkspaceFileEntry = { id: boardEntryId(board.id), kind: 'board', boardId: board.id, folderId: null, ...(timestamp(board.pinnedAt) ? { pinnedAt: board.pinnedAt } : {}) };
      result.entries.push(entry); entryById.set(entry.id, entry);
    }
  }
  if (result.navigation) result.navigation = pruneFilesNavigation(result).navigation;
  const synchronized = original && same(original, result) ? original : result;
  synchronizedBoards.set(synchronized, boards);
  return synchronized;
}

export function ensureWorkspaceFiles(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
  const files = syncWorkspaceFiles(snapshot.files, snapshot.boards);
  return files === snapshot.files ? snapshot : { ...snapshot, files };
}

export function validWorkspaceFiles(value: unknown): value is WorkspaceFiles {
  if (!value || typeof value !== 'object') return false;
  const files = value as WorkspaceFiles;
  if (files.version !== 1 || !Array.isArray(files.contents) || !Array.isArray(files.folders) || !Array.isArray(files.entries)) return false;
  const string = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
  const card = (value: Card) => value && string(value.id) && typeof value.title === 'string' && typeof value.body === 'string' && ['note', 'text', 'pdf', 'video', 'image'].includes(value.kind) && [value.x, value.y, value.width].every(Number.isFinite) && value.width > 0 && (value.height === undefined || Number.isFinite(value.height)) && (value.bibliography === undefined || validBibliography(value.bibliography)) && (value.kind !== 'video' || validVideoProviderMetadata(value.video))
    && (value.aiNoteChange === undefined || value.kind === 'note' && validNoteAiChange(value.aiNoteChange))
    && (value.obsidianSource === undefined || validObsidianSource(value.obsidianSource))
    && (value.storedDocument === undefined || (value.kind === 'note' && validStoredDocument(value.storedDocument) && value.body === '' && value.blocks === undefined
      && (!value.obsidianSource || value.obsidianSource.libraryId === value.storedDocument.libraryId && value.obsidianSource.path === value.storedDocument.path)));
  const unique = (ids: string[]) => new Set(ids).size === ids.length;
  if (files.deletedContentIds !== undefined && (!Array.isArray(files.deletedContentIds) || !files.deletedContentIds.every(string) || !unique(files.deletedContentIds))) return false;
  const invalidContent = (content: WorkspaceContent) => !content || !string(content.id) || !roles.has(content.role) || !card(content.card) || content.sourceContentId !== undefined && !string(content.sourceContentId) || content.authors !== undefined && (!Array.isArray(content.authors) || !content.authors.every(author => typeof author === 'string')) || content.year !== undefined && (!Number.isInteger(content.year) || content.year < 0) || content.variants !== undefined && (!Array.isArray(content.variants) || content.variants.some(variant => !variant || !string(variant.boardId) || !string(variant.cardId) || !card(variant.card)));
  if (files.contents.some(invalidContent) || !unique(files.contents.map(content => content.id))) return false;
  if (files.folders.some(folder => !folder || !string(folder.id) || typeof folder.title !== 'string' || !folder.title.trim() || folder.parentId !== null && !string(folder.parentId)) || !unique(files.folders.map(folder => folder.id))) return false;
  const folders = new Map(files.folders.map(folder => [folder.id, folder]));
  for (const folder of files.folders) {
    const visited = new Set([folder.id]); let parent = folder.parentId;
    while (parent !== null) { if (visited.has(parent) || !folders.has(parent)) return false; visited.add(parent); parent = folders.get(parent)!.parentId; }
  }
  const contentIds = new Set(files.contents.map(content => content.id));
  if (files.recycledContents !== undefined) {
    if (!Array.isArray(files.recycledContents)) return false;
    const recycledIds = new Set<string>();
    for (const item of files.recycledContents) {
      if (!item || invalidContent(item.content) || contentIds.has(item.content.id) || recycledIds.has(item.content.id)
        || !timestamp(item.deletedAt) || !timestamp(item.expiresAt) || item.expiresAt <= item.deletedAt
        || !item.entry || item.entry.kind !== 'content' || item.entry.contentId !== item.content.id || item.entry.id !== contentEntryId(item.content.id)
        || item.entry.folderId !== null && !string(item.entry.folderId) || !optionalTime(item.entry.pinnedAt) || !optionalTime(item.entry.lastOpenedAt) || !optionalTime(item.entry.addedAt)
        || !Array.isArray(item.tombstoneIds) || !item.tombstoneIds.every(string) || !item.tombstoneIds.includes(item.content.id)
        || !Array.isArray(item.references) || item.references.some(ref => !ref || !string(ref.boardId)
          || !Array.isArray(ref.cards) || !ref.cards.length || ref.cards.some(value => !card(value) || contentIdentity(value) !== item.content.id) || !unique(ref.cards.map(value => value.id))
          || !Array.isArray(ref.edges) || ref.edges.some(edge => !edge || !string(edge.id) || !string(edge.from) || !string(edge.to) || edge.label !== undefined && typeof edge.label !== 'string'))
        || !unique(item.references.map(ref => ref.boardId))) return false;
      recycledIds.add(item.content.id);
    }
  }
  if (files.entries.some(entry => !entry || !string(entry.id) || !['board', 'content'].includes(entry.kind) || entry.folderId !== null && !folders.has(entry.folderId) || !optionalTime(entry.pinnedAt) || !optionalTime(entry.lastOpenedAt) || !optionalTime(entry.addedAt) || (entry.kind === 'content' ? !contentIds.has(entry.contentId!) || entry.id !== contentEntryId(entry.contentId!) : !string(entry.boardId) || entry.id !== boardEntryId(entry.boardId))) || !unique(files.entries.map(entry => entry.id))) return false;
  if (files.navigation !== undefined && !validWorkspaceFileNavigation(files.navigation, new Set(folders.keys()), new Set(files.entries.map(entry => entry.id)))) return false;
  return true;
}

export function projectWorkspaceFiles(files: WorkspaceFiles, boards: readonly Board[]): WorkspaceHomeItem[] {
  const contents = new Map(files.contents.map(content => [content.id, content]));
  const boardMap = new Map(boards.map(board => [board.id, board]));
  return files.entries.flatMap<WorkspaceHomeItem>(entry => {
    if (entry.kind === 'board') {
      const board = boardMap.get(entry.boardId!);
      if (!board) return [];
      const addedAt = entry.addedAt ?? (cardTimestamp(board.createdAt) || undefined);
      const updatedAt = board.cards.reduce<number | undefined>((latest, card) => latestFileTime(latest, cardUpdatedTime(card) || undefined), latestFileTime(addedAt, cardTimestamp(board.updatedAt) || undefined));
      return [{ id: entry.id, kind: 'board' as const, title: board.title, entry, board, tags: [], lastOpenedAt: latestFileTime(entry.lastOpenedAt, addedAt), updatedAt }];
    }
    const content = contents.get(entry.contentId!);
    if (!content || content.role === 'summary' || content.role === 'note' || content.role === 'text') return [];
    // Adding a file is a recent action even before its first open. Legacy files
    // use their real creation date; simulated seed dates never become history.
    const addedAt = entry.addedAt ?? (cardCreatedTime(content.card) || undefined);
    return [{ id: entry.id, kind: content.role, title: content.card.title, entry, content, authors: content.authors, year: content.year, tags: content.card.tags || [], lastOpenedAt: latestFileTime(entry.lastOpenedAt, addedAt), updatedAt: latestFileTime(addedAt, cardUpdatedTime(content.card) || undefined) }];
  });
}

function latestFileTime(...values: (number | undefined)[]): number | undefined {
  const known = values.filter((value): value is number => value !== undefined && timestamp(value));
  return known.length ? Math.max(...known) : undefined;
}

function requireFolder(files: WorkspaceFiles, id: string | null) { if (id !== null && !files.folders.some(folder => folder.id === id)) throw new Error('Folder does not exist.'); }
function title(value: string) { const trimmed = value.trim(); if (!trimmed) throw new Error('A name is required.'); return trimmed; }
export function createWorkspaceFolder(files: WorkspaceFiles, name: string, parentId: string | null = null, id = crypto.randomUUID()): WorkspaceFiles {
  requireFolder(files, parentId); if (files.folders.some(folder => folder.id === id)) throw new Error('Folder identity already exists.');
  return { ...files, folders: [...files.folders, { id, title: title(name), parentId }] };
}
export function renameWorkspaceFolder(files: WorkspaceFiles, id: string, name: string): WorkspaceFiles { requireFolder(files, id); return { ...files, folders: files.folders.map(folder => folder.id === id ? { ...folder, title: title(name) } : folder) }; }
export function moveWorkspaceFolder(files: WorkspaceFiles, id: string, parentId: string | null): WorkspaceFiles {
  requireFolder(files, id); requireFolder(files, parentId); let ancestor = parentId;
  while (ancestor !== null) { if (ancestor === id) throw new Error('A folder cannot move into itself or its descendants.'); ancestor = files.folders.find(folder => folder.id === ancestor)!.parentId; }
  return pruneFilesNavigation({ ...files, folders: files.folders.map(folder => folder.id === id ? { ...folder, parentId } : folder) });
}
export function deleteWorkspaceFolder(files: WorkspaceFiles, id: string): WorkspaceFiles {
  requireFolder(files, id);
  // Delete this container only. Child folders keep their own contents and tree.
  const next = { ...files, folders: files.folders.filter(folder => folder.id !== id).map(folder => folder.parentId === id ? { ...folder, parentId: null } : folder), entries: files.entries.map(entry => entry.folderId === id ? { ...entry, folderId: null } : entry) };
  return pruneFilesNavigation(next);
}
export function moveWorkspaceEntry(files: WorkspaceFiles, id: string, folderId: string | null): WorkspaceFiles { requireFolder(files, folderId); if (!files.entries.some(entry => entry.id === id)) throw new Error('File does not exist.'); return pruneFilesNavigation({ ...files, entries: files.entries.map(entry => entry.id === id ? { ...entry, folderId } : entry) }); }
export function setWorkspaceEntryPinned(files: WorkspaceFiles, id: string, pinned: boolean, now = Date.now()): WorkspaceFiles { if (!timestamp(now)) throw new RangeError('Invalid timestamp.'); return { ...files, entries: files.entries.map(entry => { if (entry.id !== id) return entry; const { pinnedAt: _pin, ...rest } = entry; return pinned ? { ...entry, pinnedAt: entry.pinnedAt ?? now } : rest; }) }; }
export function markWorkspaceEntryOpened(files: WorkspaceFiles, id: string, now = Date.now()): WorkspaceFiles { if (!timestamp(now)) throw new RangeError('Invalid timestamp.'); return { ...files, entries: files.entries.map(entry => entry.id === id ? { ...entry, lastOpenedAt: now } : entry) }; }

export function addWorkspaceContent(files: WorkspaceFiles, card: Card, folderId: string | null = null, role: WorkspaceContentRole = workspaceCardRole(card), now = Date.now()): WorkspaceFiles {
  if (!timestamp(now)) throw new RangeError('Invalid timestamp.');
  if (isDatabaseCard(card)) throw new Error('Database links belong to whiteboards only.');
  requireFolder(files, folderId); const id = contentIdentity(card); if (files.contents.some(content => content.id === id) || files.recycledContents?.some(item => item.content.id === id)) throw new Error('Content identity already exists.');
  const content: WorkspaceContent = { id, role, card: { ...copy(card), id, sharedId: id, contentRole: role }, variants: [], ...(card.sourceContentId ? { sourceContentId: card.sourceContentId } : {}), ...(card.authors ? { authors: [...card.authors] } : {}), ...(card.year !== undefined ? { year: card.year } : {}) };
  return { ...files, contents: [...files.contents, content], entries: [...files.entries, { id: contentEntryId(id), kind: 'content', contentId: id, folderId, addedAt: now }], ...(files.deletedContentIds ? { deletedContentIds: files.deletedContentIds.filter(deletedId => deletedId !== id) } : {}) };
}

/** One immutable append for an import; old records retain their exact identity. */
export function appendWorkspaceContentBatch(
  files: WorkspaceFiles,
  additions: readonly { card: Card; folderId: string | null }[],
  folders: readonly WorkspaceFolder[] = [],
  now = Date.now(),
): WorkspaceFiles {
  if (!timestamp(now)) throw new RangeError('Invalid timestamp.');
  const folderIds = new Set(files.folders.map(folder => folder.id));
  const newFolders: WorkspaceFolder[] = [];
  for (const folder of folders) {
    if (!folder.id || folderIds.has(folder.id)) throw new Error('Folder identity already exists.');
    if (folder.parentId !== null && !folderIds.has(folder.parentId)) throw new Error('Folder does not exist.');
    newFolders.push({ ...folder, title: title(folder.title) }); folderIds.add(folder.id);
  }
  const contentIds = new Set([...files.contents.map(content => content.id), ...(files.recycledContents?.map(item => item.content.id) || [])]);
  const entryIds = new Set(files.entries.map(entry => entry.id));
  const contents: WorkspaceContent[] = [], entries: WorkspaceFileEntry[] = [], importedIds = new Set<string>();
  for (const { card, folderId } of additions) {
    if (folderId !== null && !folderIds.has(folderId)) throw new Error('Folder does not exist.');
    const id = contentIdentity(card), role = workspaceCardRole(card);
    if (!id || contentIds.has(id) || entryIds.has(contentEntryId(id))) throw new Error('Content identity already exists.');
    contentIds.add(id); importedIds.add(id); entryIds.add(contentEntryId(id));
    contents.push({ id, role, card: { ...copy(card), id, sharedId: id, contentRole: role }, variants: [],
      ...(card.sourceContentId ? { sourceContentId: card.sourceContentId } : {}), ...(card.authors ? { authors: [...card.authors] } : {}), ...(card.year !== undefined ? { year: card.year } : {}) });
    entries.push({ id: contentEntryId(id), kind: 'content', contentId: id, folderId, addedAt: now });
  }
  const result: WorkspaceFiles = { ...files, contents: [...files.contents, ...contents], folders: [...files.folders, ...newFolders], entries: [...files.entries, ...entries],
    ...(files.deletedContentIds ? { deletedContentIds: files.deletedContentIds.filter(id => !importedIds.has(id)) } : {}) };
  if (!validWorkspaceFiles(result)) throw new Error('Imported file records are invalid.');
  return result;
}

export function patchWorkspaceContent(files: WorkspaceFiles, boards: readonly Board[], id: string, patch: Partial<Card>): { files: WorkspaceFiles; boards: Board[] } {
  if (!files.contents.some(content => content.id === id)) throw new Error('Content does not exist.');
  if (patch.bibliography !== undefined && !validBibliography(patch.bibliography)) throw new Error('Invalid literature information.');
  // The editor already supplies an immutable block snapshot. Keep that identity
  // through the canonical card and its references so it remains a local echo.
  const documentEdit = Object.keys(patch).every(key => documentEditKeys.has(key as keyof Card));
  const edited = Object.fromEntries(cardContentKeys.filter(key => Object.hasOwn(patch, key)).map(key => [key, documentEdit ? patch[key] : copy(patch[key])]));
  const updatedAt = patch.updatedAt || new Date().toISOString();
  const updatedBoards = boards.map(board => { let changed = false; const cards = board.cards.map(card => { if (contentIdentity(card) !== id) return card; changed = true; return { ...card, ...edited, updatedAt }; }); return changed ? { ...board, cards, updatedAt } : board; });
  const updated = { ...files, contents: files.contents.map(content => {
    if (content.id !== id) return content;
    const card = { ...content.card, ...edited, updatedAt }; const source = card.sourceContentId || card.pdfExcerpt?.sourceId;
    return { ...content, card, role: workspaceCardRole(card), sourceContentId: source, authors: card.authors, year: card.year, variants: content.variants?.map(variant => ({ ...variant, card: { ...variant.card, ...edited, updatedAt } })) };
  }) };
  // Text edits cannot change identity, provenance, entries or classification.
  // They need no full-registry clone, migration or JSON comparison per input.
  if (documentEdit && synchronizedBoards.get(files) === boards) {
    synchronizedBoards.set(updated, updatedBoards);
    return { files: updated, boards: updatedBoards };
  }
  return { files: syncWorkspaceFiles(updated, updatedBoards), boards: updatedBoards };
}

export function removeWorkspaceContentReference(boards: readonly Board[], boardId: string, cardId: string): Board[] {
  return boards.map(board => board.id === boardId ? { ...board, cards: board.cards.filter(card => card.id !== cardId), edges: board.edges.filter(edge => edge.from !== cardId && edge.to !== cardId) } : board);
}
export function deleteWorkspaceContent(files: WorkspaceFiles, boards: readonly Board[], id: string): { files: WorkspaceFiles; boards: Board[] } {
  const entryId = contentEntryId(id);
  const excerpt = files.contents.find(content => content.id === id)?.card.pdfExcerpt;
  const noteIdentity = excerpt && !excerpt.independent ? pdfReadingNoteIdentity(excerpt.pdf.url, excerpt.mark.id) : undefined;
  const updatedBoards = boards.map(board => { const deleted = new Set(board.cards.filter(card => contentIdentity(card) === id).map(card => card.id)); return deleted.size ? { ...board, cards: board.cards.filter(card => !deleted.has(card.id)), edges: board.edges.filter(edge => !deleted.has(edge.from) && !deleted.has(edge.to)) } : board; });
  // Dependent summaries retain their embedded source PDF and provenance ID.
  const next = { ...files, deletedContentIds: [...new Set([...(files.deletedContentIds || []), id, ...(noteIdentity ? [noteIdentity] : [])])], contents: files.contents.filter(content => content.id !== id), entries: files.entries.filter(entry => entry.id !== entryId) };
  return { boards: updatedBoards, files: pruneFilesNavigation(next) };
}
