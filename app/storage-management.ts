import { getLanguage, translate } from './i18n-core.ts';
import type { WorkspaceSnapshot } from './workspace-store.ts';
import {
  fileReferences,
  fileReferencePrefix,
  serializeWorkspace,
} from './workspace-assets.ts';

export type FileMetadata = {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt?: number;
};
export type StorageProtection = {
  snapshot: WorkspaceSnapshot;
  history: unknown[];
};
export type FileUsage = 'active' | 'recycle' | 'history' | 'recent' | 'unused';
export type FileLocation = {
  databaseId?: string;
  boardId: string;
  boardTitle: string;
  cardId: string;
  cardTitle: string;
  deleted: boolean;
};
export type ManagedFile = FileMetadata & {
  kind: 'image' | 'pdf' | 'video' | 'audio' | 'other';
  usage: FileUsage;
  locations: FileLocation[];
};
export type StorageReport = {
  files: ManagedFile[];
  totalBytes: number;
  cleanableBytes: number;
  cleanableCount: number;
  estimate: { usage?: number; quota?: number } | null;
  cleanupSupported: boolean;
};
// Do not collect a file between its successful upload and the creation of its card.
export const newFileProtectionMs = 60 * 60 * 1000;

export function fileKind(file: FileMetadata): ManagedFile['kind'] {
  if (
    file.type.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(file.name)
  )
    return 'image';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name))
    return 'pdf';
  if (file.type.startsWith('video/') || /\.(mp4|webm|mov)$/i.test(file.name))
    return 'video';
  if (file.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a)$/i.test(file.name))
    return 'audio';
  return 'other';
}

function ids(value: unknown) {
  return new Set(
    fileReferences(serializeWorkspace(value))
      .filter((reference) => reference.startsWith(fileReferencePrefix))
      .map((reference) => reference.slice(fileReferencePrefix.length)),
  );
}

export function managedFiles(
  files: FileMetadata[],
  protection: StorageProtection,
  now: number,
  saved?: WorkspaceSnapshot,
): ManagedFile[] {
  const { snapshot, history } = protection;
  const active = ids({
      boards: snapshot.boards,
      databases: snapshot.databases,
      files: snapshot.files && { ...snapshot.files, recycledContents: undefined },
    }),
    recycle = ids([snapshot.deletedBoards, snapshot.files?.recycledContents]),
    retained = ids(history);
  // Nonempty annotations may be the only remaining reference to their source PDF.
  const annotationIds = ids(
    Object.fromEntries(
      Object.entries(snapshot.pdfMarks || {}).filter(
        ([, marks]) => marks.length,
      ),
    ),
  );
  annotationIds.forEach((id) => retained.add(id));
  if (saved)
    ids({
      ...saved,
      pdfMarks: Object.fromEntries(
        Object.entries(saved.pdfMarks || {}).filter(
          ([, marks]) => marks.length,
        ),
      ),
    }).forEach((id) => retained.add(id));
  const locations = new Map<string, FileLocation[]>();
  for (const { board, deleted } of [
    ...snapshot.boards.map((board) => ({ board, deleted: false })),
    ...snapshot.deletedBoards.map((entry) => ({
      board: entry.board,
      deleted: true,
    })),
  ]) {
    for (const card of board.cards)
      for (const id of ids(card)) {
        const entries = locations.get(id) || [];
        entries.push({
          boardId: board.id,
          boardTitle: board.title,
          cardId: card.id,
          cardTitle: card.title,
          deleted,
        });
        locations.set(id, entries);
      }
  }
  for (const database of snapshot.databases || [])
    for (const record of database.records)
      for (const id of ids(record.values)) {
        const entries = locations.get(id) || [];
        entries.push({
          databaseId: database.id,
          boardId: database.id,
          boardTitle: database.title,
          cardId: record.id,
          cardTitle: record.title,
          deleted: false,
        });
        locations.set(id, entries);
      }
  for (const content of snapshot.files?.contents || [])
    for (const id of ids(content.card)) {
      const entries = locations.get(id) || [];
      if (!entries.some(entry => entry.cardId === content.id && !entry.deleted)) entries.push({ boardId: '', boardTitle: 'Files', cardId: content.id, cardTitle: content.card.title, deleted: false });
      locations.set(id, entries);
    }
  for (const item of snapshot.files?.recycledContents || [])
    for (const id of ids(item)) {
      const entries = locations.get(id) || [];
      entries.push({ boardId: '', boardTitle: 'Trash', cardId: item.content.id, cardTitle: item.content.card.title, deleted: true });
      locations.set(id, entries);
    }
  return files.map((file) => ({
    ...file,
    kind: fileKind(file),
    locations: locations.get(file.id) || [],
    usage: active.has(file.id)
      ? 'active'
      : recycle.has(file.id)
        ? 'recycle'
        : retained.has(file.id)
          ? 'history'
          : file.createdAt !== undefined &&
              now - file.createdAt < newFileProtectionMs
            ? 'recent'
            : 'unused',
  }));
}

export function cleanupCandidates(
  files: ManagedFile[],
  requestedIds: string[],
) {
  const requested = new Set(requestedIds);
  return files.filter(
    (file) => requested.has(file.id) && file.usage === 'unused',
  );
}

export function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  return `${(bytes / 1024 ** index).toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
}

export async function duplicateFileGroups(
  files: FileMetadata[],
  read: (id: string) => Promise<Blob | undefined>,
  onProgress: (done: number, total: number) => void,
): Promise<string[][]> {
  const sizes = new Map<number, FileMetadata[]>();
  for (const file of files)
    sizes.set(file.size, [...(sizes.get(file.size) || []), file]);
  const candidates = [...sizes.values()]
    .filter((group) => group.length > 1)
    .flat();
  const hashes = new Map<string, string[]>();
  for (let index = 0; index < candidates.length; index++) {
    const file = candidates[index],
      blob = await read(file.id);
    if (!blob)
      throw new Error(
        translate(
          'The file list has changed. Refresh and check again.',
          '文件列表已发生变化，请刷新后重新检查。',
        ),
      );
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()),
      ),
      (byte) => byte.toString(16).padStart(2, '0'),
    ).join('');
    hashes.set(hash, [...(hashes.get(hash) || []), file.id]);
    onProgress(index + 1, candidates.length);
  }
  return [...hashes.values()].filter((group) => group.length > 1);
}
