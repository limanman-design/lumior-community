import { dailyExampleEvidence } from './daily-example-evidence.ts';
import type { Board, Card } from './canvas-model';
import type { WorkspaceContent } from './workspace-files';
import { contentIdentity } from './workspace-files.ts';
import { dailyMaterialExampleBoardId as dailyConnectionExampleBoardId, dailyMaterialExampleCards as dailyConnectionExampleCards } from './daily-material-examples.ts';
import { connectionInput, readConnections, type DailyConnection } from './daily-connections.ts';

const originals = dailyConnectionExampleCards();
/** Fixed examples only: never infer relationships for user-authored or edited material. */
export function isConnectionExample(card: Card, id = contentIdentity(card)): boolean {
  const original = originals.find(item => item.id === id);
  return !!original && card.kind === original.kind && card.title === original.title && card.body === original.body
    && !card.blocks?.length && card.tags?.includes('lumior-material-example') === true
    && JSON.stringify(card.pdf) === JSON.stringify(original.pdf);
}

const pairs = [
  ['uncertainty', 'source-hypothesis', '这篇论文提示：只留悬念可能还不够', 'This paper suggests suspense alone may not be enough', 'curiosity is overall higher for gains compared with losses', '是不是只要留悬念就够了',
    '已有方案把信息缺口当作主要原因；这篇论文在彩票任务中发现，信息的正负性质也影响好奇心。它为方案补充了一个需要控制的因素。阅读场景是否如此，仍需检验。',
    'Your plan focuses on missing information. In a lottery task, this paper also found an effect of outcome valence. That suggests another factor to control, but the finding still needs testing in a reading context.'],
  ['measurement', 'source-measurement', '这篇论文提供了区分两种好奇心的方法', 'A method to distinguish momentary and general curiosity', 'we assess trait curiosity and state curiosity', '把平时的倾向和当下感受分开',
    '已有方案只测平时的探索倾向。这篇论文分别测量特质与状态好奇心，为“看到提示时想不想知道答案”提供了测量参考；不能直接把年龄研究的结论当作界面效果。',
    'Your plan only measures a general tendency to explore. This paper measures trait and state curiosity separately, offering a methodological reference for curiosity at the moment of a prompt, not evidence that your interface works.'],
] as const;

export function dailyExampleConnections(records: readonly WorkspaceContent[], boards: readonly Board[], language: 'zh' | 'en'): DailyConnection[] {
  const board = boards.find(item => item.id === dailyConnectionExampleBoardId);
  if (!board) return [];
  const captures = records.filter(item => item.daily && item.daily.organizedAt === undefined
    && !item.daily.dismissedBoards?.includes(board.id) && isConnectionExample(item.card, item.id)
    && !boards.some(value => value.cards.some(card => contentIdentity(card) === item.id)));
  const sources = board.cards.filter(card => isConnectionExample(card));
  const input = connectionInput(captures, [{ ...board, cards: sources }], language);
  const result = pairs.flatMap(([capture, source, zh, en, captureQuote, sourceQuote, reasonZh, reasonEn]) => {
    const contentId = `lumior-material-example-${capture}`, sourceId = `lumior-material-example-${source}`;
    return captures.some(item => item.id === contentId) && sources.some(card => contentIdentity(card) === sourceId)
      ? [{ contentId, sourceId, boardId: board.id, relation: language === 'zh' ? zh : en, reason: language === 'zh' ? reasonZh : reasonEn, captureQuote, sourceQuote }] : [];
  });
  return readConnections(result, input).map(item => ({ ...item, example: true, captureEvidence: dailyExampleEvidence[item.contentId as keyof typeof dailyExampleEvidence] }));
}
