import type { Board, Card } from './canvas-model';
import type { WorkspaceFiles } from './workspace-files';
import { documentText } from './card-document.ts';
import { createGlobalCardSearchIndex } from './global-card-search-model.ts';

export type GlobalWorkspaceSearchEntry = {
  key: string;
  title: string;
  body: string;
  location: string;
  searchableTitle: string;
  searchableText: string;
  thumbnail?: string;
  card?: Card;
} & (
  | { kind: 'board' | 'content'; entryId: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'card'; boardId: string; card: Card }
);

const normalize = (value: string) => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const searchFields = (title: string, text: string) => ({ searchableTitle: normalize(title), searchableText: normalize(`${title}\n${text}`) });

/** Local text only. Index the active registry once per content identity so a
 * shared note on several boards does not flood the global results. Deleted
 * records and media bodies/transcripts are never loaded for search. */
export function createGlobalWorkspaceSearchIndex(boards: readonly Board[], files?: WorkspaceFiles): GlobalWorkspaceSearchEntry[] {
  const entries: GlobalWorkspaceSearchEntry[] = [];
  const folders = new Map(files?.folders.map(folder => [folder.id, folder]));
  const folderPath = (folderId?: string | null) => {
    const names: string[] = [], seen = new Set<string>();
    let id = folderId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const folder = folders.get(id);
      if (!folder) break;
      names.unshift(folder.title); id = folder.parentId;
    }
    return names.join(' / ');
  };
  const fileEntries = new Map(files?.entries.map(entry => [entry.id, entry]));
  for (const board of boards) {
    const entryId = `board:${board.id}`, location = folderPath(fileEntries.get(entryId)?.folderId);
    entries.push({ key: entryId, kind: 'board', entryId, title: board.title, body: '', location,
      ...searchFields(board.title, location) });
  }
  for (const folder of files?.folders || []) {
    const location = folderPath(folder.parentId);
    entries.push({ key: `folder:${folder.id}`, kind: 'folder', folderId: folder.id, title: folder.title,
      body: '', location, ...searchFields(folder.title, location) });
  }
  const deletedIds = new Set([...(files?.deletedContentIds || []), ...(files?.recycledContents?.map(item => item.content.id) || [])]);
  const registered = new Set<string>();
  for (const content of files?.contents || []) {
    if (deletedIds.has(content.id)) continue;
    registered.add(content.id);
    const card = content.card, entryId = `content:${content.id}`, location = folderPath(fileEntries.get(entryId)?.folderId);
    const title = card.title.trim() || card.pdf?.name || card.sourceName || '';
    const body = card.blocks?.length ? documentText(card.blocks) : [card.body, card.detail].filter(Boolean).join('\n\n');
    entries.push({ key: entryId, kind: 'content', entryId, card, title, body, location,
      thumbnail: card.image || card.pdf?.thumbnail || card.video?.poster || undefined,
      ...searchFields(title, [body, location, ...(card.tags || []), ...(content.authors || card.authors || []), String(content.year ?? card.year ?? '')].join(' ')) });
  }
  // Legacy/non-registry cards remain findable, with their original board location.
  const unregisteredBoards = boards.map(board => ({ ...board, cards: board.cards.filter(card =>
    !registered.has(card.sharedId || card.id) && !deletedIds.has(card.sharedId || card.id)) }));
  for (const entry of createGlobalCardSearchIndex(unregisteredBoards)) {
    entries.push({ ...entry, kind: 'card', location: entry.boardTitle });
  }
  return entries;
}
