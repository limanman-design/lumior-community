import type { Card } from './canvas-model';

export function aiAttachmentThumbnail(card: Card | undefined, kind: Card['kind'], excerpt = false): string | undefined {
  if (!card || card.kind !== kind) return undefined;
  if (kind === 'pdf') return card.pdf?.thumbnail || undefined;
  if (kind === 'image') return card.image || undefined;
  if (kind === 'video') return card.video?.poster || undefined;
  if (excerpt) return card.pdfExcerpt?.pdf.thumbnail || card.pdfExcerpt?.mark.image || undefined;
  return undefined;
}
