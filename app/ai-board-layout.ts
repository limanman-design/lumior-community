import type { Board, Card, Point } from './canvas-model';
import { occupiedRectangle } from './imported-media-layout.ts';
import { containedCards } from './canvas-sections.ts';
import { aiOperationFingerprint } from './ai-operation-history.ts';
import { aiLayoutTargets, type AiBoardActions } from '../lib/ai-board-tools.ts';

type Section = NonNullable<Board['sections']>[number];
type Rect = Point & { width: number; height: number };
export type AiLayoutSnapshot = Pick<Board, 'cards' | 'sections'>;
const gap = 32, padding = 32, heading = 32;
const intersects = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const expand = (rect: Rect): Rect => ({ x: rect.x - gap, y: rect.y - gap, width: rect.width + gap * 2, height: rect.height + gap * 2 });
const sectionFootprint = (rect: Rect): Rect => ({ ...rect, y: rect.y - heading, height: rect.height + heading });
export const aiSectionId = (actionId: string, groupId: string) => `ai-section:${actionId}:${groupId}`;

/** Only move a card if the request still describes its current content and geometry. */
export function assertAiLayoutSnapshot(board: Board, actions: AiBoardActions, snapshot?: AiLayoutSnapshot) {
  if (!snapshot) return;
  const old = new Map(snapshot.cards.map(card => [card.id, card]));
  const targets = aiLayoutTargets(actions).filter(id => !id.startsWith('new:'));
  const stable = (card: Card | undefined) => card ? aiOperationFingerprint(card) : '';
  const sectionState = (items: Section[] = []) => JSON.stringify(items.map(aiOperationFingerprint).sort());
  if (targets.some(id => !old.has(id) || stable(old.get(id)) !== stable(board.cards.find(card => card.id === id)))
    || targets.length && sectionState(snapshot.sections) !== sectionState(board.sections)) {
    throw new Error('整理期间目标卡片或分区已有改动，已保留你的修改，请重新发起整理。');
  }
}

function cardGrid(cards: Card[], layout: 'grid' | 'row' | 'column', measured: Record<string, number>) {
  const columns = layout === 'row' ? cards.length : layout === 'column' ? 1 : Math.min(3, Math.ceil(Math.sqrt(cards.length)));
  const rows: { items: { card: Card; box: Rect }[]; width: number; height: number }[] = [];
  for (const card of cards) {
    const box = occupiedRectangle(card, measured);
    if (!box) throw new Error('卡片尺寸无效，未整理画板。');
    let row = rows.at(-1);
    if (!row || row.items.length === columns) { row = { items: [], width: 0, height: 0 }; rows.push(row); }
    row.width += (row.items.length ? gap : 0) + box.width;
    row.height = Math.max(row.height, box.height); row.items.push({ card, box });
  }
  const positions = new Map<string, Point>();
  let y = 0;
  for (const row of rows) {
    let x = 0;
    for (const { card, box } of row.items) { positions.set(card.id, { x, y: y + card.y - box.y }); x += box.width + gap; }
    y += row.height + gap;
  }
  return { positions, width: Math.max(0, ...rows.map(row => row.width)), height: Math.max(0, y - gap) };
}

function freePosition(rect: Rect, obstacles: Rect[]) {
  let y = rect.y;
  for (let pass = 0; pass <= obstacles.length; pass++) {
    let next = y;
    for (const obstacle of obstacles) if (intersects({ ...rect, y }, expand(obstacle))) next = Math.max(next, obstacle.y + obstacle.height + gap);
    if (next === y) return { x: rect.x, y };
    y = next;
  }
  throw new Error('未找到可用的排布位置，画板未作修改。');
}

/** Geometry is local and deterministic; the model chooses meaning, order and membership only. */
export function applyAiBoardLayout(original: Board, candidate: Board, actions: AiBoardActions, resolve: (id: string) => string,
  point: Point, measured: Record<string, number> = {}): Board {
  if (!actions.groups?.length && !actions.arrangements?.length) return candidate;
  const byId = new Map(candidate.cards.map(card => [card.id, card]));
  const targets = new Set(aiLayoutTargets(actions).map(resolve));
  const grouped = new Set((actions.groups || []).flatMap(group => group.cardIds.map(resolve)));
  const sections = original.sections || [];
  const members = new Map(sections.map(section => [section.id, containedCards(section, original.cards, measured)]));
  // Regrouping replaces only completely covered frames. Partial frames retain their other cards.
  const replaced = new Set(sections.filter(section => {
    const ids = members.get(section.id)!;
    return ids.length && ids.every(id => grouped.has(id)) && !original.cards.some(card => {
      const box = occupiedRectangle(card, measured);
      return box && intersects(section, box) && !grouped.has(card.id);
    });
  }).map(section => section.id));
  const plans = [
    ...(actions.groups || []).map(group => ({ ids: group.cardIds.map(resolve), layout: 'grid' as const,
      section: { id: aiSectionId(actions.id, group.id), title: group.title, color: '#ffffff', ...(group.reason ? { aiReason: group.reason } : {}) } as Pick<Section, 'id' | 'title' | 'color' | 'aiReason'>, previous: undefined as Section | undefined })),
    ...(actions.arrangements || []).flatMap(arrangement => {
      const ids = arrangement.cardIds.map(resolve), set = new Set(ids);
      const used = new Set<string>();
      // Preserve complete existing groups when arranging several groups at once.
      const containers = sections.filter(section => !replaced.has(section.id) && members.get(section.id)!.length && members.get(section.id)!.every(id => set.has(id)))
        .sort((a, b) => a.width * a.height - b.width * b.height).filter(section => {
          const items = members.get(section.id)!;
          if (items.some(id => used.has(id))) return false;
          items.forEach(id => used.add(id)); return true;
        });
      return [
        ...containers.map(previous => ({ ids: ids.filter(id => members.get(previous.id)!.includes(id)), layout: arrangement.layout,
          section: { id: previous.id, title: previous.title, color: previous.color, ...(previous.aiReason ? { aiReason: previous.aiReason } : {}) }, previous })),
        ...(ids.some(id => !used.has(id)) ? [{ ids: ids.filter(id => !used.has(id)), layout: arrangement.layout, section: undefined, previous: undefined }] : []),
      ];
    }),
  ];
  const resized = new Set(plans.flatMap(plan => plan.previous ? [plan.previous.id] : []));
  const obstacles: Rect[] = [
    ...candidate.cards.filter(card => !targets.has(card.id)).flatMap(card => { const box = occupiedRectangle(card, measured); return box ? [box] : []; }),
    ...sections.filter(section => !replaced.has(section.id) && !resized.has(section.id)).map(sectionFootprint),
  ];
  const positions = new Map<string, Point>(), nextSections = sections.filter(section => !replaced.has(section.id) && !resized.has(section.id));
  const existingTargets = original.cards.filter(card => targets.has(card.id));
  const anchor = existingTargets.length ? { x: Math.min(...existingTargets.map(card => card.x)), y: Math.min(...existingTargets.map(card => occupiedRectangle(card, measured)!.y)) }
    : { x: point.x - 180, y: point.y - 160 };
  let nextX = anchor.x, nextY = anchor.y, rowHeight = 0;
  plans.forEach((plan, index) => {
    if (index && index % 3 === 0) { nextX = anchor.x; nextY += rowHeight + gap; rowHeight = 0; }
    const cards = plan.ids.map(id => { const card = byId.get(id); if (!card) throw new Error('整理所需的卡片已移除，未作修改。'); return card; });
    const grid = cardGrid(cards, plan.layout, measured), inset = plan.section ? padding : 0, top = plan.section ? padding + heading : 0;
    const rect = { x: plan.previous?.x ?? nextX, y: plan.previous?.y ?? nextY, width: grid.width + inset * 2, height: grid.height + top + inset };
    const footprint = plan.section ? sectionFootprint(rect) : rect;
    const free = freePosition(footprint, obstacles), at = { x: free.x, y: free.y + (plan.section ? heading : 0) };
    if (![at.x, at.y, rect.width, rect.height].every(Number.isFinite)) throw new Error('整理位置超出支持范围，未作修改。');
    obstacles.push({ ...footprint, ...free });
    for (const [id, position] of grid.positions) positions.set(id, { x: at.x + inset + position.x, y: at.y + top + position.y });
    if (plan.section) nextSections.push({ ...plan.section, ...at, width: rect.width, height: rect.height });
    nextX = at.x + rect.width + gap; rowHeight = Math.max(rowHeight, at.y + rect.height - nextY);
  });
  const cards = candidate.cards.map(card => {
    const position = positions.get(card.id);
    return !position || position.x === card.x && position.y === card.y ? card : { ...card, ...position };
  });
  // Preserve existing frame stacking order; append newly created frames.
  const sectionOrder = new Map(sections.map((section, index) => [section.id, index]));
  nextSections.sort((a, b) => (sectionOrder.get(a.id) ?? sections.length) - (sectionOrder.get(b.id) ?? sections.length));
  const sameSections = JSON.stringify(candidate.sections || []) === JSON.stringify(nextSections);
  return cards.every((card, index) => card === candidate.cards[index]) && sameSections ? candidate
    : { ...candidate, cards, ...(!sameSections ? { sections: nextSections } : {}) };
}
