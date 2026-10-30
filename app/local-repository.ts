import { translate } from './i18n-core.ts';
import type { WorkspaceSnapshot } from './workspace-store.ts';
import { readWorkspace, workspaceStorageKey } from './workspace-store.ts';
import { validWorkspaceFiles } from './workspace-files.ts';
import {
  fileReferences,
  fileReferencePrefix,
  fileUrl,
  resolveWorkspace,
  serializeWorkspace,
  releaseStoredFileUrl,
  type StoredFile,
} from './workspace-assets.ts';
import {
  managedFiles,
  cleanupCandidates,
  type FileMetadata,
  type StorageProtection,
  type StorageReport,
} from './storage-management.ts';
import { StorageAccess } from './storage-access.ts';
import type { ObsidianImportPlan, ObsidianImportCheckpoint } from './obsidian-import.ts';

type SavedWorkspace = {
  snapshot: WorkspaceSnapshot;
  revision: number;
  updatedAt: number;
};
export type SaveStatus = 'loading' | 'saving' | 'saved' | 'error';
const databaseName = 'lumior-local-v1';
let database: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('workspace');
      request.result.createObjectStore('files', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        database = undefined;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      database = undefined;
      reject(request.error || new Error(translate("Local storage is unavailable", "本地存储不可用。")));
    };
    request.onblocked = () => {
      database = undefined;
      reject(new Error(translate("Close other Lumior windows and try again.", "请关闭其他 Lumior 窗口后重试。")));
    };
  });
  return database;
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error || new Error(translate("Local save failed. Check the available storage space.", "本地保存失败，请检查可用空间。")));
  });
}
function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function readStoredFile(
  id: string,
): Promise<StoredFile | undefined> {
  const db = await openDatabase();
  return requestValue(
    db.transaction('files', 'readonly').objectStore('files').get(id),
  );
}
// Import checkpoints share the existing database without changing old snapshots.
export async function readObsidianImportStage() {
  const db = await openDatabase();
  const plan = await requestValue<(ObsidianImportPlan & { parentId?: string | null }) | undefined>(db.transaction('workspace').objectStore('workspace').get('obsidian-import-plan'));
  if (!plan) return undefined;
  const completed = await requestValue<ObsidianImportCheckpoint[]>(db.transaction('workspace').objectStore('workspace').getAll(IDBKeyRange.bound(['obsidian-import-entry', plan.libraryId, ''], ['obsidian-import-entry', plan.libraryId, []])));
  return { plan, completed, parentId: plan.parentId ?? null };
}
export async function writeObsidianImportPlan(plan: ObsidianImportPlan, parentId: string | null) {
  await clearObsidianImportStage();
  const db = await openDatabase(), tx = db.transaction('workspace', 'readwrite'), done = transactionDone(tx);
  tx.objectStore('workspace').put({ ...plan, parentId }, 'obsidian-import-plan');
  await done;
}
export async function writeObsidianImportCheckpoint(libraryId: string, entry: ObsidianImportCheckpoint) {
  const db = await openDatabase(), tx = db.transaction('workspace', 'readwrite'), done = transactionDone(tx);
  tx.objectStore('workspace').put(entry, ['obsidian-import-entry', libraryId, entry.path]);
  await done;
}
export async function clearObsidianImportStage() {
  const db = await openDatabase(), tx = db.transaction('workspace', 'readwrite'), done = transactionDone(tx), store = tx.objectStore('workspace');
  store.delete('obsidian-import-plan');
  store.delete(IDBKeyRange.bound(['obsidian-import-entry'], ['obsidian-import-entry', []]));
  await done;
}
export async function writeStoredFiles(files: StoredFile[]) {
  const db = await openDatabase(),
    transaction = db.transaction('files', 'readwrite'),
    done = transactionDone(transaction);
  for (const file of files)
    transaction
      .objectStore('files')
      .put({ ...file, createdAt: file.createdAt ?? Date.now() });
  await done;
}
export async function storeUploadedFile(
  file: File | Blob,
  name: string,
): Promise<string> {
  const record = {
    id: crypto.randomUUID(),
    name,
    type: file.type,
    size: file.size,
    blob: file,
  };
  await writeStoredFiles([record]);
  return fileUrl(record);
}

// Serialize saves, and detect another window's newer revision before writing.
export class LocalWorkspaceRepository {
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private access?: StorageAccess;
  private getAccess() {
    return (this.access ??= new StorageAccess(
      typeof navigator !== 'undefined' ? navigator.locks : undefined,
    ));
  }
  async releaseAccess() {
    await this.access?.release();
  }
  async load(): Promise<{
    snapshot: WorkspaceSnapshot | null;
    missingFiles: number;
  }> {
    await this.getAccess().hold();
    const db = await openDatabase();
    const record = await requestValue<SavedWorkspace | undefined>(
      db
        .transaction('workspace', 'readonly')
        .objectStore('workspace')
        .get('current'),
    );
    let snapshot: WorkspaceSnapshot | null;
    if (record) {
      snapshot = readWorkspace(JSON.stringify(record.snapshot));
      if (!snapshot) throw new Error(translate("Local whiteboard records could not be read. Restore from a backup.", "本地画板记录无法读取，请从备份恢复。"));
      this.revision = record.revision;
    } else {
      let legacy: string | null = null;
      try {
        legacy = localStorage.getItem(workspaceStorageKey);
      } catch {
        /* IndexedDB remains usable. */
      }
      snapshot = readWorkspace(legacy);
      if (legacy && !snapshot)
        throw new Error(translate("Older whiteboard records could not be read. The original records were retained.", "旧画板记录无法读取，已保留原记录。"));
    }
    if (!snapshot) return { snapshot: null, missingFiles: 0 };
    let missingFiles = 0;
    const deferred = new Set<string>();
    const visit = (value: unknown) => {
      if (!value || typeof value !== 'object') return;
      if ('storedDocument' in value && value.storedDocument && typeof value.storedDocument === 'object') {
        const ref = value.storedDocument as { source?: string; document?: string };
        if (ref.source) deferred.add(ref.source);
        if (ref.document) deferred.add(ref.document);
      }
      for (const entry of Object.values(value)) visit(entry);
    };
    visit(snapshot);
    for (const reference of fileReferences(snapshot)) {
      if (reference.startsWith('blob:')) {
        missingFiles++;
        continue;
      }
      if (deferred.has(reference)) {
        const key = await requestValue(db.transaction('files').objectStore('files').getKey(reference.slice(fileReferencePrefix.length)));
        if (key === undefined) missingFiles++;
        continue;
      }
      const file = await readStoredFile(
        reference.slice(fileReferencePrefix.length),
      );
      if (file) fileUrl(file);
      else missingFiles++;
    }
    if (!record) await this.save(snapshot); // Keep the old localStorage record as a migration backup.
    return { snapshot: resolveWorkspace(snapshot), missingFiles };
  }
  save(snapshot: WorkspaceSnapshot): Promise<void> {
    if (snapshot.files !== undefined && !validWorkspaceFiles(snapshot.files)) return Promise.reject(new Error(translate('File navigation records are invalid. The original records were retained.', '文件导航记录无效，已保留原记录。')));
    const serialized = serializeWorkspace(snapshot);
    const operation = this.queue
      .catch(() => {})
      .then(async () => {
        const db = await openDatabase(),
          transaction = db.transaction('workspace', 'readwrite'),
          store = transaction.objectStore('workspace');
        let conflict = false;
        const done = transactionDone(transaction),
          request = store.get('current');
        request.onsuccess = () => {
          const previous = request.result as SavedWorkspace | undefined;
          if ((previous?.revision || 0) !== this.revision) {
            conflict = true;
            transaction.abort();
            return;
          }
          store.put(
            {
              snapshot: serialized,
              revision: this.revision + 1,
              updatedAt: Date.now(),
            },
            'current',
          );
        };
        try {
          await done;
        } catch (error) {
          if (conflict)
            throw new Error(translate("Another window has saved newer changes. Back up your current work and reopen.", "另一个窗口已保存新的修改，请备份当前内容后重新打开。"));
          throw error;
        }
        this.revision++;
      });
    this.queue = operation;
    return operation;
  }
  async settle() {
    await this.queue;
  }
  async storageReport(protection: StorageProtection): Promise<StorageReport> {
    await this.settle();
    const db = await openDatabase();
    const records = await requestValue<StoredFile[]>(
      db.transaction('files', 'readonly').objectStore('files').getAll(),
    );
    const metadata: FileMetadata[] = records.map(
      ({ id, name, type, size, createdAt }) => ({
        id,
        name,
        type,
        size,
        createdAt,
      }),
    );
    const stage = await readObsidianImportStage();
    const files = managedFiles(metadata, { ...protection, history: [...protection.history, stage] }, Date.now());
    let estimate: StorageReport['estimate'] = null;
    try {
      if (navigator.storage?.estimate) {
        const result = await navigator.storage.estimate();
        estimate = { usage: result.usage, quota: result.quota };
      }
    } catch {
      /* Attachment totals remain exact even when browser estimates are unavailable. */
    }
    const unused = files.filter((file) => file.usage === 'unused');
    return {
      files,
      totalBytes: files.reduce((sum, file) => sum + file.size, 0),
      cleanableBytes: unused.reduce((sum, file) => sum + file.size, 0),
      cleanableCount: unused.length,
      estimate,
      cleanupSupported: !!navigator.locks,
    };
  }
  async cleanupFiles(
    requestedIds: string[],
    getProtection: () => StorageProtection,
  ): Promise<{ count: number; bytes: number; kept: number }> {
    const operation = this.queue.then(() =>
      this.getAccess().exclusive(async () => {
        const originalProtection = getProtection();
        const protection = { ...originalProtection, history: [...originalProtection.history, await readObsidianImportStage()] };
        if (
          fileReferences(serializeWorkspace(protection)).some((reference) =>
            reference.startsWith('blob:'),
          )
        )
          throw new Error(translate("Unrecognized temporary attachments remain. Reopen before cleaning up.", "存在尚未识别的临时附件地址，请重新打开后再清理。"));
        const db = await openDatabase(),
          transaction = db.transaction(['workspace', 'files'], 'readwrite'),
          done = transactionDone(transaction);
        const workspace = transaction.objectStore('workspace'),
          files = transaction.objectStore('files');
        let failure: Error | null = null;
        let removed: FileMetadata[] = [];
        const abort = (error: unknown) => {
          failure =
            error instanceof Error
              ? error
              : new Error(translate("Attachment references could not be checked. Refresh and try again.", "无法核对附件引用，请刷新后重试。"));
          transaction.abort();
        };
        const recordRequest = workspace.get('current');
        recordRequest.onsuccess = () => {
          try {
            const record = recordRequest.result as SavedWorkspace | undefined;
            const saved = record
              ? readWorkspace(JSON.stringify(record.snapshot))
              : null;
            if (!saved || record!.revision !== this.revision) {
              failure = new Error(translate("Saved records have changed. Reopen before cleaning up.", "保存记录已发生变化，请重新打开后再清理。"));
              transaction.abort();
              return;
            }
            const fileRequest = files.getAll();
            fileRequest.onsuccess = () => {
              try {
                const metadata = (fileRequest.result as StoredFile[]).map(
                  ({ id, name, type, size, createdAt }) => ({
                    id,
                    name,
                    type,
                    size,
                    createdAt,
                  }),
                );
                removed = cleanupCandidates(
                  managedFiles(metadata, protection, Date.now(), saved),
                  requestedIds,
                );
                removed.forEach((file) => files.delete(file.id));
              } catch (error) {
                abort(error);
              }
            };
          } catch (error) {
            abort(error);
          }
        };
        try {
          await done;
        } catch (error) {
          throw failure || error;
        }
        removed.forEach((file) => releaseStoredFileUrl(file.id));
        return {
          count: removed.length,
          bytes: removed.reduce((sum, file) => sum + file.size, 0),
          kept: new Set(requestedIds).size - removed.length,
        };
      }),
    );
    this.queue = operation;
    return operation;
  }
}
