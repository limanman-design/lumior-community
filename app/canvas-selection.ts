import type { Board, Card, Point } from './canvas-model';

export type SelectionBounds = Point & { width: number; height: number };
export type CardAlignment = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';
export type CardHeights = Readonly<Record<string, number>>;
export type DuplicateSelectionOptions = {
  idFactory?: () => string;
  now?: () => string;
  offset?: Point;
};

export const selectionGridGap = 32;

function selectedCards(cards: readonly Card[], ids: readonly string[]) {
  const selected = new Set(ids);
  return cards.filter(card => selected.has(card.id));
}

function positive(value: number | undefined, fallback: number) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

// Match the canvas: measured content height takes precedence over a saved size.
function cardHeight(card: Card, sizes: CardHeights) {
  return positive(sizes[card.id], positive(card.height, 300));
}

export function selectionBounds(
  cards: readonly Card[],
  ids: readonly string[],
  sizes: CardHeights = {},
): SelectionBounds | null {
  const selected = selectedCards(cards, ids);
  if (!selected.length) return null;
  const x = Math.min(...selected.map(card => card.x));
  const y = Math.min(...selected.map(card => card.y));
  const right = Math.max(...selected.map(card => card.x + card.width));
  const bottom = Math.max(...selected.map(card => card.y + cardHeight(card, sizes)));
  return { x, y, width: right - x, height: bottom - y };
}

function moveCards(board: Board, positions: ReadonlyMap<string, Point>): Board {
  let changed = false;
  const cards = board.cards.map(card => {
    const point = positions.get(card.id);
    if (!point || (point.x === card.x && point.y === card.y)) return card;
    changed = true;
    return { ...card, ...point };
  });
  return changed ? { ...board, cards } : board;
}

export function alignSelectedCards(
  board: Board,
  ids: readonly string[],
  alignment: CardAlignment,
  sizes: CardHeights = {},
): Board {
  const selected = selectedCards(board.cards, ids);
  if (selected.length < 2) return board;
  const bounds = selectionBounds(selected, ids, sizes)!;
  const positions = new Map<string, Point>();
  for (const card of selected) {
    const point = { x: card.x, y: card.y };
    if (alignment === 'left') point.x = bounds.x;
    if (alignment === 'hcenter') point.x = bounds.x + (bounds.width - card.width) / 2;
    if (alignment === 'right') point.x = bounds.x + bounds.width - card.width;
    if (alignment === 'top') point.y = bounds.y;
    if (alignment === 'vcenter') point.y = bounds.y + (bounds.height - cardHeight(card, sizes)) / 2;
    if (alignment === 'bottom') point.y = bounds.y + bounds.height - cardHeight(card, sizes);
    positions.set(card.id, point);
  }
  return moveCards(board, positions);
}

export function gridSelectedCards(
  board: Board,
  ids: readonly string[],
  sizes: CardHeights = {},
  columns?: number,
): Board {
  const selected = selectedCards(board.cards, ids);
  if (selected.length < 2) return board;
  const bounds = selectionBounds(selected, ids, sizes)!;
  const count = columns !== undefined && Number.isFinite(columns)
    ? Math.max(1, Math.min(selected.length, Math.floor(columns)))
    : Math.ceil(Math.sqrt(selected.length));
  // Sorting this new array preserves source order and ties preserve paint order.
  selected.sort((a, b) => a.y - b.y || a.x - b.x);
  const widths = Array<number>(count).fill(0);
  const heights = Array<number>(Math.ceil(selected.length / count)).fill(0);
  selected.forEach((card, index) => {
    const column = index % count, row = Math.floor(index / count);
    widths[column] = Math.max(widths[column], card.width);
    heights[row] = Math.max(heights[row], cardHeight(card, sizes));
  });
  const x = [bounds.x], y = [bounds.y];
  widths.slice(0, -1).forEach(width => x.push(x[x.length - 1] + width + selectionGridGap));
  heights.slice(0, -1).forEach(height => y.push(y[y.length - 1] + height + selectionGridGap));
  return moveCards(board, new Map(selected.map((card, index) => [card.id, {
    x: x[index % count],
    y: y[Math.floor(index / count)],
  }])));
}

export function duplicateSelectedCards(
  board: Board,
  ids: readonly string[],
  sizes: CardHeights = {},
  options: DuplicateSelectionOptions = {},
): { board: Board; newIds: string[] } {
  const selected = selectedCards(board.cards, ids);
  // Single-card duplication retains the existing per-card action and placement.
  if (selected.length < 2) return { board, newIds: [] };
  const bounds = selectionBounds(selected, ids, sizes)!;
  const offset = options.offset || { x: bounds.width + 80, y: 20 };
  const createdAt = (options.now || (() => new Date().toISOString()))();
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const used = new Set([...board.cards.map(card => card.id), ...board.edges.map(edge => edge.id)]);
  const newId = () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = idFactory();
      if (typeof value === 'string' && value.trim() && !used.has(value)) {
        used.add(value);
        return value;
      }
    }
    throw new Error('Could not allocate a unique ID for the copied selection.');
  };
  const mapped = new Map(selected.map(card => [card.id, newId()]));
  const copied = selected.map(card => {
    const next: Card = {
      ...structuredClone(card),
      id: mapped.get(card.id)!,
      x: card.x + offset.x,
      y: card.y + offset.y,
      title: `${card.title} — Copy`,
      createdAt,
      creationDateSource: 'actual',
    };
    delete next.sharedId;
    delete next.obsidianSource;
    if (next.pdfExcerpt) {
      delete next.pdfExcerpt.readingNote;
      next.pdfExcerpt.independent = true;
    }
    // Excerpts copied with their PDF should reference that independent PDF copy.
    if (card.pdfExcerpt && mapped.has(card.pdfExcerpt.sourceId)) {
      next.pdfExcerpt = { ...next.pdfExcerpt!, sourceId: mapped.get(card.pdfExcerpt.sourceId)! };
    }
    return next;
  });
  const edges = board.edges
    .filter(edge => mapped.has(edge.from) && mapped.has(edge.to))
    .map(edge => ({ ...edge, id: newId(), from: mapped.get(edge.from)!, to: mapped.get(edge.to)! }));
  return {
    board: { ...board, cards: [...board.cards, ...copied], edges: [...board.edges, ...edges] },
    newIds: copied.map(card => card.id),
  };
}
