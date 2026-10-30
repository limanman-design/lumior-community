import { defaultThesisModel, findThesisModel, hasThesisConsent } from '../lib/thesis/providers';
import type { Board } from './canvas-model';
import type { ThesisRunResult } from '../lib/thesis/run';
import type { ThesisSkillId } from '../lib/thesis/model';
import { boardThesisSnapshot, boardThesisSession, thesisSourcePath, thesisCardMarkdown } from './thesis-board';
import { waitForReading } from './document-reading-store';

export async function runBoardThesis(board: Board, chatId: string, skill: ThesisSkillId, question: string, signal: AbortSignal, progress: (message: string, cardId?: string) => void, model = defaultThesisModel.id as string): Promise<ThesisRunResult> {
  const selected = findThesisModel(model);
  if (!selected) throw new Error('请选择论文助手支持的模型。');
  if (!hasThesisConsent(board.thesis, selected.provider)) throw new Error('请先确认当前模型服务商的资料处理说明。');
  const snapshot = boardThesisSnapshot(board, skill);
  if (skill === 'mba-lit' && board.thesis?.proposals['thesis/lit-matrix.md'])
    snapshot.boardContext += ' 本次读文献沿用文献矩阵的待采纳工作稿，防止重复处理；它尚未替换用户卡片，继续更新仍是待采纳建议，不能宣称已采纳。';
  for (const [id, role] of Object.entries(board.thesis!.sources)) {
    if (signal.aborted) throw new DOMException('已停止', 'AbortError');
    const card = board.cards.find(item => item.id === id);
    if (!card) continue;
    progress(`正在本地读取${card.pdf ? ' PDF' : ''}：${card.title}`, id);
    let text = thesisCardMarkdown(card), pages: number | undefined;
    if (card.pdf) {
      const document = await waitForReading(card, signal);
      if (!document.characters || document.characters < 30) throw new Error(`${card.title} 没有可读取文字，请先 OCR 后重新导入。`);
      pages = document.total;
      text = document.pages!.map(page => `=== PDF p.${page.page} ===\n${page.text || '【此页未提取到文字】'}`).join('\n\n');
      if (document.emptyPages.length) progress(`${card.title} 有 ${document.emptyPages.length} 页未提取到文字，已标记缺页。`);
    }
    const path = thesisSourcePath(id, role, card);
    snapshot.files[path] = { path, text: `原文件：${card.pdf?.name || card.title}\n\n${text}`, pages, modifiedAt: Date.parse(card.updatedAt || '') || 0, uploaded: true, mediaType: card.pdf ? 'application/pdf' : 'text/markdown' };
  }
  if (signal.aborted) throw new DOMException('已停止', 'AbortError');
  progress('资料已准备，正在运行论文助手…');
  const response = await fetch('/api/thesis', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: selected.id, consent: true, consentProvider: selected.provider, snapshot, session: boardThesisSession(board, chatId, skill), question }) });
  if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error || '论文助手暂时不可用。'); }
  const reader = response.body!.getReader(), decoder = new TextDecoder();
  let buffer = '', result: ThesisRunResult | undefined;
  try {
    while (true) {
      const part = await reader.read(); buffer += decoder.decode(part.value, { stream: !part.done });
      let index: number;
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, index); buffer = buffer.slice(index + 2);
        if (!chunk.startsWith('data: ')) continue;
        const event = JSON.parse(chunk.slice(6));
        if (event.type === 'progress') progress(event.message);
        if (event.type === 'error') throw new Error(event.message);
        if (event.type === 'result') result = event.result;
      }
      if (part.done) break;
    }
  } finally { reader.releaseLock(); }
  if (!result) throw new Error('连接中断，本轮未保存，可以重试。');
  return result;
}
