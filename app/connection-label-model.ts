import type { Board, Card, Point } from './canvas-model';

export const CONNECTION_LABEL_MAX_LENGTH = 120;

export function normalizeConnectionLabel(value: string) {
  return Array.from(value.replace(/\s+/g, ' ').trim()).slice(0, CONNECTION_LABEL_MAX_LENGTH).join('');
}

export function updateConnectionLabel(board: Board, edgeId: string, value: string): Board {
  const label = normalizeConnectionLabel(value);
  const edge = board.edges.find(item => item.id === edgeId);
  if (!edge || (edge.label || '') === label) return board;
  return { ...board, edges: board.edges.map(item => {
    if (item.id !== edgeId) return item;
    const next = { ...item };
    if (label) next.label = label;
    else delete next.label;
    return next;
  }) };
}

// The line, its arrival animation and its label share the same measured geometry.
export function connectionGeometry(from: Card, to: Card | Point, sizes: Record<string, number> = {}) {
  const targetIsCard = 'width' in to;
  const end = {
    x: targetIsCard ? to.x + (to.x < from.x ? to.width : 0) : to.x,
    y: targetIsCard ? to.y + (sizes[to.id] || to.height || 300) / 2 : to.y,
  };
  const start = {
    x: from.x + (end.x >= from.x + from.width / 2 ? from.width : 0),
    y: from.y + (sizes[from.id] || from.height || 300) / 2,
  };
  const bend = Math.max(80, Math.abs(end.x - start.x) * .45);
  const direction = end.x >= start.x ? 1 : -1;
  const first = { x: start.x + bend * direction, y: start.y };
  const second = { x: end.x - bend * direction, y: end.y };
  const midpoint = { x: (start.x + 3 * first.x + 3 * second.x + end.x) / 8, y: (start.y + 3 * first.y + 3 * second.y + end.y) / 8 };
  return { start, end, midpoint, path: `M ${start.x} ${start.y} C ${first.x} ${first.y}, ${second.x} ${second.y}, ${end.x} ${end.y}` };
}

export type ConnectionLabelDraft = { value: string; active: boolean };
export const createConnectionLabelDraft = (value: string): ConnectionLabelDraft => ({ value, active: true });

// Enter followed by the input's blur must create only one undo entry.
export function finishConnectionLabelDraft(draft: ConnectionLabelDraft, save: boolean): string | null {
  if (!draft.active) return null;
  draft.active = false;
  return save ? normalizeConnectionLabel(draft.value) : null;
}

export function connectionLabelKeyAction(key: string, composing: boolean, keyCode?: number) {
  if (composing || keyCode === 229) return null;
  return key === 'Enter' ? 'save' : key === 'Escape' ? 'cancel' : null;
}
