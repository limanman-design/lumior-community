import { citationNumbers, invalidCitationTokens, readableCitationText } from '../lib/ai-citations.ts';
import type { AiBoardActions } from '../lib/ai-board-tools.ts';
import type { AiContext } from './ai-context.ts';

// Ordinary notes do not carry an AI message's private citation table. Keep
// readable source names and locations with the saved content itself.
export function boardActionReferences(actions: AiBoardActions, context: AiContext, heading = '来源（本次读取快照）'): AiBoardActions {
  const allowed = new Set(context.sources.map((_, index) => index + 1));
  const readable = (text: string) => {
    if (invalidCitationTokens(text, allowed).length) throw new Error('卡片来源无法核对，尚未保存，请重试。');
    return readableCitationText(text, 'lumior-v1');
  };
  const sourceDescription = (number: number) => {
    const source = context.sources[number - 1];
    if (!source) throw new Error('卡片来源无法核对，尚未保存，请重试。');
    const title = source.title.replace(/[\r\n]+/g, ' ').replace(/[\\`*_[\]<>]/g, '\\$&');
    return `[${number}] ${title}${source.location ? ` · ${source.location}` : source.page ? ` · PDF 第 ${source.page} 页` : ''}`;
  };
  return {
    ...actions,
    ...(actions.groups ? { groups: actions.groups.map(group => ({ ...group, title: readable(group.title), ...(group.reason ? { reason: readable(group.reason) + (citationNumbers(group.reason).length ? '\n' + citationNumbers(group.reason).map(sourceDescription).join('\n') : '') } : {}) })) } : {}),
    ...(actions.updates ? { updates: actions.updates.map(update => {
      const sources = citationNumbers(update.body).map(number => `- ${sourceDescription(number)}`);
      return { ...update, body: readable(update.body) + (sources.length ? `\n\n---\n\n${heading}\n\n${sources.join('\n')}` : '') };
    }) } : {}),
    notes: actions.notes.map(note => {
      const numbers = citationNumbers(note.title + '\n' + note.body);
      const sources = numbers.map(number => `- ${sourceDescription(number)}`);
      return { ...note, title: readable(note.title), body: readable(note.body) + (sources.length ? `\n\n---\n\n${heading}\n\n${sources.join('\n')}` : '') };
    }),
    connections: actions.connections.map(connection => {
      if (connection.label === undefined) return { ...connection };
      const numbers = citationNumbers(connection.label);
      return { ...connection, label: readable(connection.label) + (numbers.length ? ` · ${numbers.map(sourceDescription).join('；')}` : '') };
    }),
  };
}
