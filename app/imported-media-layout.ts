import type { Card, Point } from './canvas-model';
import type { ImportedCard } from './file-import';
import { defaultVideoWidth, videoCardHeight } from './card-sizing.ts';

export const importedImageWidth = 428;
export const importedPdfWidth = 360;
export const importedMediaGap = 32;
// Filename labels sit above the card rather than inside its measured body.
const headingHeight = 24;

export type ImportedMediaLayoutOptions = {
  availableWidth?: number;
  measuredHeights?: Record<string, number>;
  now?: string;
};

const positive = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

// Image/PDF previews have no padding; their natural ratio fills the width
// between the card's two one-pixel borders. Store the rounded outer height.
export function importedPreviewHeight(naturalWidth: number, naturalHeight: number, width: number) {
  if (!positive(naturalWidth) || !positive(naturalHeight) || !positive(width) || width <= 2) {
    throw new Error('The preview dimensions are invalid.');
  }
  return Math.ceil((width - 2) * naturalHeight / naturalWidth + 2);
}

export function importedMediaSize(imported: ImportedCard) {
  const width = imported.kind === 'video' ? defaultVideoWidth
    : imported.kind === 'pdf' ? importedPdfWidth : importedImageWidth;
  const height = imported.kind === 'video' ? videoCardHeight(width)
    : positive(imported.height) ? imported.height!
    : imported.kind === 'pdf' ? Math.ceil((width - 2) * Math.SQRT2 + 2)
    : imported.kind === 'image' ? 524 : imported.kind === 'text' ? 100 : 440;
  return { width, height };
}

type Rectangle = Point & { width: number; height: number };
const labelHeight = (kind: Card['kind']) => kind === 'text' ? 0 : headingHeight;
const intersects = (first: Rectangle, second: Rectangle) =>
  first.x < second.x + second.width && first.x + first.width > second.x
  && first.y < second.y + second.height && first.y + first.height > second.y;

export function occupiedRectangle(card: Card, measuredHeights?: Record<string, number>): Rectangle | null {
  // Old/imported board data can be incomplete. Such cards have no canvas box.
  if (![card.x, card.y, card.width].every(Number.isFinite) || card.width <= 0) return null;
  const measured = measuredHeights?.[card.id];
  const height = positive(measured) ? measured!
    : positive(card.height) ? card.height!
    : card.kind === 'video' ? videoCardHeight(card.width)
    : card.kind === 'pdf' ? Math.ceil((card.width - 2) * Math.SQRT2 + 2)
    : card.kind === 'image' ? 524 : card.kind === 'text' ? 100 : 300;
  const label = labelHeight(card.kind);
  return { x: card.x, y: card.y - label, width: card.width, height: height + label };
}

/** Reserve an exact transient rectangle without changing any existing card. */
export function findOpenCanvasPosition(rectangle: Rectangle, existing: Card[], measuredHeights?: Record<string, number>): Point {
  const occupied = existing.map(card => occupiedRectangle(card, measuredHeights)).filter((item): item is Rectangle => item !== null);
  let y = rectangle.y;
  // Every move crosses an obstacle's bottom; at most one pass per obstacle.
  for (let pass = 0; pass <= occupied.length; pass++) {
    let next = y;
    for (const obstacle of occupied) {
      if (intersects({ ...rectangle, y }, {
        x: obstacle.x - importedMediaGap, y: obstacle.y - importedMediaGap,
        width: obstacle.width + importedMediaGap * 2, height: obstacle.height + importedMediaGap * 2,
      })) next = Math.max(next, obstacle.y + obstacle.height + importedMediaGap);
    }
    if (next === y) break;
    y = next;
  }
  return { x: rectangle.x, y };
}

// Lay out each completed import batch as rows of at most three cards. Every
// row reserves its tallest preview so portrait images never cover the next row.
// The whole batch moves down when necessary, keeping its rows intact and the
// original cards exactly where the user placed them.
export function layoutImportedMedia(
  imports: ImportedCard[], point: Point, existing: Card[], options: ImportedMediaLayoutOptions = {},
) {
  const availableWidth = positive(options.availableWidth) ? options.availableWidth! : Infinity;
  const rows: { items: { index: number; width: number; height: number; label: number }[]; width: number; height: number }[] = [];
  imports.forEach((imported, index) => {
    const size = importedMediaSize(imported), label = labelHeight(imported.kind);
    const current = rows.at(-1);
    const nextWidth = current ? current.width + importedMediaGap + size.width : size.width;
    if (!current || current.items.length === 3 || nextWidth > availableWidth) {
      rows.push({ items: [{ index, ...size, label }], width: size.width, height: size.height + label });
    } else {
      current.items.push({ index, ...size, label });
      current.width = nextWidth;
      current.height = Math.max(current.height, size.height + label);
    }
  });
  const width = Math.max(0, ...rows.map(row => row.width));
  const positions: (Point & { width: number; height: number })[] = [];
  let top = point.y - 160 - headingHeight;
  for (const row of rows) {
    let x = point.x - width / 2;
    for (const item of row.items) {
      positions[item.index] = { x, y: top + item.label, width: item.width, height: item.height };
      x += item.width + importedMediaGap;
    }
    top += row.height + importedMediaGap;
  }
  const occupied = existing.map(card => occupiedRectangle(card, options.measuredHeights))
    .filter((rectangle): rectangle is Rectangle => rectangle !== null);
  let shift = 0;
  // Each pass moves one row past a finite obstacle bottom. Existing cards
  // cannot be disturbed, including newer edits made while files were decoding.
  for (let pass = 0; pass <= occupied.length * positions.length; pass++) {
    let nextShift = shift;
    positions.forEach((position, index) => {
      const label = labelHeight(imports[index].kind);
      const footprint = { ...position, y: position.y - label + shift, height: position.height + label };
      for (const obstacle of occupied) {
        if (intersects(footprint, {
          x: obstacle.x - importedMediaGap, y: obstacle.y - importedMediaGap,
          width: obstacle.width + importedMediaGap * 2, height: obstacle.height + importedMediaGap * 2,
        })) {
          nextShift = Math.max(nextShift, obstacle.y + obstacle.height + importedMediaGap - (position.y - label));
        }
      }
    });
    if (nextShift === shift) break;
    shift = nextShift;
  }
  return positions.map(position => ({ ...position, y: position.y + shift }));
}
