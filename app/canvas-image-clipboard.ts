import type { Card } from './canvas-model';

export function copyableCanvasImage(card: Card | undefined) {
  return card?.kind === 'image' && !!card.image && !card.pdfExcerpt;
}

async function clipboardPng(source: string): Promise<Blob> {
  const response = await fetch(source, { credentials: 'omit' });
  if (!response.ok) throw new Error('The image could not be read.');
  const blob = await response.blob();
  if (blob.size > 64 * 1024 * 1024) throw new Error('The image is too large for the clipboard.');
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    if (bitmap.width * bitmap.height > 64 * 1024 * 1024) throw new Error('The image is too large for the clipboard.');
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The image could not be copied.');
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('The image could not be copied.')), 'image/png'));
  } finally { bitmap.close(); }
}

export async function copyCanvasImage(source: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') throw new Error('Image clipboard is unavailable.');
  // Start the write during the click/keyboard action; decoding can complete later.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': clipboardPng(source) })]);
}
