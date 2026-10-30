import {validBibliography} from '../lib/bibliography.ts';
import {validBoardThesis} from './thesis-board.ts';
import { validDatabaseReference } from './canvas-database.ts';
import type { Board } from './canvas-model';
import { validAiOperationRecords } from './ai-operation-history.ts';
import type { PdfMark } from './pdf-annotations';
import { normalizeVideoBoard } from './card-sizing.ts';
import { realignDemoBoard } from './demo-layout.ts';
import { validVideoProviderMetadata } from './video-url.ts';
import { validDatabases, type WorkspaceDatabase } from './database-model.ts';
import { ensureWorkspaceFiles, validWorkspaceFiles, type WorkspaceFiles } from './workspace-files.ts';

export const workspaceStorageKey = 'lumior-workspace-v1';
import { dayMs, recycleRetentionDays } from './recycle-policy.ts';
import { pruneRecycledContents } from './workspace-file-recycle.ts';
export { dayMs, recycleRetentionDays } from './recycle-policy.ts';
export type DeletedBoard = { board: Board; deletedAt: number; expiresAt: number };
export type WorkspaceSnapshot = { version: 1; boards: Board[]; deletedBoards: DeletedBoard[]; activeId: string; nextUntitledIndex: number; pdfMarks?: Record<string, PdfMark[]>; seedRetirementVersion?: 1; databases?: WorkspaceDatabase[]; activeDatabaseId?: string; files?: WorkspaceFiles };
// Only a genuinely new workspace uses this default. Existing snapshots, including
// previously bundled boards, are loaded without applying a seed-removal policy.
export function createInitialWorkspace(): WorkspaceSnapshot {
  return ensureWorkspaceFiles({ version: 1, boards: [], deletedBoards: [], activeId: '', nextUntitledIndex: 1, seedRetirementVersion: 1 });
}

function validPin(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function setBoardPinned(board: Board, pinned: boolean, now = Date.now()): Board {
  if (pinned) {
    if (validPin(board.pinnedAt)) return board;
    if (!validPin(now)) throw new RangeError('The pin timestamp must be a nonnegative safe integer.');
    return { ...board, pinnedAt: now };
  }
  if (!Object.hasOwn(board, 'pinnedAt')) return board;
  const { pinnedAt: _pinnedAt, ...unpinned } = board;
  return unpinned;
}

// Keep the pin with its board identity through recycling and portable backups.
// Partition active boards only; recycled boards retain their pin for restoration.
export function partitionPinnedBoards<T extends Pick<Board, 'id' | 'pinnedAt'>>(boards: readonly T[]): { pinned: T[]; recent: T[] } {
  const pinned: T[] = [], recent: T[] = [];
  for (const board of boards) (validPin(board.pinnedAt) ? pinned : recent).push(board);
  pinned.sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0));
  return { pinned, recent };
}

function normalizeBoardPin(board: Board): Board {
  return board.pinnedAt === undefined || validPin(board.pinnedAt) ? board : setBoardPinned(board, false);
}

export function nextUntitled(boards: Pick<Board, 'title'>[], minimum = 1) {
  const index = boards.reduce((next, board) => {
    const match = /^Untitled(?: ([1-9]\d*))?$/.exec(board.title);
    const used = match ? Number(match[1] || 1) : 0;
    return Number.isSafeInteger(used) ? Math.max(next, used + 1) : next;
  }, minimum);
  return { title: index === 1 ? 'Untitled' : `Untitled ${index}`, index };
}

export function recycleBoard(board: Board, now = Date.now()): DeletedBoard {
  return { board, deletedAt: now, expiresAt: now + recycleRetentionDays * dayMs };
}

export function pruneDeletedBoards(entries: DeletedBoard[], now = Date.now()) {
  return entries.filter(entry => entry.expiresAt > now);
}

// Switch only the two bundled lectures; preserve uploaded replacements and
// every instance's captions, subtitles and canvas geometry.
export function preferYoutubeHike(board: Board): Board {
  let changed = false;
  const cards = board.cards.map(card => {
    if (card.kind !== 'video' || !card.video) return card;
    const bundled = (card.video.youtubeId === 'ZW8gWgpptI8' && card.video.localUrl === '/game-research/short-hike-talk.mp4')
      || (card.video.youtubeId === '09r1B9cVEQY' && card.video.localUrl === '/game-research/invisible-talk.mp4');
    if (!bundled) return card;
    changed = true;
    const { localUrl: _localUrl, ...video } = card.video;
    return { ...card, video, ...(card.sourceName === 'GDC Festival of Gaming' ? { sourceName: 'YouTube · GDC Festival of Gaming' } : {}) };
  });
  return changed ? { ...board, cards } : board;
}

function validBoard(value: unknown): value is Board {
  if (!value || typeof value !== 'object') return false;
  const board = value as Partial<Board>;
  if (board.thesis !== undefined && !validBoardThesis(board.thesis)) return false;
  if (board.aiOperations !== undefined && !validAiOperationRecords(board.aiOperations)) return false;
  return typeof board.id === 'string' && typeof board.title === 'string' && Array.isArray(board.cards) && Array.isArray(board.edges) && board.edges.every(edge => edge && (edge.label === undefined || typeof edge.label === 'string')) && board.cards.every(card => card && (card.bibliography === undefined || validBibliography(card.bibliography)) && (card.kind !== 'database' || validDatabaseReference(card.databaseRef)) && (card.kind !== 'video' || validVideoProviderMetadata(card.video)));
}

export function readWorkspace(raw: string | null, now = Date.now()): WorkspaceSnapshot | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.boards) || !value.boards.every(validBoard) || !Array.isArray(value.deletedBoards)) return null;
    // Reject unreadable database data instead of silently saving over it.
    if (value.databases !== undefined && !validDatabases(value.databases)) return null;
    if (value.files !== undefined && !validWorkspaceFiles(value.files)) return null;
    const deletedBoards: DeletedBoard[] = pruneDeletedBoards(value.deletedBoards.filter((entry: DeletedBoard) =>
      entry && validBoard(entry.board) && Number.isFinite(entry.deletedAt) && Number.isFinite(entry.expiresAt) && entry.expiresAt > entry.deletedAt), now).map(entry => ({ ...entry, board: realignDemoBoard(normalizeVideoBoard(preferYoutubeHike(normalizeBoardPin(entry.board)))) }));
    const deletedIds = new Set(deletedBoards.map(entry => entry.board.id));
    const boards: Board[] = value.boards.filter((board: Board) => !deletedIds.has(board.id)).map((board: Board) => realignDemoBoard(normalizeVideoBoard(preferYoutubeHike(normalizeBoardPin(board)))));
    const nextUntitledIndex = nextUntitled([...boards, ...deletedBoards.map(entry => entry.board)],
      Number.isSafeInteger(value.nextUntitledIndex) && value.nextUntitledIndex > 0 ? value.nextUntitledIndex : 1).index;
    const pdfMarks = value.pdfMarks && typeof value.pdfMarks === 'object' && !Array.isArray(value.pdfMarks) ? value.pdfMarks : undefined;
    return ensureWorkspaceFiles({ version: 1, boards, deletedBoards, activeId: boards.some(board => board.id === value.activeId) ? value.activeId : boards[0]?.id || '', nextUntitledIndex, ...(pdfMarks ? {pdfMarks} : {}), ...(value.seedRetirementVersion === 1 ? { seedRetirementVersion: 1 as const } : {}), ...(value.databases ? { databases: value.databases, activeDatabaseId: value.databases.some((database: WorkspaceDatabase) => database.id === value.activeDatabaseId) ? value.activeDatabaseId : value.databases[0]?.id } : {}), ...(value.files ? {files:pruneRecycledContents(value.files, now)} : {}) });
  } catch { return null; }
}
