import type { Card } from './canvas-model';
import { documentText } from './card-document.ts';
import type { ReadingState } from './document-reading';

export type CanvasAiSuggestion = { id: string; label: [string, string]; prompt?: [string, string]; refs: string[]; action?: 'import' };
export function canvasAiSuggestions(cards: Card[], refs: string[], selected: string[], readings: Map<string, ReadingState>): CanvasAiSuggestion[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  // A missing explicit reference must never silently widen the suggestion scope.
  if (refs.some(id => !byId.has(id))) return [];
  const ids = [...new Set(refs.length ? refs : selected.length ? selected : cards.map(card => card.id))];
  const targets = ids.flatMap(id => byId.get(id) ? [byId.get(id)!] : []);
  const readable = targets.filter(card => card.kind === 'note' || card.kind === 'text'
    ? !!card.storedDocument || !!(card.blocks?.length ? documentText(card.blocks) : card.body).trim()
    : (card.kind === 'pdf' || card.kind === 'video') && readings.get(card.id)?.status === 'ready' && !!readings.get(card.id)?.document?.chunks.length && !readings.get(card.id)?.document?.emptyPages.length);
  const importSuggestion: CanvasAiSuggestion = { id: 'import', label: ['Import material', '导入资料'], refs: [], action: 'import' };
  if (!cards.length) return [importSuggestion, { id: 'outline', label: ['Start a research outline', '搭建研究提纲'], refs: [], prompt: ['Build a research outline on this canvas: create three brief template note cards titled Research question, Evidence, and Open questions; group them in a Research outline section. Do not invent research facts or add connections.', '在当前画板搭建研究提纲：创建三张简短的模板笔记卡，标题分别为“研究问题”“证据资料”“待验证问题”，放进“研究提纲”分区。不编造研究事实，不添加连线。'] }];
  const scopeRefs = refs.length || selected.length ? ids : [];
  const arrange: CanvasAiSuggestion = { id: 'arrange', label: ['Arrange as a grid', '整齐排布'], refs: scopeRefs, prompt: ['Arrange these cards as a grid. Do not change their content, create cards or add connections.', '把这些卡片排成网格，不改正文、不新建卡片或连线。'] };
  const structure: CanvasAiSuggestion = { id: 'structure', label: ['Build an outline', '搭建提纲结构'], refs: scopeRefs, prompt: ['Read these materials and create a concise outline of up to six note cards, grouped into meaningful sections, with only useful connections to the source cards. Distinguish evidence from proposed directions. Do not change the original content.', '阅读这些资料，创建不超过六张简短的提纲卡，按含义放进分区，并连接必要的来源卡。区分已有证据和建议探索的方向，不改原卡正文。'] };
  if (!readable.length || readable.length !== targets.length) return targets.length > 1 ? [arrange, importSuggestion] : [importSuggestion];
  const count = readable.length;
  const summary: CanvasAiSuggestion = { id: 'summary', label: [`Summarize ${count} card${count > 1 ? 's' : ''}`, `总结这 ${count} 张`], refs: scopeRefs, prompt: ['Summarize the key points of these materials, distinguishing evidence from inference. Do not change the canvas.', '总结这些资料的关键观点，区分原文证据和推论，不修改画板。'] };
  const quiz: CanvasAiSuggestion = { id: 'quiz', label: ['Check my understanding', '向我提问，检验理解'], refs: scopeRefs, prompt: ['Ask me one question at a time about these materials to check my understanding. Do not change the canvas.', '围绕这些资料逐个向我提问，检验我的理解，一次只问一个问题，不修改画板。'] };
  if (count === 1) return [summary, quiz, importSuggestion];
  if (count === 2 && !refs.length && !selected.length) return [summary, structure, arrange];
  return [count >= 3 && !refs.length && !selected.length ? { id: 'group', label: ['Group by topic', '按主题分组'], refs: scopeRefs, prompt: ['Read these materials and group all these cards into a few named topic sections. Preserve the original content; do not create extra cards or connections.', '阅读这些资料，将这些卡片按主题分组并放进有名称的分区。保留原卡正文，不新建笔记或连线。'] } : summary,
    { id: 'connections', label: ['Find connections and tensions', '找关联与分歧'], refs: scopeRefs, prompt: ['Compare these materials: identify supported connections, disagreements and differences in conditions. Cite evidence and do not create connections or change the canvas.', '比较这些资料，找出有证据支持的关联、分歧和适用条件差异，引用原文，不直接连线或修改画板。'] },
    ...(refs.length || selected.length ? [arrange] : [{ id: 'evidence', label: ['Find evidence gaps', '检查哪些观点缺证据'], refs: scopeRefs, prompt: ['Check which claims in these materials lack evidence. Distinguish evidence gaps from contradictions; do not assume absence without checking the text. Do not change the canvas.', '检查这些资料里哪些观点缺少证据，区分证据缺口与观点冲突，查阅原文后再判断，不修改画板。'] } as CanvasAiSuggestion])];
}
