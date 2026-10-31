import { proposeNoteChange } from './note-ai-change.ts';
import type { Board, Card, Edge, Point } from './canvas-model';
import { layoutImportedMedia } from './imported-media-layout.ts';
import { aiLayoutTargets, readAiBoardActions, type AiBoardActions } from '../lib/ai-board-tools.ts';
import { aiSectionId, applyAiBoardLayout, assertAiLayoutSnapshot, type AiLayoutSnapshot } from './ai-board-layout.ts';

export type AiBoardActionOptions = {
  point?: Point;
  measuredHeights?: Record<string, number>;
  appliedActionIds?: ReadonlySet<string>;
  layoutSnapshot?: AiLayoutSnapshot;
};

export type AiBoardActionResult = {
  board: Board;
  actionId: string;
  cardIds: string[];
  edgeIds: string[];
  createdCards: number;
  createdConnections: number;
  createdSections: number;
  movedCards: number;
  updatedSections: number;
  sectionIds: string[];
  suggestedUpdates: number;
  alreadyApplied: boolean;
};

const noteId = (actionId: string, localId: string) => `ai-note:${actionId}:${localId}`;
const edgeId = (actionId: string, index: number) => `ai-edge:${actionId}:${index}`;
const pairKey = (from: string, to: string) => JSON.stringify([from, to].sort());
const sameEdge = (edge: Edge, other: Edge) => pairKey(edge.from, edge.to) === pairKey(other.from, other.to)
  && (edge.label || '') === (other.label || '');

// Validate the complete batch before making a candidate board. The caller can
// commit this one immutable value once, so undo removes the whole operation.
export function applyAiBoardActions(
  board: Board,
  value: AiBoardActions,
  options: AiBoardActionOptions = {},
): AiBoardActionResult {
  const batch = readAiBoardActions(value);
  if (batch.boardId !== board.id) throw new Error('本次 AI 操作属于其他画板，未作修改。');
  const cardIds = batch.notes.map(note => noteId(batch.id, note.id));
  const plannedEdgeIds = batch.connections.map((_, index) => edgeId(batch.id, index));
  const plannedSectionIds = (batch.groups || []).map(group => aiSectionId(batch.id, group.id));
  // The next agent request must be able to read these persistent identifiers.
  // Valid local identifiers can otherwise exceed the context's 200-char limit
  // after the operation prefix is attached.
  if ([...cardIds, ...plannedEdgeIds, ...plannedSectionIds].some(id => id.length > 200)) {
    throw new Error('生成的卡片或连线标识过长，未作修改，请重新提问。');
  }
  const output = (next: Board, edgeIds: string[], alreadyApplied: boolean): AiBoardActionResult => ({
    board: next, actionId: batch.id, cardIds: [...new Set([...cardIds, ...(batch.updates || []).map(update => update.cardId), ...aiLayoutTargets(batch).map(id => localIds.get(id) || id)])], edgeIds,
    createdCards: alreadyApplied ? 0 : next.cards.length - board.cards.length,
    createdConnections: alreadyApplied ? 0 : next.edges.length - board.edges.length,
    createdSections: alreadyApplied ? 0 : (next.sections || []).filter(section => !board.sections?.some(old => old.id === section.id)).length,
    updatedSections: alreadyApplied ? 0 : (next.sections || []).filter(section => { const old = board.sections?.find(old => old.id === section.id); return old && JSON.stringify(old) !== JSON.stringify(section); }).length,
    movedCards: alreadyApplied ? 0 : next.cards.filter(card => { const old = board.cards.find(old => old.id === card.id); return old && (old.x !== card.x || old.y !== card.y); }).length,
    sectionIds: (next.sections || []).filter(section => { const old = board.sections?.find(old => old.id === section.id); return !old || JSON.stringify(old) !== JSON.stringify(section); }).map(section => section.id),
    suggestedUpdates: alreadyApplied ? 0 : (batch.updates?.length || 0),
    alreadyApplied,
  });
  const localIds = new Map(batch.notes.map((note, index) => [note.id, cardIds[index]]));
  if (options.appliedActionIds?.has(batch.id) || board.aiOperations?.some(operation => operation.id === batch.id)) {
    const existingIds = new Set(board.edges.map(edge => edge.id));
    return output(board, plannedEdgeIds.filter(id => existingIds.has(id)), true);
  }
  const existingSuggestions = (batch.updates || []).filter(update => board.cards.find(card => card.id === update.cardId)?.aiNoteChange?.id === batch.id).length;
  if (existingSuggestions) {
    if (existingSuggestions !== batch.updates?.length) throw new Error('本轮建议已有部分保存或处理，请逐张查看，未重复执行。');
    return output(board, [], true);
  }
  assertAiLayoutSnapshot(board, batch, options.layoutSnapshot);
  const existingCards = new Map(board.cards.map(card => [card.id, card]));
  const existingEdges = new Map(board.edges.map(edge => [edge.id, edge]));
  if (existingCards.size !== board.cards.length || existingEdges.size !== board.edges.length || new Set(board.sections?.map(section => section.id)).size !== (board.sections?.length || 0)) {
    throw new Error('当前画板存在重复的卡片或连线标识，未作修改。');
  }
  if (plannedSectionIds.some(id => board.sections?.some(section => section.id === id))) throw new Error('本次整理的分区已存在，未重复执行。请从 AI 记录查看。');
  let existingNotes = 0;
  batch.notes.forEach((note, index) => {
    if (existingCards.has(note.id)) throw new Error('新卡片的局部标识与已有卡片冲突，未作修改。');
    const previous = existingCards.get(cardIds[index]);
    if (!previous) return;
    if (previous.kind !== 'note' || previous.contentRole !== 'note' || previous.title !== note.title || previous.body !== note.body) {
      throw new Error('本次 AI 卡片已存在且内容有变化，未重复创建。');
    }
    existingNotes++;
  });
  if (existingNotes > 0 && existingNotes !== batch.notes.length) {
    throw new Error('本次 AI 操作仅有部分内容存在，未继续修改画板。');
  }

  const resolve = (id: string) => {
    const local = localIds.get(id);
    if (local) return local;
    if (existingCards.has(id)) return id;
    throw new Error('AI 连线需要的卡片已不存在，未作修改。');
  };
  aiLayoutTargets(batch).forEach(resolve);
  const plannedEdges: Edge[] = [];
  const plannedPairs = new Set<string>();
  batch.connections.forEach((connection, index) => {
    const from = resolve(connection.from), to = resolve(connection.to);
    if (from === to) throw new Error('不能连接卡片自身，未作修改。');
    const candidate: Edge = { id: plannedEdgeIds[index], from, to,
      ...(connection.label ? { label: connection.label } : {}) };
    const collision = existingEdges.get(candidate.id);
    if (collision && !sameEdge(collision, candidate)) {
      throw new Error('本次 AI 连线已存在且内容有变化，未重复创建。');
    }
    const pair = pairKey(from, to);
    if (plannedPairs.has(pair)) return;
    plannedPairs.add(pair);
    plannedEdges.push(candidate);
  });
  const occupiedPairs = new Set(board.edges.map(edge => pairKey(edge.from, edge.to)));
  const ownEdges = plannedEdges.filter(edge => existingEdges.has(edge.id));
  const newEdges = plannedEdges.filter(edge => !occupiedPairs.has(pairKey(edge.from, edge.to)));
  // Stable IDs identify an already committed batch after a reload. The graph
  // must still be complete; never silently finish a partially present batch.
  if (existingNotes > 0 || ownEdges.length > 0) {
    if (newEdges.length || (batch.notes.length > 0 && existingNotes === 0) || aiLayoutTargets(batch).length) {
      throw new Error('本次 AI 操作仅有部分内容存在，未继续修改画板。');
    }
    return output(board, ownEdges.map(edge => edge.id), true);
  }
  const updates = new Map<string, Card>();
  const identities = new Set<string>();
  for (const update of batch.updates || []) {
    const card = existingCards.get(update.cardId);
    if (!card) throw new Error('需要修改的笔记已移除，未保存建议。');
    const identity = card.sharedId || card.id;
    if (identities.has(identity)) throw new Error('同一笔记的多个共享引用不能生成不同建议，请只引用其中一张。');
    identities.add(identity);
    updates.set(card.id, proposeNoteChange(card, options.layoutSnapshot?.cards.find(item => item.id === card.id), batch.id, update.body));
  }
  const point = options.point ?? { x: 0, y: 0 };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('新卡片的位置无效，未作修改。');
  const imports = batch.notes.map(note => ({ kind: 'note' as const, title: note.title, body: note.body }));
  const positions = layoutImportedMedia(imports, point, board.cards, { measuredHeights: options.measuredHeights });
  const now = new Date().toISOString();
  const cards: Card[] = batch.notes.map((note, index) => ({
    id: cardIds[index], kind: 'note', contentRole: 'note', title: note.title, body: note.body,
    ...positions[index], createdAt: now, updatedAt: now, creationDateSource: 'actual',
  }));
  const candidate = !cards.length && !newEdges.length ? board : { ...board, cards: cards.length ? [...board.cards, ...cards] : board.cards,
    edges: newEdges.length ? [...board.edges, ...newEdges] : board.edges };
  const suggested = updates.size ? { ...candidate, cards: candidate.cards.map(card => updates.get(card.id) || card) } : candidate;
  return output(applyAiBoardLayout(board, suggested, batch, resolve, point, options.measuredHeights), newEdges.map(edge => edge.id), false);
}
