import type { WorkspaceFiles } from './workspace-files';
import { addWorkspaceContent } from './workspace-files.ts';
import { fileUrl, type StoredFile } from './workspace-assets.ts';
import type { PartialBlock } from '@blocknote/core';
import { translate } from './i18n-core.ts';

export type DesktopQuickNote = { id: string; title: string; body: string; images?: { id: string; name: string; type: string; size: number; bytes: Uint8Array; url?: string }[] };
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
function validate(request: DesktopQuickNote) {
  if (!request || !uuid.test(request.id)
    || typeof request.title !== 'string' || request.title.length > 200 || typeof request.body !== 'string' || request.body.length > 100000
    || (!request.title.trim() && !request.body.trim() && !request.images?.length)) throw new Error('Invalid quick note.');
  if (request.images !== undefined && (!Array.isArray(request.images) || request.images.length > 10
    || request.images.some(i => !i || !uuid.test(i.id) || typeof i.name !== 'string' || i.name.length > 200
      || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(i.type)
      || !(i.bytes instanceof Uint8Array) || i.size !== i.bytes.length || i.size <= 0 || i.size > 10 * 1024 * 1024)
    || new Set(request.images.map(i => i.id)).size !== request.images.length
    || request.images.reduce((sum, i) => sum + i.size, 0) > 30 * 1024 * 1024)) throw new Error('Invalid quick note images.');
}
export async function prepareDesktopQuickNote(request: DesktopQuickNote, write: (files: StoredFile[]) => Promise<void>): Promise<DesktopQuickNote> {
  validate(request);
  if (!request.images?.length) return request;
  const records = request.images.map(i => ({ id: `pet-${request.id}-${i.id}`, name: i.name, type: i.type, size: i.size, blob: new Blob([new Uint8Array(i.bytes)], { type: i.type }) }));
  await write(records);
  return { ...request, images: request.images.map((i, index) => ({ ...i, url: fileUrl(records[index]) })) };
}

// The draft UUID is also the content UUID: retrying a lost acknowledgement must
// never create a second note or overwrite an already edited/deleted note.
export function addDesktopQuickNote(files: WorkspaceFiles, request: DesktopQuickNote, now = Date.now()): WorkspaceFiles {
  validate(request);
  const id = `pet-${request.id}`;
  if (files.contents.some(content => content.id === id) || files.deletedContentIds?.includes(id)
    || files.recycledContents?.some(entry => entry.content.id === id)) return files;
  const title = request.title.trim() || request.body.trim().split(/\r?\n/)[0].slice(0, 80) || translate('Image quick note', '图片速记');
  let blocks: PartialBlock[] | undefined;
  if (request.images?.length) {
    blocks = request.body ? request.body.split('\n\n').map(content => ({ type: 'paragraph', content })) : [];
    for (const image of request.images) {
      if (!image.url?.startsWith('blob:')) throw new Error('Quick note images must be stored first.');
      blocks.push({ type: 'image', props: { url: image.url, name: image.name, showPreview: true } });
    }
  }
  const timestamp = new Date(now).toISOString();
  return addWorkspaceContent(files, {
    id, kind: 'note', contentRole: 'notePage', title, body: request.body, ...(blocks ? { blocks } : {}),
    width: 360, x: 0, y: 0, createdAt: timestamp, updatedAt: timestamp, creationDateSource: 'actual',
  }, null, 'notePage', now);
}
