import type { Board, Point } from './canvas-model';
import type { ImportedCard } from './file-import';
import { appendImportedMediaBatch, type ImportedMediaLayoutOptions } from './media-card-creation.ts';

const imageExtensions = /\.(png|jpe?g|webp|gif)$/i;
const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export function isImageFile(file: Pick<File, 'name' | 'type'>) {
  return file.type.startsWith('image/') || imageExtensions.test(file.name);
}

// Clipboard images may have no usable filename. Keep original filenames on drops.
export function namedImage(file: File) {
  const extension = extensions[file.type.toLowerCase()];
  if (!extension || imageExtensions.test(file.name)) return file;
  return new File(
    [file],
    `${file.name.replace(/\.[^.]+$/, '') || 'Pasted image'}.${extension}`,
    { type: file.type, lastModified: file.lastModified },
  );
}

export function clipboardImages(
  data: Pick<DataTransfer, 'files' | 'items' | 'getData'>,
): File[] {
  const files = Array.from(data.files).filter(isImageFile);
  // Files and items normally describe the same data; do not import both copies.
  if (files.length) return files.map(namedImage);
  const items = Array.from(data.items).filter(
    (item) => item.kind === 'file' && item.type.startsWith('image/'),
  );
  const images = items
    .map((item) => item.getAsFile())
    .filter((file): file is File => !!file);
  if (images.length) return images.map(namedImage);
  // Some applications copy an embedded image rather than a File. Never fetch
  // external HTML image URLs: they can require cookies or be blocked by CORS.
  const html = data.getData('text/html');
  if (
    !html ||
    html.length > 35 * 1024 * 1024 ||
    typeof DOMParser === 'undefined'
  )
    return [];
  const document = new DOMParser().parseFromString(html, 'text/html');
  const source = document.querySelector('img')?.getAttribute('src') || '';
  const match =
    /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z\d+/=\s]+)$/i.exec(
      source,
    );
  if (!match) return [];
  try {
    const bytes = Uint8Array.from(atob(match[2]), (character) =>
      character.charCodeAt(0),
    );
    const type = match[1].toLowerCase();
    return [new File([bytes], `Pasted image.${extensions[type]}`, { type })];
  } catch {
    return [];
  }
}

export async function importImageBatch(
  files: File[],
  importer: (file: File) => Promise<ImportedCard>,
) {
  const images: ImportedCard[] = [],
    errors: string[] = [];
  for (const file of files) {
    try {
      images.push(await importer(namedImage(file)));
    } catch (error) {
      errors.push(
        `${file.name || 'Image'}: ${error instanceof Error ? error.message : 'Could not save this image.'}`,
      );
    }
  }
  return { images, errors };
}

export function appendImportedImages(
  boards: Board[],
  targetId: string,
  images: ImportedCard[],
  point: Point,
  makeId: () => string,
  options: ImportedMediaLayoutOptions = {},
) {
  return appendImportedMediaBatch(boards, targetId, images, point, makeId, options);
}
