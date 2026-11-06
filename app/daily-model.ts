import type { Board, Card } from './canvas-model';
import type { WorkspaceContent, WorkspaceFiles } from './workspace-files';
import { contentIdentity } from './workspace-files.ts';

export type DailyCapture = { source: 'daily' | 'pet' | 'assistant'; at: number; organizedAt?: number; dismissedBoards?: string[]; position?: { x: number; y: number } };
export function validDailyCapture(value: unknown): value is DailyCapture {
  if (!value || typeof value !== 'object') return false;
  const capture = value as DailyCapture;
  return ['daily', 'pet', 'assistant'].includes(capture.source) && Number.isSafeInteger(capture.at) && capture.at >= 0
    && (capture.organizedAt === undefined || Number.isSafeInteger(capture.organizedAt) && capture.organizedAt >= 0)
    && (capture.position === undefined || validDailyPosition(capture.position))
    && (capture.dismissedBoards === undefined || Array.isArray(capture.dismissedBoards) && capture.dismissedBoards.every(id => typeof id === 'string' && !!id));
}
export function markDailyCapture(files: WorkspaceFiles, id: string, source: DailyCapture['source'], at = Date.now()): WorkspaceFiles {
  if (!validDailyCapture({ source, at })) throw new Error('Invalid daily capture.');
  return { ...files, contents: files.contents.map(content => content.id === id ? { ...content, daily: { source, at } } : content) };
}
export function dailyContents(files: WorkspaceFiles): WorkspaceContent[] {
  return files.contents.filter(content => content.daily && content.daily.organizedAt === undefined).sort((a, b) => b.daily!.at - a.daily!.at || a.id.localeCompare(b.id));
}
export function dailyRecordStreak(contents: readonly WorkspaceContent[], now = Date.now()): number {
  const calendarDay = (at: number) => {
    const date = new Date(at);
    return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000;
  };
  const today = calendarDay(now);
  const days = new Set(contents.filter(content => content.daily && !content.card.tags?.includes('daily-preview'))
    .map(content => calendarDay(content.daily!.at)).filter(day => day <= today));
  let cursor = days.has(today) ? today : today - 1;
  let count = 0;
  while (days.has(cursor)) { count++; cursor--; }
  return count;
}
export function dailyBoardIds(id: string, boards: readonly Board[]): string[] {
  return boards.filter(board => board.cards.some(card => contentIdentity(card) === id)).map(board => board.id);
}
export function dismissDailyClue(files: WorkspaceFiles, id: string, boardId: string): WorkspaceFiles {
  return { ...files, contents: files.contents.map(content => content.id === id && content.daily
    ? { ...content, daily: { ...content.daily, dismissedBoards: [...new Set([...(content.daily.dismissedBoards || []), boardId])] } } : content) };
}

// Literal shared terms are clues, not semantic claims. Never read stored PDFs or
// make a model call in the background. The user chooses whether to compare sources.
const commonWords = new Set('这个 那个 一个 一些 我们 你们 可以 需要 进行 关于 如何 什么 为什么 就是 但是 因为 所以 以及 通过 记录 内容 笔记 想法 资料 研究 方法 设计 问题 the and for with from this that into have has are was were what how about your you its can will not'.split(' '));
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
function terms(text: string): Set<string> {
  return new Set([...segmenter.segment(text.normalize('NFKC').toLowerCase())]
    .filter(part => part.isWordLike && part.segment.length >= 2 && !commonWords.has(part.segment))
    .map(part => part.segment));
}
export type DailyClue = { id: string; contentId: string; boardId: string; boardTitle: string; sourceId?: string; sourceTitle?: string; terms: string[] };
export function dailyClues(contents: readonly WorkspaceContent[], boards: readonly Board[], limit = 3): DailyClue[] {
  const index = boards.map(board => ({ board, title: terms(board.title), sources: board.cards.filter(card => card.kind !== 'database').map(card => ({ card, terms: terms(card.title + ' ' + (card.tags || []).join(' ')) })) }));
  const clues: (DailyClue & { score: number })[] = [];
  for (const content of contents.slice(0, 100)) {
    if (!content.daily) continue;
    const words = terms(content.card.title + ' ' + content.card.body.slice(0, 6000));
    for (const { board, title, sources } of index) {
      if (content.daily.dismissedBoards?.includes(board.id) || board.cards.some(card => contentIdentity(card) === content.id)) continue;
      const titleMatches = [...title].filter(word => words.has(word));
      let best: { card?: Card; matches: string[] } = { matches: titleMatches };
      for (const source of sources) {
        const sourceMatches = [...source.terms].filter(word => words.has(word));
        const matches = [...new Set([...titleMatches, ...sourceMatches])];
        if (matches.length > best.matches.length || !best.card && sourceMatches.length > 0 && matches.length === best.matches.length) best = { card: source.card, matches };
      }
      if (best.matches.length < 2) continue;
      clues.push({ id: content.id + ':' + board.id, contentId: content.id, boardId: board.id, boardTitle: board.title,
        sourceId: best.card ? contentIdentity(best.card) : undefined, sourceTitle: best.card?.title,
        terms: best.matches.slice(0, 3), score: best.matches.length + titleMatches.length });
    }
  }
  const used = new Set<string>();
  return clues.sort((a, b) => b.score - a.score).filter(clue => { if (used.has(clue.contentId)) return false; used.add(clue.contentId); return true; }).slice(0, limit);
}

export function dailyPreviewImage(card: Card): string | undefined {
  if (card.image) return card.image;
  for (const block of card.blocks || []) {
    if (block.type === 'image' && block.props && 'url' in block.props && typeof block.props.url === 'string') return block.props.url;
  }
  return card.pdf?.thumbnail || card.video?.poster || undefined;
}

export function validDailyPosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false;
  const point = value as { x: number; y: number };
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) <= 1000000 && Math.abs(point.y) <= 1000000;
}
export function positionDailyCapture(files: WorkspaceFiles, id: string, position: { x: number; y: number }): WorkspaceFiles {
  if (!validDailyPosition(position)) return files;
  return { ...files, contents: files.contents.map(content => content.id === id && content.daily
    ? { ...content, daily: { ...content.daily, position } } : content) };
}

/** Organization leaves the source and capture history intact; it only clears the daily inbox. */
export function organizeDailyCapture(files: WorkspaceFiles, id: string, at = Date.now()): WorkspaceFiles {
  return { ...files, contents: files.contents.map(content => content.id === id && content.daily && content.daily.organizedAt === undefined
    ? { ...content, daily: { ...content.daily, organizedAt: at } } : content) };
}
export function positionDailyCaptures(files: WorkspaceFiles, positions: Record<string, { x: number; y: number }>): WorkspaceFiles {
  return { ...files, contents: files.contents.map(content => content.daily && validDailyPosition(positions[content.id])
    ? { ...content, daily: { ...content.daily, position: positions[content.id] } } : content) };
}

/** Inline image notes use an image preview; real media retain their native card kind. */
export function dailyDisplayCard(card: Card): Card {
  const image = card.kind === 'note' ? dailyPreviewImage(card) : undefined;
  return { ...card, x: 0, y: 0, ...(card.kind === 'note' ? { height: undefined } : {}), ...(image ? { kind: 'image', image, height: undefined } : {}),
    ...(card.kind === 'image' || image ? { width: Math.min(card.width, 360), height: Math.min(card.height || 420, 420) } : {}) };
}

export function dailyImageSize(naturalWidth: number, naturalHeight: number) {
  if (!Number.isFinite(naturalWidth) || !Number.isFinite(naturalHeight) || naturalWidth <= 0 || naturalHeight <= 0) return { width: 360, height: 420 };
  const scale = Math.min(358 / naturalWidth, 418 / naturalHeight, 1);
  return { width: naturalWidth * scale + 2, height: naturalHeight * scale + 2 };
}
