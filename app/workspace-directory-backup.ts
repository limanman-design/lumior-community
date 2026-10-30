import type { WorkspaceSnapshot } from './workspace-store.ts';
import { fileReferencePrefix, fileReferences, mediaReferences, serializeWorkspace, mapWorkspaceStrings, type StoredFile } from './workspace-assets.ts';
import { remapBackupAttachments, validateBackupWorkspace } from './workspace-backup.ts';
import { mapPortableFileKeys, readDesktopPortableBackup, type DesktopPortableBackup } from './desktop-portable-backup.ts';
import { remapContentLink } from './content-links.ts';
import { translate } from './i18n-core.ts';

export const directoryBackupChunkBytes = 4 * 1024 * 1024;
const maxManifestBytes = 64 * 1024 * 1024;
const maxFiles = 300_000, maxTotalBytes = 64 * 1024 * 1024 * 1024;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const sha256 = /^[a-f0-9]{64}$/;
export type BackupWritable = { write(data: Uint8Array<ArrayBuffer> | string): Promise<void>; close(): Promise<void>; abort(reason?: unknown): Promise<void> };
export type BackupFileHandle = { getFile(): Promise<File>; createWritable(): Promise<BackupWritable> };
export type BackupDirectoryHandle = {
  name: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<BackupDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<BackupFileHandle>;
};
type BackupSource = { getFile(id: string): Promise<StoredFile | undefined>; fetch(url: string): Promise<Response> };
type Entry = { id: string; name: string; type: string; size: number; chunks: string[] };
type Manifest = { format: 'lumior-directory-backup'; version: 1; chunkBytes: number; createdAt: string; workspace: WorkspaceSnapshot; files: Entry[]; portable?: DesktopPortableBackup };
export type PreparedDirectoryBackup = {
  snapshot: WorkspaceSnapshot; createdAt: string; portable?: DesktopPortableBackup;
  fileCount: number; totalBytes: number; fileIds: string[];
  /** Revalidate each file at consumption time; do not retain the whole library. */
  files(): AsyncGenerator<StoredFile>;
};
type Options = { signal?: AbortSignal; progress?: (message: string) => void; portable?: DesktopPortableBackup };
const invalid = () => new Error(translate('The backup folder is incomplete or invalid.', '备份文件夹不完整或格式无效。'));
const cancelled = (signal?: AbortSignal) => { signal?.throwIfAborted(); };
const digest = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');

/** Call directly from the user's click, before waiting for workspace saves. */
export async function pickWorkspaceBackupDirectory(mode: 'read' | 'readwrite'): Promise<BackupDirectoryHandle> {
  const picker = (globalThis as unknown as { showDirectoryPicker?: (options: { mode: 'read' | 'readwrite'; id: string }) => Promise<BackupDirectoryHandle> }).showDirectoryPicker;
  if (!picker) throw new Error(translate('Folder backups require a desktop app or a browser with folder access.', '文件夹备份需要支持文件夹访问的桌面应用或浏览器。'));
  return picker.call(globalThis, { mode, id: mode === 'readwrite' ? 'lumior-backup-export' : 'lumior-backup-restore' });
}

async function copyAndHash(blob: Blob, writable: BackupWritable | undefined, signal?: AbortSignal): Promise<string[]> {
  const chunks: string[] = [];
  for (let offset = 0; offset < blob.size; offset += directoryBackupChunkBytes) {
    cancelled(signal);
    const bytes = new Uint8Array(await blob.slice(offset, offset + directoryBackupChunkBytes).arrayBuffer());
    if (bytes.length !== Math.min(directoryBackupChunkBytes, blob.size - offset)) throw invalid();
    chunks.push(await digest(bytes));
    cancelled(signal);
    if (writable) await writable.write(bytes);
  }
  cancelled(signal);
  return chunks;
}

/** New random subdirectory; a completed manifest is written only after all data. */
export async function createWorkspaceDirectoryBackup(
  snapshot: WorkspaceSnapshot, source: BackupSource, parent: BackupDirectoryHandle, options: Options = {},
): Promise<{ directoryName: string; fileCount: number; totalBytes: number }> {
  cancelled(options.signal);
  const serialized = serializeWorkspace(snapshot);
  validateBackupWorkspace(serialized);
  const portable = options.portable === undefined ? undefined : readDesktopPortableBackup(options.portable);
  const references = [...new Set([...fileReferences(serialized), ...mediaReferences(serialized)])];
  if (references.length > maxFiles) throw invalid();
  const directoryName = `Lumior-backup-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}`;
  try { await parent.getDirectoryHandle(directoryName); throw new Error(translate('The backup destination already exists. Try again.', '备份目标已存在，请重试。')); }
  catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error; }
  const directory = await parent.getDirectoryHandle(directoryName, { create: true });
  const data = await directory.getDirectoryHandle('files', { create: true });
  const replacements = new Map<string, string>(), entries: Entry[] = [];
  const storedIds = new Set<string>();
  let totalBytes = 0;
  for (const [index, reference] of references.entries()) {
    cancelled(options.signal);
    options.progress?.(translate('Saving backup files {current} / {total}', '正在备份文件 {current} / {total}', { current: index + 1, total: references.length }));
    let record: StoredFile;
    if (reference.startsWith(fileReferencePrefix)) {
      const found = await source.getFile(reference.slice(fileReferencePrefix.length));
      if (!found) throw new Error(translate('A required file is missing. The backup was not completed.', '所需文件缺失，备份未完成。'));
      record = found;
    } else {
      const response = await source.fetch(reference);
      if (!response.ok) throw new Error(translate('A required file could not be read. The backup was not completed.', '所需文件无法读取，备份未完成。'));
      const blob = await response.blob();
      record = { id: crypto.randomUUID(), name: reference.split('/').pop() || 'Attachment', type: blob.type, size: blob.size, blob };
    }
    if (!uuid.test(record.id) || record.size !== record.blob.size || !Number.isSafeInteger(record.size) || record.size < 0) throw invalid();
    replacements.set(reference, fileReferencePrefix + record.id);
    if (storedIds.has(record.id)) continue;
    storedIds.add(record.id);
    totalBytes += record.size;
    if (totalBytes > maxTotalBytes) throw new Error(translate('Folder backups currently support up to 64 GB.', '文件夹备份目前支持最多 64 GB。'));
    const writable = await (await data.getFileHandle(record.id, { create: true })).createWritable();
    try {
      const chunks = await copyAndHash(record.blob, writable, options.signal);
      await writable.close();
      entries.push({ id: record.id, name: record.name, type: record.type, size: record.size, chunks });
    } catch (error) { await writable.abort().catch(() => {}); throw error; }
  }
  cancelled(options.signal);
  const manifest: Manifest = { format: 'lumior-directory-backup', version: 1, chunkBytes: directoryBackupChunkBytes, createdAt: new Date().toISOString(), workspace: remapBackupAttachments(serialized, replacements), files: entries, ...(portable ? { portable: mapPortableFileKeys(portable, replacements) } : {}) };
  const json = JSON.stringify(manifest);
  if (new TextEncoder().encode(json).length > maxManifestBytes) throw new Error(translate('The workspace index is too large for this backup format.', '工作区目录信息超出此备份格式的容量。'));
  const writable = await (await directory.getFileHandle('manifest.json', { create: true })).createWritable();
  try { await writable.write(json); cancelled(options.signal); await writable.close(); }
  catch (error) { await writable.abort().catch(() => {}); throw error; }
  return { directoryName, fileCount: entries.length, totalBytes };
}

async function verifiedFile(directory: BackupDirectoryHandle, entry: Entry, signal?: AbortSignal): Promise<StoredFile> {
  cancelled(signal);
  const file = await (await directory.getFileHandle(entry.id)).getFile();
  if (file.size !== entry.size) throw invalid();
  const chunks = await copyAndHash(file, undefined, signal);
  if (chunks.length !== entry.chunks.length || chunks.some((hash, index) => hash !== entry.chunks[index])) throw new Error(translate('Backup file verification failed. The file may have changed or be incomplete.', '备份文件校验失败，文件可能已改变或不完整。'));
  return { id: entry.id, name: entry.name, type: entry.type, size: entry.size, blob: file };
}

export async function readWorkspaceDirectoryBackup(directory: BackupDirectoryHandle, progress?: (message: string) => void, signal?: AbortSignal): Promise<PreparedDirectoryBackup> {
  cancelled(signal);
  const file = await (await directory.getFileHandle('manifest.json')).getFile();
  if (file.size > maxManifestBytes) throw invalid();
  let manifest: Manifest;
  try { manifest = JSON.parse(await file.text()) as Manifest; } catch { throw invalid(); }
  if (!manifest || manifest.format !== 'lumior-directory-backup' || manifest.version !== 1 || manifest.chunkBytes !== directoryBackupChunkBytes || typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt)) || !Array.isArray(manifest.files) || manifest.files.length > maxFiles) throw invalid();
  const snapshot = validateBackupWorkspace(manifest.workspace);
  const portable = manifest.portable === undefined ? undefined : readDesktopPortableBackup(manifest.portable);
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const entry of manifest.files) {
    if (!entry || typeof entry.id !== 'string' || !uuid.test(entry.id) || ids.has(entry.id) || typeof entry.name !== 'string' || typeof entry.type !== 'string' || !Number.isSafeInteger(entry.size) || entry.size < 0 || !Array.isArray(entry.chunks) || entry.chunks.length !== Math.ceil(entry.size / directoryBackupChunkBytes) || entry.chunks.some(hash => typeof hash !== 'string' || !sha256.test(hash))) throw invalid();
    ids.add(entry.id); totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes) || totalBytes > maxTotalBytes) throw invalid();
  }
  for (const reference of fileReferences(snapshot)) if (!reference.startsWith(fileReferencePrefix) || !ids.has(reference.slice(fileReferencePrefix.length))) throw invalid();
  if (mediaReferences(snapshot).some(reference => !reference.startsWith(fileReferencePrefix))) throw invalid();
  const data = await directory.getDirectoryHandle('files');
  for (const [index, entry] of manifest.files.entries()) {
    progress?.(translate('Verifying backup files {current} / {total}', '正在验证备份文件 {current} / {total}', { current: index + 1, total: manifest.files.length }));
    await verifiedFile(data, entry, signal);
  }
  cancelled(signal);
  return { snapshot, createdAt: manifest.createdAt, ...(portable ? { portable } : {}), fileCount: manifest.files.length, totalBytes, fileIds: manifest.files.map(entry => entry.id),
    async *files() { for (const entry of manifest.files) yield await verifiedFile(data, entry, signal); },
  };
}

/** Only edited JSON is rewritten. Original Markdown bytes remain untouched. */
export function createStoredDocumentFileRemapper(snapshot: WorkspaceSnapshot, identities: Map<string, string>, replacements: ReadonlyMap<string, string>): (file: StoredFile) => Promise<StoredFile> {
  const references = new Set<string>();
  function visit(value: unknown): void {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const object = value as Record<string, unknown>;
    if (object.storedDocument && typeof object.storedDocument === 'object') {
      const document = (object.storedDocument as { document?: unknown }).document;
      if (typeof document === 'string') references.add(serializeWorkspace(document));
    }
    Object.values(object).forEach(visit);
  }
  visit(snapshot);
  return async (file: StoredFile) => {
  if (!references.has(fileReferencePrefix + file.id)) return file;
  if (file.size > 64 * 1024 * 1024) throw invalid();
  const value = JSON.parse(await file.blob.text()) as { version?: unknown; body?: unknown; blocks?: unknown };
  if (!value || value.version !== 1 || typeof value.body !== 'string' || !Array.isArray(value.blocks)) throw invalid();
  const remapped = mapWorkspaceStrings(value, text => remapContentLink(replacements.get(text) || text, identities));
  const blob = new Blob([JSON.stringify(remapped)], { type: 'application/json' });
  return { ...file, blob, size: blob.size, type: blob.type };
  };
}
