import {remapContentLink} from './content-links.ts';
import { validDatabaseReference } from './canvas-database.ts';
import { restoreBoardThesis, remapThesisValue } from './thesis-board.ts';
import { translate } from './i18n-core.ts';
import JSZip from 'jszip';
import type { WorkspaceSnapshot } from './workspace-store.ts';
import { duplicateDatabase, databaseViews } from './database-model.ts';
import { readWorkspace } from './workspace-store.ts';
import { fileReferencePrefix, fileReferences, mapWorkspaceStrings, mediaReferences, serializeWorkspace, type StoredFile } from './workspace-assets.ts';
import { fileKeyRemapper, mapPortableFileKeys, readDesktopPortableBackup, type DesktopPortableBackup } from './desktop-portable-backup.ts';
import { validVideoProviderMetadata } from './video-url.ts';
import { ensureWorkspaceFiles, boardEntryId, contentEntryId, type WorkspaceFiles, type WorkspaceContent } from './workspace-files.ts';
import { mergeWorkspaceFileNavigation, remapWorkspaceFileNavigation } from './workspace-file-navigation.ts';
import { validStoredDocument, validObsidianSource } from './stored-document-schema.ts';

const maxBytes = 512 * 1024 * 1024, maxManifestBytes = 64 * 1024 * 1024;
type ManifestFile = { id: string; name: string; type: string; size: number; sha256: string; path: string };
type Manifest = { format: 'lumior-backup'; version: 1; createdAt: string; workspace: WorkspaceSnapshot; files: ManifestFile[]; portable?: DesktopPortableBackup };
export type PreparedBackup = { snapshot: WorkspaceSnapshot; files: StoredFile[]; createdAt: string; portable?: DesktopPortableBackup };
type BackupSource = { getFile: (id: string) => Promise<StoredFile | undefined>; fetch: (url: string) => Promise<Response> };
const hash = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2,'0')).join('');

export async function createWorkspaceBackup(snapshot: WorkspaceSnapshot, source: BackupSource, progress: (message: string) => void, portable?: DesktopPortableBackup): Promise<Blob> {
  if ([...snapshot.boards, ...snapshot.deletedBoards.map(entry => entry.board)].some(board => board.cards.some(card => card.kind === 'database' && !validDatabaseReference(card.databaseRef)))) throw new Error(translate('A database link is invalid. The backup was not created.', '多维表关联格式无效，尚未生成备份。'));
  const portableSnapshot = portable === undefined ? undefined : readDesktopPortableBackup(portable);
  const archive = new JSZip(), replacements = new Map<string,string>(), files: ManifestFile[] = [];
  const serialized = serializeWorkspace(snapshot);
  const references = [...new Set([...fileReferences(serialized), ...mediaReferences(serialized)])];
  let size = 0;
  for (let index = 0; index < references.length; index++) {
    const reference = references[index]; progress(translate("Collecting attachments {current} / {total}", "正在收集附件 {current} / {total}", { current: index + 1, total: references.length }));
    let record: StoredFile;
    if (reference.startsWith(fileReferencePrefix)) {
      const file = await source.getFile(reference.slice(fileReferencePrefix.length));
      if (!file) throw new Error(translate("Some attachments are missing. Reimport them before creating a full backup.", "有附件已丢失，请重新导入后再创建完整备份。")); record = file;
    } else {
      const response = await source.fetch(reference);
      if (!response.ok) throw new Error(translate("Some attachments could not be read. The full backup was not created.", "有附件暂时无法读取，完整备份尚未生成。"));
      const blob = await response.blob();
      record = { id: crypto.randomUUID(), name: reference.startsWith('blob:') ? 'Imported file' : decodeURIComponent(reference.split('/').pop() || 'Attachment'), type: blob.type, size: blob.size, blob };
    }
    size += record.size;
    if (size > maxBytes) throw new Error(translate("The full backup exceeds 512 MB. Use Back up to folder for this workspace.", "当前完整备份超过 512 MB，请使用“备份到文件夹”。"));
    const bytes = new Uint8Array(await record.blob.arrayBuffer()), path = `files/${record.id}`;
    archive.file(path, bytes, { compression: 'STORE' });
    files.push({ id: record.id, name: record.name, type: record.type, size: bytes.length, sha256: await hash(bytes), path });
    replacements.set(reference, fileReferencePrefix + record.id);
  }
  const workspace = remapBackupAttachments(serialized, replacements);
  const manifest: Manifest = { format: 'lumior-backup', version: 1, createdAt: new Date().toISOString(), workspace, files, ...(portableSnapshot ? { portable: mapPortableFileKeys(portableSnapshot, replacements) } : {}) };
  const json = JSON.stringify(manifest);
  if (new TextEncoder().encode(json).length > maxManifestBytes) throw new Error(translate("The whiteboard content is too large to create a full backup.", "画板内容过大，暂时无法创建完整备份。"));
  archive.file('manifest.json', json, { compression: 'DEFLATE' });
  progress(translate("Creating backup…", "正在生成备份文件…"));
  return archive.generateAsync({type:'blob', streamFiles:true}, ({percent}) => progress(translate("Creating backup {percent}%", "正在生成备份文件 {percent}%", { percent: Math.round(percent) })));
}

// Translation cache identities embed the source URL. Remap those metadata
// fields with the attachment itself, including inactive original-layout output.
export function remapBackupAttachments(snapshot: WorkspaceSnapshot, replacements: ReadonlyMap<string, string>): WorkspaceSnapshot {
  const fileKey = fileKeyRemapper(replacements);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'sourceKey' && typeof item === 'string' ? fileKey(item) : visit(item)]));
  };
  return visit(mapWorkspaceStrings(snapshot, text => replacements.get(text) || text)) as WorkspaceSnapshot;
}

// Bound decompressed output before allocating the final array.
async function boundedZipBytes(entry: JSZip.JSZipObject, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const stream = (entry as JSZip.JSZipObject & {internalStream(type:'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>}).internalStream('uint8array');
  return new Promise((resolve,reject) => {
    const chunks: Uint8Array[] = []; let length = 0, rejected = false;
    stream.on('data', chunk => { length += chunk.length; if (length > limit) { rejected=true; stream.pause(); reject(new Error(translate("Backup attachment size does not match its record. Reading was stopped.", "备份附件大小不符合记录，已停止读取。"))); } else chunks.push(chunk); });
    stream.on('error', reject);
    stream.on('end', () => { if (rejected) return; const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;} resolve(bytes); });
    stream.resume();
  });
}
export function validateBackupWorkspace(workspace: unknown): WorkspaceSnapshot {
  const snapshot = readWorkspace(JSON.stringify(workspace));
  if (!snapshot) throw new Error(translate("Whiteboard records in the backup are invalid.", "备份中的画板记录无效。"));
  const allBoards: WorkspaceSnapshot['boards']=[...snapshot.boards,...snapshot.deletedBoards.map(entry=>entry.board),...(snapshot.files?.recycledContents || []).flatMap(item=>[{id:item.content.id,title:'',edges:[],cards:[item.content.card,...(item.content.variants || []).map(variant=>variant.card)]},...item.references.map(ref=>({id:ref.boardId,title:'',cards:ref.cards,edges:ref.edges}))]),{id:'registry-validation',title:'',edges:[],cards:(snapshot.files?.contents || []).flatMap(content=>[content.card,...(content.variants || []).map(variant=>variant.card)])}];
  const strings=(values:unknown[])=>values.every(value=>typeof value==='string');
  if (allBoards.some(board => board.cards.some(card => (card.storedDocument !== undefined && !validStoredDocument(card.storedDocument)) || (card.obsidianSource !== undefined && !validObsidianSource(card.obsidianSource))))) throw new Error(translate('Stored note references in the backup are invalid.', '备份中的独立笔记引用无效。'));
  const geometry=(values:unknown[])=>values.every(value=>typeof value==='number'&&Number.isFinite(value));
  const validMark=(mark:unknown)=>{if(!mark||typeof mark!=='object')return false;const value=mark as {id:string;text:string;color:string;fragments:{page:number;rects:{x:number;y:number;width:number;height:number}[]}[]};return strings([value.id,value.text,value.color])&&Array.isArray(value.fragments)&&value.fragments.every(fragment=>Number.isInteger(fragment.page)&&fragment.page>0&&Array.isArray(fragment.rects)&&fragment.rects.every(rect=>rect&&geometry([rect.x,rect.y,rect.width,rect.height])));};
  if(allBoards.some(board=>board.cards.some(card=>!card||!strings([card.id,card.title,card.body])||!['note','text','pdf','video','image','database'].includes(card.kind)||card.kind==='database'&&!validDatabaseReference(card.databaseRef)||!geometry([card.x,card.y,card.width])||card.width<=0||card.height!==undefined&&!geometry([card.height])||card.kind==='pdf'&&(!card.pdf||!strings([card.pdf.url,card.pdf.name,card.pdf.thumbnail])||!geometry([card.pdf.size,card.pdf.pages]))||card.kind==='video'&&(!card.video||!strings([card.video.url,card.video.poster])||!geometry([card.video.duration])||!validVideoProviderMetadata(card.video))||card.pdfExcerpt&&!validMark(card.pdfExcerpt.mark))||board.edges.some(edge=>!edge||!strings([edge.id,edge.from,edge.to]))||board.sections!==undefined&&(!Array.isArray(board.sections)||board.sections.some(section=>!section||!strings([section.id,section.title,section.color])||!geometry([section.x,section.y,section.width,section.height]))))||snapshot.pdfMarks&&Object.values(snapshot.pdfMarks).some(marks=>!Array.isArray(marks)||!marks.every(validMark)))throw new Error(translate("Card or annotation data in the backup is invalid.", "备份中的卡片或批注格式无效。"));
  return snapshot;
}

export async function readWorkspaceBackup(file: Blob, progress: (message: string) => void): Promise<PreparedBackup> {
  if (file.size > maxBytes + maxManifestBytes) throw new Error(translate("The backup file is too large to restore.", "备份文件过大，暂时无法恢复。"));
  progress(translate("Checking backup…", "正在检查备份…"));
  const archive = await JSZip.loadAsync(await file.arrayBuffer());
  if (Object.keys(archive.files).length > 2005) throw new Error(translate("The backup contains too many files.", "备份文件数量过多。"));
  const manifestEntry = archive.file('manifest.json'); if (!manifestEntry) throw new Error(translate("This is not a full Lumior backup file.", "这不是 Lumior 的完整备份文件。"));
  const manifest = JSON.parse(new TextDecoder().decode(await boundedZipBytes(manifestEntry,maxManifestBytes))) as Manifest;
  if (manifest.format !== 'lumior-backup' || manifest.version !== 1 || !Array.isArray(manifest.files) || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error(translate("The backup version or format is not recognized.", "备份版本或格式无法识别。"));
  const portable = manifest.portable === undefined ? undefined : readDesktopPortableBackup(manifest.portable);
  const snapshot = validateBackupWorkspace(manifest.workspace);
  const ids = new Set<string>(); let size = 0;
  for (const entry of manifest.files) {
    if (!entry || !/^[a-f0-9-]{36}$/i.test(entry.id) || ids.has(entry.id) || entry.path !== `files/${entry.id}` || !Number.isSafeInteger(entry.size) || entry.size < 0 || typeof entry.type !== 'string' || typeof entry.name !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error(translate("Backup attachment records are invalid.", "备份附件记录无效。"));
    ids.add(entry.id); size += entry.size;
  }
  if (size > maxBytes) throw new Error(translate("Backup attachments exceed 512 MB in total.", "备份附件总量超过 512 MB。"));
  for (const reference of fileReferences(snapshot)) if (!reference.startsWith(fileReferencePrefix) || !ids.has(reference.slice(fileReferencePrefix.length))) throw new Error(translate("The backup is missing attachments referenced by whiteboards.", "备份缺少画板引用的附件。"));
  if (mediaReferences(snapshot).some(reference => !reference.startsWith(fileReferencePrefix))) throw new Error(translate("The backup still contains local attachments that were not packaged.", "备份仍包含未打包的本地附件。"));
  const files: StoredFile[] = [];
  for (let index=0;index<manifest.files.length;index++) {
    const entry = manifest.files[index]; progress(translate("Verifying attachments {current} / {total}", "正在验证附件 {current} / {total}", { current: index + 1, total: manifest.files.length }));
    const content = archive.file(entry.path); if (!content || content.unsafeOriginalName && content.unsafeOriginalName !== entry.path) throw new Error(translate("A backup attachment path is invalid.", "备份附件路径无效。"));
    const bytes = await boundedZipBytes(content,entry.size);
    if (bytes.length !== entry.size || await hash(bytes) !== entry.sha256) throw new Error(translate("Attachment verification failed. The backup may be incomplete.", "备份附件校验失败，文件可能不完整。"));
    files.push({id:entry.id,name:entry.name,type:entry.type,size:entry.size,blob:new Blob([bytes],{type:entry.type})});
  }
  return {snapshot,files,createdAt:manifest.createdAt,...(portable ? {portable} : {})};
}

// Merge restored boards with new identities. Existing work remains in place;
// shared references between restored boards are remapped together.
export function mergeRestoredWorkspace(current: WorkspaceSnapshot, backup: WorkspaceSnapshot, remap = new Map<string,string>()): WorkspaceSnapshot {
  current = ensureWorkspaceFiles(current); backup = ensureWorkspaceFiles(backup);
  const boards = [...backup.boards,...backup.deletedBoards.map(entry=>entry.board)];
  for (const board of boards) {
    if(!remap.has(board.id))remap.set(board.id,crypto.randomUUID());
    for (const card of board.cards) { if (!remap.has(card.id)) remap.set(card.id,crypto.randomUUID()); if (card.sharedId && !remap.has(card.sharedId)) remap.set(card.sharedId,crypto.randomUUID()); }
  }
  for (const content of [...backup.files!.contents, ...(backup.files!.recycledContents || []).map(item => item.content)]) {
    for (const id of [content.id,content.card.id,content.card.sharedId,...(content.variants || []).flatMap(variant=>[variant.cardId,variant.card.id,variant.card.sharedId])]) if (id && !remap.has(id)) remap.set(id,crypto.randomUUID());
  }
  for (const id of backup.files!.deletedContentIds || []) if (!remap.has(id)) remap.set(id,crypto.randomUUID());
  for (const item of backup.files!.recycledContents || []) {
    for (const id of [...item.tombstoneIds, ...(item.content.variants || []).map(variant => variant.boardId)]) if (!remap.has(id)) remap.set(id, crypto.randomUUID());
    for (const ref of item.references) {
      for (const id of [ref.boardId, ...ref.cards.flatMap(card => [card.id, card.sharedId]), ...ref.edges.flatMap(edge => [edge.from, edge.to])]) if (id && !remap.has(id)) remap.set(id, crypto.randomUUID());
    }
  }
  const edgeIds = new Map<string, string>();
  const restoreEdge = (edge: WorkspaceSnapshot['boards'][number]['edges'][number]) => {
    if (!edgeIds.has(edge.id)) edgeIds.set(edge.id, crypto.randomUUID());
    return { ...edge, id: edgeIds.get(edge.id)!, from: remap.get(edge.from) || edge.from, to: remap.get(edge.to) || edge.to };
  };
  // Restore database identities before cards, including references to absent tables.
  // Missing links get a fresh identity so they never attach to an unrelated live table.
  const databaseIds = new Map<string, string>(), viewIds = new Map<string, Map<string, string>>();
  const databases = (backup.databases || []).map(database => {
    const copy = duplicateDatabase(database, database.title + ' · Restored', database.createdAt);
    databaseIds.set(database.id, copy.id);
    const oldViews = databaseViews(database), newViews = databaseViews(copy);
    viewIds.set(database.id, new Map(oldViews.map((view, index) => [view.id, newViews[index].id])));
    return { ...copy, ...(database.pinnedAt !== undefined ? { pinnedAt: database.pinnedAt } : {}), updatedAt: database.updatedAt, records: copy.records.map((record, index) => ({ ...record, createdAt: database.records[index].createdAt, updatedAt: database.records[index].updatedAt })) };
  });
  const restoreDatabaseReference = (reference: NonNullable<WorkspaceSnapshot['boards'][number]['cards'][number]['databaseRef']>) => {
    if (!databaseIds.has(reference.databaseId)) databaseIds.set(reference.databaseId, crypto.randomUUID());
    let views = viewIds.get(reference.databaseId);
    if (!views) { views = new Map(); viewIds.set(reference.databaseId, views); }
    if (reference.viewId && !views.has(reference.viewId)) views.set(reference.viewId, crypto.randomUUID());
    return { databaseId: databaseIds.get(reference.databaseId)!, ...(reference.viewId ? { viewId: views.get(reference.viewId)! } : {}) };
  };
  // Restored copies must not resolve raw Obsidian links into an existing library.
  const libraryIds = new Map<string, string>();
  const restoredLibrary = (id: string) => { if (!libraryIds.has(id)) libraryIds.set(id, crypto.randomUUID()); return libraryIds.get(id)!; };
  const restoreCard = (card: WorkspaceSnapshot['boards'][number]['cards'][number]) => ({...card,...(card.obsidianSource ? {obsidianSource:{...card.obsidianSource,libraryId:restoredLibrary(card.obsidianSource.libraryId)}} : {}),...(card.storedDocument ? {storedDocument:{...card.storedDocument,libraryId:restoredLibrary(card.storedDocument.libraryId)}} : {}),body:remapThesisValue(card.body,remap),blocks:mapWorkspaceStrings(remapThesisValue(card.blocks,remap),text=>remapContentLink(text,remap)),...(card.kind==='database'&&card.databaseRef?{databaseRef:restoreDatabaseReference(card.databaseRef)}:{}),id:remap.get(card.id)!,sharedId:card.sharedId?remap.get(card.sharedId):undefined,sourceContentId:card.sourceContentId?remap.get(card.sourceContentId)||card.sourceContentId:undefined,pdfExcerpt:card.pdfExcerpt?{...card.pdfExcerpt,sourceId:remap.get(card.pdfExcerpt.sourceId)||card.pdfExcerpt.sourceId}:undefined});
  const restoreBoard = (board: WorkspaceSnapshot['boards'][number]) => {const thesis=restoreBoardThesis(board,remap);return {...board,...(thesis?{thesis}:{}),id:remap.get(board.id)!,title:board.title+' · Restored',cards:board.cards.map(card=>{const restored=restoreCard(card);return thesis?{...restored,body:remapThesisValue(restored.body,remap),blocks:remapThesisValue(restored.blocks,remap)}:restored;}),edges:board.edges.map(restoreEdge),sections:board.sections?.map(section=>({...section,id:crypto.randomUUID()}))};};
  const restoreContent = (content: WorkspaceContent): WorkspaceContent => ({ ...content, id: remap.get(content.id)!, card: restoreCard(content.card), sourceContentId: content.sourceContentId ? remap.get(content.sourceContentId) || content.sourceContentId : undefined, variants: content.variants?.map(variant => ({ ...variant, boardId: remap.get(variant.boardId) || variant.boardId, cardId: remap.get(variant.cardId)!, card: restoreCard(variant.card) })) });
  const folders = new Map(backup.files!.folders.map(folder=>[folder.id,crypto.randomUUID()]));
  const entryIds = new Map(backup.files!.entries.map(entry=>[entry.id,entry.kind==='board'?boardEntryId(remap.get(entry.boardId!)!):contentEntryId(remap.get(entry.contentId!)!)]));
  const files: WorkspaceFiles = {
    ...current.files!,
    ...((current.files!.deletedContentIds || backup.files!.deletedContentIds) ? {deletedContentIds:[...new Set([...(current.files!.deletedContentIds || []),...(backup.files!.deletedContentIds || []).map(id=>remap.get(id)!)])]} : {}),
    contents:[...current.files!.contents,...backup.files!.contents.map(restoreContent)],
    ...((current.files!.recycledContents || backup.files!.recycledContents) ? { recycledContents: [
      ...(current.files!.recycledContents || []), ...(backup.files!.recycledContents || []).map(item => ({
        ...item, content: restoreContent(item.content),
        entry: { ...item.entry, id: contentEntryId(remap.get(item.content.id)!), contentId: remap.get(item.content.id)!, folderId: item.entry.folderId ? folders.get(item.entry.folderId) ?? null : null },
        tombstoneIds: item.tombstoneIds.map(id => remap.get(id)!),
        references: item.references.map(ref => ({ boardId: remap.get(ref.boardId)!, cards: ref.cards.map(restoreCard), edges: ref.edges.map(restoreEdge) })),
      })),
    ] } : {}),
    folders:[...current.files!.folders,...backup.files!.folders.map(folder=>({...folder,id:folders.get(folder.id)!,parentId:folder.parentId?folders.get(folder.parentId)!:null}))],
    entries:[...current.files!.entries,...backup.files!.entries.map(entry=>({...entry,id:entryIds.get(entry.id)!,contentId:entry.contentId?remap.get(entry.contentId):undefined,boardId:entry.boardId?remap.get(entry.boardId):undefined,folderId:entry.folderId?folders.get(entry.folderId)!:null}))],
    ...((current.files!.navigation || backup.files!.navigation) ? { navigation: backup.files!.navigation
      ? mergeWorkspaceFileNavigation(current.files!.navigation, remapWorkspaceFileNavigation(backup.files!.navigation, folders, entryIds))
      : current.files!.navigation } : {}),
  };
  return {...current,files,boards:[...current.boards,...backup.boards.map(restoreBoard)],deletedBoards:[...current.deletedBoards,...backup.deletedBoards.map(entry=>({...entry,board:restoreBoard(entry.board)}))],activeId:remap.get(backup.activeId)||current.activeId,nextUntitledIndex:Math.max(current.nextUntitledIndex,backup.nextUntitledIndex),pdfMarks:{...current.pdfMarks,...backup.pdfMarks},...((current.databases || backup.databases) ? { databases: [...(current.databases || []), ...databases], activeDatabaseId: current.activeDatabaseId || databases[0]?.id } : {})};
}
