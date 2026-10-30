import type { PartialBlock } from '@blocknote/core';
import type { Card } from './canvas-model';
import { documentText } from './card-document.ts';
import { fileReferences, fileReferencePrefix, fileUrl, resolveWorkspace, serializeWorkspace, type StoredFile } from './workspace-assets.ts';
import { translate } from './i18n-core.ts';

import { validStoredDocument } from './stored-document-schema.ts';
import type { StoredDocumentRef } from './stored-document-schema.ts';
export { validStoredDocument } from './stored-document-schema.ts';
export type { StoredDocumentRef } from './stored-document-schema.ts';
type Target = { id?: string; path: string; url?: string };
type DocumentBody = { version: 1; blocks: PartialBlock[]; body: string };
export type StoredDocumentDependencies = {
  getFile?: (id: string) => Promise<StoredFile | undefined>;
  putFile?: (file: StoredFile) => Promise<void>;
  parseMarkdown?: (markdown: string) => Promise<PartialBlock[]> | PartialBlock[];
  targets?: ReadonlyMap<string, Target>;
  signal?: AbortSignal;
  writer?: object;
  commit?: (patch: Partial<Card>) => void | Promise<void>;
};
const reference = (value: unknown): value is string => typeof value === 'string' && /^lumior-file:[a-zA-Z0-9_-]{1,128}$/.test(value);
const libraries = new Map<string, Map<string, Target>>();
const targetIndexes = new WeakMap<ReadonlyMap<string, Target>, ReadonlyMap<string, Target>>();
const revision = (card: Card) => serializeWorkspace(card.storedDocument?.document || card.storedDocument?.source || '');
const identity = (card: Card) => card.sharedId || card.id;
const latest = new Map<string, string>();
const writerLatest = new Map<string, { writer?: object; ref: StoredDocumentRef }>();
const writes = new Map<string, Promise<unknown>>();
const failures = new Map<string, Error>();
const drafts = new Map<string, { card: Card; patch: Partial<Card> }>();
type PendingSave = {
  card: Card; patch: Partial<Card>; dependencies: StoredDocumentDependencies;
  timer?: ReturnType<typeof setTimeout>;
  waiters: { resolve: (value: Partial<Card>) => void; reject: (error: unknown) => void }[];
};
const scheduled = new Map<string, PendingSave>();

/** The registry holds metadata only; no note body is read during startup. */
export function registerStoredDocumentCards(cards: readonly Card[]) {
  const next = new Map<string, Map<string, Target>>();
  for (const card of cards) {
    const source = card.obsidianSource || card.storedDocument;
    if (!source) continue;
    let targets = next.get(source.libraryId);
    if (!targets) { targets = new Map(); next.set(source.libraryId, targets); }
    const url = card.image || card.pdf?.url || card.video?.localUrl || card.video?.url || (card.blocks?.[0]?.props as { url?: string } | undefined)?.url;
    // Independent copies retain the source parsing context but no longer own
    // the vault path. Never let such copies redirect another note's links.
    if (card.obsidianSource && !targets.has(source.path)) targets.set(source.path, { path: source.path, id: identity(card), ...(url ? { url } : {}) });
    if (card.storedDocument && !writes.has(identity(card)) && !drafts.has(identity(card))) latest.set(identity(card), revision(card));
  }
  for (const id of libraries.keys()) if (!next.has(id)) libraries.delete(id);
  for (const [id, targets] of next) {
    const previous = libraries.get(id);
    if (previous?.size === targets.size && [...targets].every(([path, target]) => previous.get(path)?.id === target.id && previous.get(path)?.url === target.url)) continue;
    libraries.set(id, targets);
  }
}
const check = (signal?: AbortSignal) => signal?.throwIfAborted();
async function getFile(ref: string, dependencies: StoredDocumentDependencies) {
  const canonical = serializeWorkspace(ref);
  if (!reference(canonical)) throw new Error(translate('The note file reference is invalid.', '笔记文件引用无效。'));
  const read = dependencies.getFile || (await import('./local-repository.ts')).readStoredFile;
  check(dependencies.signal);
  const file = await read(canonical.slice(fileReferencePrefix.length));
  check(dependencies.signal);
  if (!file) throw new Error(translate('The note file is missing. Restore it from a backup.', '笔记文件缺失，请从备份恢复。'));
  return file;
}
async function parseMarkdown(markdown: string): Promise<PartialBlock[]> {
  const [{ BlockNoteEditor }, { documentSchema }] = await Promise.all([import('@blocknote/core'), import('./document-schema.ts')]);
  const editor = BlockNoteEditor.create({ schema: documentSchema });
  try { return editor.tryParseMarkdownToBlocks(markdown); }
  finally { editor.unmount(); }
}
function validBody(value: unknown): value is DocumentBody {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DocumentBody>;
  return item.version === 1 && typeof item.body === 'string' && Array.isArray(item.blocks)
    && item.blocks.every(block => block && typeof block === 'object' && typeof block.type === 'string');
}

/** Hydrates exactly one note. Callers must not persist this materialized card. */
export async function readStoredDocument(card: Card, dependencies: StoredDocumentDependencies = {}): Promise<Card> {
  if (!card.storedDocument) return card;
  if (!validStoredDocument(card.storedDocument)) throw new Error(translate('The note metadata is invalid.', '笔记元数据无效。'));
  check(dependencies.signal);
  const draft = drafts.get(identity(card));
  if (draft && revision(draft.card) === revision(card)) return { ...card, ...draft.patch };
  const stored = card.storedDocument;
  const file = await getFile(stored.document || stored.source, dependencies);
  const text = await file.blob.text();
  check(dependencies.signal);
  let body: DocumentBody;
  if (stored.document) {
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw new Error(translate('The saved note cannot be read. The original file was retained.', '保存的笔记无法读取，原始文件已保留。')); }
    if (!validBody(value)) throw new Error(translate('The saved note format is invalid. The original file was retained.', '保存的笔记格式无效，原始文件已保留。'));
    body = value;
  } else {
    const { convertObsidianMarkdown, createVaultTargetIndex } = await import('./obsidian-import.ts');
    const targets = dependencies.targets || libraries.get(stored.libraryId);
    if (!targets) throw new Error(translate('The note library is not ready. Please try again.', '笔记库尚未就绪，请重试。'));
    // The complete metadata index is available even when target bodies have
    // never been opened, so cross-folder links never depend on import order.
    let index = targetIndexes.get(targets);
    if (!index) { index = createVaultTargetIndex(targets); targetIndexes.set(targets, index); }
    const converted = convertObsidianMarkdown(text, stored.path, index, []);
    const blocks = await (dependencies.parseMarkdown || parseMarkdown)(converted);
    check(dependencies.signal);
    blocks.push({ type: 'file', props: { url: stored.source, name: `Obsidian · ${stored.path.split('/').at(-1)}` } });
    body = { version: 1, blocks, body: documentText(blocks) };
  }
  // Resolve only the attachments referenced by this note, not the whole vault.
  for (const ref of fileReferences(body)) {
    if (ref.startsWith(fileReferencePrefix)) fileUrl(await getFile(ref, dependencies));
  }
  check(dependencies.signal);
  const resolved = resolveWorkspace(body);
  return { ...card, blocks: resolved.blocks, body: resolved.body, storedDocument: stored };
}

/** Immutable blob first, metadata second. A failed write never replaces a ref. */
function writeStoredDocument(card: Card, patch: Partial<Card>, dependencies: StoredDocumentDependencies = {}): Promise<Partial<Card>> {
  const key = identity(card);
  if (!card.storedDocument || !validStoredDocument(card.storedDocument) || !Array.isArray(patch.blocks) || typeof patch.body !== 'string')
    return Promise.reject(new Error(translate('The note must finish loading before it can be saved.', '笔记加载完成后才能保存。')));
  const draft = { card, patch: structuredClone(patch) };
  drafts.set(key, draft);
  const operation = (writes.get(key) || Promise.resolve()).catch(() => {}).then(async () => {
    const expected = revision(card);
    const priorWriter = writerLatest.get(key);
    if (latest.has(key) && latest.get(key) !== expected && (!dependencies.writer || priorWriter?.writer !== dependencies.writer || priorWriter.ref.document !== latest.get(key))) throw new Error(translate('This note changed in another view. Reopen it before saving; your unsaved text is retained.', '此笔记已在另一视图修改，请重新打开后再保存；未保存的文字已保留。'));
    check(dependencies.signal);
    const document: DocumentBody = serializeWorkspace({ version: 1, blocks: draft.patch.blocks!, body: draft.patch.body! });
    const references = fileReferences(document);
    if (references.some(ref => !reference(ref))) throw new Error(translate('Some note attachments have not finished saving.', '笔记中有附件尚未保存完成。'));
    const blob = new Blob([JSON.stringify(document)], { type: 'application/vnd.lumior.document+json' });
    const id = crypto.randomUUID();
    const file = { id, name: `${card.storedDocument!.path}.lumior.json`, type: blob.type, size: blob.size, blob };
    const put = dependencies.putFile || (async (value: StoredFile) => (await import('./local-repository.ts')).writeStoredFiles([value]));
    await put(file);
    const ref = { ...serializeWorkspace(card.storedDocument!), document: fileReferencePrefix + id, references };
    const first = draft.patch.blocks?.[0];
    const title = first?.type === 'heading' ? documentText([first]).trim() : patch.title;
    const metadata = { storedDocument: ref, body: '', blocks: undefined, ...(title ? { title } : {}) };
    await dependencies.commit?.(metadata);
    latest.set(key, ref.document);
    writerLatest.set(key, { writer: dependencies.writer, ref });
    if (drafts.get(key) === draft) drafts.delete(key);
    failures.delete(key);
    return metadata;
  });
  writes.set(key, operation);
  void operation.then(() => { if (writes.get(key) === operation) writes.delete(key); }, error => {
    failures.set(key, error instanceof Error ? error : new Error('Note save failed.'));
    if (writes.get(key) === operation) writes.delete(key);
  });
  return operation;
}

function startScheduled(key: string, pending: PendingSave) {
  if (scheduled.get(key) !== pending) return;
  clearTimeout(pending.timer);
  scheduled.delete(key);
  void writeStoredDocument(pending.card, pending.patch, pending.dependencies).then(
    value => pending.waiters.forEach(waiter => waiter.resolve(value)),
    error => pending.waiters.forEach(waiter => waiter.reject(error)),
  );
}

/** Coalesce typing from one editor; explicit flush commits the latest draft now.
 * Different editors never share a batch or silently replace each other's text.
 */
export function saveStoredDocument(card: Card, patch: Partial<Card>, dependencies: StoredDocumentDependencies = {}): Promise<Partial<Card>> {
  if (!dependencies.writer) return writeStoredDocument(card, patch, dependencies);
  const key = identity(card);
  let pending = scheduled.get(key);
  if (pending && pending.dependencies.writer !== dependencies.writer) { startScheduled(key, pending); pending = undefined; }
  if (!pending) { pending = { card, patch, dependencies, waiters: [] }; scheduled.set(key, pending); }
  pending.card = card;
  pending.patch = structuredClone(patch);
  pending.dependencies = dependencies;
  drafts.set(key, { card, patch: pending.patch });
  clearTimeout(pending.timer);
  const batch = pending;
  batch.timer = setTimeout(() => startScheduled(key, batch), 300);
  return new Promise((resolve, reject) => batch.waiters.push({ resolve, reject }));
}

/** Used by close/save/backup gates; a failed edit must not be called saved. */
export async function flushStoredDocuments() {
  while (scheduled.size || writes.size) {
    for (const [key, batch] of scheduled) startScheduled(key, batch);
    await Promise.all(writes.values());
  }
  if (failures.size) throw failures.values().next().value!;
}

export function storedDocumentError(card: Card): Error | undefined { return failures.get(identity(card)); }
