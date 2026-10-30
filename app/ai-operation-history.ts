import type { Board, Card, Edge } from './canvas-model';
import type { AiProcessStep } from './ai-chat-store';

export type AiOperationDetails = { chatId: string; messageId: string; request: string; answer: string; process: AiProcessStep[] };
type Proof = { id: string; fingerprint: string };
type Section = NonNullable<Board['sections']>[number];
type Geometry = Pick<Card, 'x' | 'y' | 'width' | 'height'>;
type Move = { id: string; before: Geometry; after: Geometry };
type SectionChange = { id: string; before?: Section; after?: Section; beforeMembers: string[]; afterMembers: string[] };
export type AiOperationRecord = AiOperationDetails & { version: 1 | 2; id: string; boardId: string; createdAt: number; cards: Proof[]; edges: Proof[]; moves?: Move[]; sections?: SectionChange[] };
export type AiOperationStatus = 'applied' | 'undone' | 'conflict';

// Ignore system timestamps and the workspace's empty-tag normalization. Geometry, formatting and content
// all participate: removing an edited card is never a safe automatic undo.
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
export function aiOperationFingerprint(value: Card | Edge | Section): string {
  const { createdAt: _createdAt, updatedAt: _updatedAt, creationDateSource: _dateSource, tags, ...rest } = value as Card;
  return JSON.stringify(canonical({ ...rest, ...(tags?.length ? { tags } : {}) }));
}
const geometry = ({ x, y, width, height }: Card): Geometry => ({ x, y, width, ...(height !== undefined ? { height } : {}) });
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const sectionMembers = (section: Section | undefined, cards: Card[]) => section ? cards.filter(card => card.x >= section.x && card.y >= section.y && card.x < section.x + section.width && card.y < section.y + section.height).map(card => card.id).sort() : [];
export function createAiOperationRecord(before: Board, after: Board, id: string, details: AiOperationDetails, now = Date.now()): AiOperationRecord {
  const previousCards = new Set(before.cards.map(card => card.id)), previousEdges = new Set(before.edges.map(edge => edge.id));
  const proof = (item: Card | Edge): Proof => ({ id: item.id, fingerprint: aiOperationFingerprint(item) });
  const moves = after.cards.flatMap(card => { const previous = before.cards.find(old => old.id === card.id); return previous && (previous.x !== card.x || previous.y !== card.y) ? [{ id: card.id, before: geometry(previous), after: geometry(card) }] : []; });
  const sections = [...new Set([...(before.sections || []).map(item => item.id), ...(after.sections || []).map(item => item.id)])].flatMap(id => {
    const old = before.sections?.find(item => item.id === id), next = after.sections?.find(item => item.id === id);
    return same(old, next) ? [] : [{ id, ...(old ? { before: { ...old } } : {}), ...(next ? { after: { ...next } } : {}), beforeMembers: sectionMembers(old, before.cards), afterMembers: sectionMembers(next, after.cards) }];
  });
  return { ...details, process: details.process.map(step => ({ ...step })), version: moves.length || sections.length ? 2 : 1, id, boardId: before.id, createdAt: now,
    cards: after.cards.filter(card => !previousCards.has(card.id)).map(proof), edges: after.edges.filter(edge => !previousEdges.has(edge.id)).map(proof),
    ...(moves.length || sections.length ? { moves, sections } : {}) };
}
export function validAiOperationRecords(value: unknown): value is AiOperationRecord[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
  return value.every(item => {
    if (!item || ![1, 2].includes(item.version) || !text(item.id, 200) || !item.id || ids.has(item.id) || !text(item.boardId, 200) || !text(item.chatId, 200) || !text(item.messageId, 200)
      || !text(item.request, 6000) || !text(item.answer, 1_000_000) || !Number.isSafeInteger(item.createdAt) || item.createdAt < 0
      || !Array.isArray(item.process) || !item.process.every((step: AiProcessStep) => step && text(step.message, 10000) && Number.isFinite(step.elapsed) && step.elapsed >= 0)) return false;
    ids.add(item.id);
    const proofs = (list: unknown, kind: string, max: number) => Array.isArray(list) && list.length <= max && new Set(list.map(proof => proof?.id)).size === list.length && list.every(proof => proof && text(proof.id, 200) && proof.id.startsWith(`${kind}:${item.id}:`) && text(proof.fingerprint, 1_000_000));
    if (!proofs(item.cards, 'ai-note', 12) || !proofs(item.edges, 'ai-edge', 24)) return false;
    if (item.version === 1) return item.moves === undefined && item.sections === undefined && item.cards.length + item.edges.length > 0;
    const uniqueList = (values: unknown, max: number) => Array.isArray(values) && values.length <= max && values.every(value => value && text(value.id, 200) && value.id.length) && new Set(values.map(value => value.id)).size === values.length;
    const validGeometry = (value: Geometry) => value && Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.width) && value.width > 0 && (value.height === undefined || Number.isFinite(value.height) && value.height > 0);
    const memberIds = (values: unknown) => Array.isArray(values) && values.length <= 3000 && values.every(id => text(id, 200) && id.length) && new Set(values).size === values.length;
    const validSection = (section: Section | undefined, id: string) => section === undefined || validGeometry(section) && Number.isFinite(section.height) && section.id === id && text(section.title, 200) && text(section.color, 100) && (section.aiReason === undefined || text(section.aiReason, 120_000));
    return uniqueList(item.moves, 300) && uniqueList(item.sections, 612)
      && item.moves.every((move: Move) => validGeometry(move.before) && validGeometry(move.after) && !same(move.before, move.after) && move.before.width === move.after.width && move.before.height === move.after.height && !item.cards.some((card: Proof) => card.id === move.id))
      && item.sections.every((change: SectionChange) => (change.before || change.after) && !same(change.before, change.after) && validSection(change.before, change.id) && validSection(change.after, change.id) && memberIds(change.beforeMembers) && memberIds(change.afterMembers) && (change.before || change.id.startsWith(`ai-section:${item.id}:`)))
      && item.cards.length + item.edges.length + item.moves.length + item.sections.length > 0;
  });
}
export function aiOperationStatus(board: Board, operation: AiOperationRecord, otherBoards: readonly Board[] = []): AiOperationStatus {
  if (operation.boardId !== board.id) return 'conflict';
  const cards = new Map(board.cards.map(card => [card.id, card])), edges = new Map(board.edges.map(edge => [edge.id, edge]));
  const present = operation.cards.filter(proof => cards.has(proof.id)).length + operation.edges.filter(proof => edges.has(proof.id)).length;
  if (operation.version === 1 && !present) return 'undone';
  const matches = (proofs: Proof[], items: Map<string, Card> | Map<string, Edge>) => proofs.every(proof => {
    const current = items.get(proof.id); return current && aiOperationFingerprint(current) === proof.fingerprint;
  });
  if (operation.version === 2) {
    const matchesLayout = (side: 'before' | 'after') => (operation.moves || []).every(move => {
      const card = cards.get(move.id); return card && same(geometry(card), move[side]);
    }) && (operation.sections || []).every(change => {
      const section = board.sections?.find(item => item.id === change.id);
      return same(section, change[side]) && same(sectionMembers(section, board.cards), change[side === 'before' ? 'beforeMembers' : 'afterMembers']);
    });
    if (!present && matchesLayout('before')) return 'undone';
    if (!matchesLayout('after')) return 'conflict';
  }
  if (!matches(operation.cards, cards) || !matches(operation.edges, edges)) return 'conflict';
  const cardIds = new Set(operation.cards.map(proof => proof.id)), edgeIds = new Set(operation.edges.map(proof => proof.id));
  if (board.edges.some(edge => !edgeIds.has(edge.id) && (cardIds.has(edge.from) || cardIds.has(edge.to)))) return 'conflict';
  const identities = new Set(operation.cards.map(proof => cards.get(proof.id)!.sharedId || proof.id));
  if (otherBoards.some(other => other.id !== board.id && other.cards.some(card => identities.has(card.sharedId || card.id)))) return 'conflict';
  return 'applied';
}
export function undoAiOperation(board: Board, id: string, otherBoards: readonly Board[] = []): Board {
  const operation = board.aiOperations?.find(item => item.id === id);
  if (!operation) throw new Error('找不到这条画板操作记录。');
  const status = aiOperationStatus(board, operation, otherBoards);
  if (status === 'undone') return board;
  if (status === 'conflict') throw new Error('相关卡片、连线或分区已有后续修改、关联或同步引用，未撤销，以保留这些改动。');
  const cards = new Set(operation.cards.map(item => item.id)), edges = new Set(operation.edges.map(item => item.id));
  const moves = new Map((operation.moves || []).map(move => [move.id, move.before]));
  const sectionChanges = new Map((operation.sections || []).map(change => [change.id, change]));
  const sections = (board.sections || []).flatMap(section => { const change = sectionChanges.get(section.id); return !change ? [section] : change.before ? [{ ...change.before }] : []; });
  for (const change of operation.sections || []) if (change.before && !sections.some(section => section.id === change.id)) sections.push({ ...change.before });
  return { ...board, cards: board.cards.filter(card => !cards.has(card.id)).map(card => {
    const previous = moves.get(card.id); return previous ? { ...card, x: previous.x, y: previous.y } : card;
  }), edges: board.edges.filter(edge => !edges.has(edge.id)), ...(operation.sections?.length ? { sections } : {}) };
}
/** Keep receipts through Cmd+Z / redo; status is derived from the actual board. */
export function retainAiOperations(before: Board, after: Board): Board {
  if (!before.aiOperations?.length || before.id !== after.id) return after;
  const records = new Map(before.aiOperations.map(item => [item.id, item]));
  for (const item of after.aiOperations || []) records.set(item.id, item);
  return { ...after, aiOperations: [...records.values()] };
}
