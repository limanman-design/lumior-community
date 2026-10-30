import type { Board } from './canvas-model';
import {
  contentEntryId,
  markWorkspaceEntryOpened,
  syncWorkspaceFiles,
  type WorkspaceFiles,
} from './workspace-files.ts';

type ContentOpenContext = {
  page: string;
  boardId: string;
  readerReturnBoardId: string | null;
};

/** Canvas reading belongs to the board; only independent file reading enters Recent. */
export function prepareWorkspaceContentOpen(
  files: WorkspaceFiles | undefined,
  boards: readonly Board[],
  identity: string,
  context: ContentOpenContext,
  requestedReturnBoardId?: string | null,
  now = Date.now(),
) {
  const current = syncWorkspaceFiles(files, boards);
  const content = current.contents.find(item => item.id === identity
    || item.variants?.some(variant => variant.cardId === identity));
  if (!content) return null;
  const returnBoardId = requestedReturnBoardId === undefined
    ? context.page === 'canvas' ? context.boardId
      : context.page.startsWith('content:') ? context.readerReturnBoardId : null
    : requestedReturnBoardId;
  return {
    content,
    returnBoardId,
    files: returnBoardId === null ? markWorkspaceEntryOpened(current, contentEntryId(content.id), now) : current,
  };
}
