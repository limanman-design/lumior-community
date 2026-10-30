import { homeFileDragType, type HomeFileTreeNode } from './home-file-tree-model.ts';
import type { Card, Point } from './canvas-model';
import type { WorkspaceFiles } from './workspace-files';
import { libraryInstance } from './shared-cards.ts';

/** This marker distinguishes a Recent content copy from a file/folder move. */
export const recentContentDragType = 'application/x-lumior-recent-content';

type DragWriter = Pick<DataTransfer, 'setData' | 'effectAllowed'>;
type DragReader = Pick<DataTransfer, 'getData' | 'types'>;

const validEntryId = (id: string) =>
  id.startsWith('content:') && id.length > 8 && id.length <= 512;

export function canDragRecentContent(node: HomeFileTreeNode): boolean {
  return node.kind !== 'board' && node.kind !== 'folder' && validEntryId(node.id);
}

/** Keep the existing home-file payload so folder targets can still move it. */
export function writeRecentContentDrag(
  transfer: DragWriter,
  node: HomeFileTreeNode,
): boolean {
  if (!canDragRecentContent(node)) return false;
  transfer.setData(homeFileDragType, node.id);
  transfer.setData(recentContentDragType, node.id);
  transfer.effectAllowed = 'copyMove';
  return true;
}

/** The caller must still resolve this entry against its live content registry. */
export function readRecentContentDrag(transfer: DragReader): string | null {
  if (!Array.from(transfer.types).includes(recentContentDragType)) return null;
  const id = transfer.getData(recentContentDragType);
  return validEntryId(id) && transfer.getData(homeFileDragType) === id ? id : null;
}

/** A canvas drop adds a shared instance; registry entries and source stay intact. */
export function prepareRecentContentCard(
  files: WorkspaceFiles,
  entryId: string,
  point: Point,
  newId: string,
): Card | null {
  if (!validEntryId(entryId) || !newId || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const entry = files.entries.find(item => item.id === entryId && item.kind === 'content');
  if (!entry?.contentId) return null;
  const content = files.contents.find(item => item.id === entry.contentId);
  if (!content || content.card.kind === 'database') return null;
  return libraryInstance({ ...content.card, sharedId: content.id }, point, true, newId);
}
