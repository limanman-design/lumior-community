import { homeFileDragType } from './home-file-tree-model.ts';

type FileTransfer = Pick<DataTransfer, 'types' | 'items' | 'files'>;

/** Native file drags expose their types before the files can be read at drop. */
export function isHomeFileDrop(transfer: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(transfer.types).includes('Files')
    && !Array.from(transfer.types).includes(homeFileDragType);
}

/** Read synchronously during drop; directories are not empty files to import. */
export function readHomeFileDrop(transfer: FileTransfer) {
  const files: File[] = [];
  let directories = 0;
  if (!isHomeFileDrop(transfer)) return { files, directories };
  const items = Array.from(transfer.items).filter(item => item.kind === 'file');
  if (!items.length) return { files: Array.from(transfer.files), directories };
  for (const item of items) {
    let entry: FileSystemEntry | null = null;
    try { entry = item.webkitGetAsEntry?.() || null; } catch { /* Fall back to the File API. */ }
    if (entry?.isDirectory) {
      directories++;
      continue;
    }
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return { files, directories };
}
