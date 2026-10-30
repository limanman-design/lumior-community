'use client';
import type { ThesisProject } from '@/lib/thesis/model';

let database: Promise<IDBDatabase> | undefined;
function openDatabase() {
  if (!database)
    database = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('lumior-thesis-v1', 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('projects', { keyPath: 'id' });
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          database = undefined;
        };
        resolve(db);
      };
      request.onerror = request.onblocked = () => {
        database = undefined;
        reject(new Error('论文项目暂时无法读取，请关闭其他旧版本窗口后重试。'));
      };
    });
  return database;
}
export async function listThesisProjects(): Promise<ThesisProject[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('projects').objectStore('projects').getAll();
    request.onsuccess = () =>
      resolve(
        (request.result as ThesisProject[]).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        ),
      );
    request.onerror = () =>
      reject(new Error('论文项目读取失败，未覆盖已有内容。'));
  });
}
/** Compare-and-swap includes files, automatic backups and conversation in one transaction. */
export async function saveThesisProject(
  project: ThesisProject,
  expectedRevision: number | null,
): Promise<ThesisProject> {
  const db = await openDatabase(),
    next = {
      ...project,
      revision: (expectedRevision ?? -1) + 1,
      updatedAt: Date.now(),
    };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('projects', 'readwrite'),
      store = transaction.objectStore('projects');
    let conflict = false;
    const request = store.get(project.id);
    request.onsuccess = () => {
      const old = request.result as ThesisProject | undefined;
      if (
        (expectedRevision === null && old) ||
        (expectedRevision !== null && old?.revision !== expectedRevision)
      ) {
        conflict = true;
        transaction.abort();
        return;
      }
      store.put(next);
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = transaction.onabort = () =>
      reject(
        new Error(
          conflict
            ? '项目已在另一窗口更新。请重新打开项目后继续，当前改动尚未保存。'
            : '论文项目保存失败，当前改动尚未写入。请保留窗口并重试。',
        ),
      );
  });
}
