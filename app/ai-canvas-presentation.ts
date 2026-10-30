import type { AiChat, AiMessage } from './ai-chat-store';
import { researchActionLabel, researchPresentation } from './ai-research-presentation.ts';
import { localizeAiSystemText, type AiTranslate } from './ai-ui-text.ts';

/** Use recorded activity, never a fabricated sequence or a restored old run. */
export function canvasRunningActivity(message: AiMessage | undefined, t: AiTranslate) {
  if (!message || !['preparing', 'pending', 'streaming'].includes(message.status || '')) return null;
  const presentation = researchPresentation(message);
  const latest = presentation.steps.at(-1);
  return {
    label: latest?.recognized ? researchActionLabel(presentation.currentAction, presentation.task, t) : t('Working on your request', '正在处理请求'),
    detail: localizeAiSystemText(latest?.displayMessage || t('Working on your request', '正在处理请求'), t),
  };
}

export type AiCanvasView = { docked: boolean; collapsed: boolean; dockHintDismissed: boolean };
export const defaultAiCanvasView: AiCanvasView = { docked: false, collapsed: false, dockHintDismissed: false };

export function readAiCanvasView(value: unknown): AiCanvasView {
  const view = value && typeof value === 'object' ? value as Partial<AiCanvasView> : {};
  return { docked: view.docked === true, collapsed: view.collapsed === true, dockHintDismissed: view.dockHintDismissed === true };
}

/** Regeneration, failed attempts and restored preset messages aren't new rounds. */
export function completedAiRounds(messages: readonly AiMessage[]) {
  const questions = new Set(messages.filter(message => message.live && message.role === 'user').map(message => message.id));
  return new Set(messages.filter(message => message.live && message.role === 'assistant' && message.status === 'complete' && !message.operationOnly
    && message.replyTo && questions.has(message.replyTo)).map(message => message.replyTo)).size;
}

/** Operations keep their full transcript in records, without crowding conversation. */
export function canvasConversationMessages(messages: readonly AiMessage[]): AiMessage[] {
  const operation = (message: AiMessage) => message.operationOnly === true && message.status === 'complete' && message.presentationMode !== 'conversation';
  const operationQuestions = new Set(messages.filter(operation).map(message => message.replyTo));
  const conversationQuestions = new Set(messages.filter(message => message.role === 'assistant' && !operation(message)).map(message => message.replyTo));
  return messages.filter(message => !operation(message) && !(message.role === 'user' && operationQuestions.has(message.id) && !conversationQuestions.has(message.id)));
}

/** Keep operation answers beside an existing conversation so their undo footer
 * remains accessible. Standalone operations still use the lightweight toast. */
export function canvasPanelMessages(messages: readonly AiMessage[], showOperations = false): AiMessage[] {
  const conversation = canvasConversationMessages(messages);
  const hasConversation = conversation.some(message => message.role === 'assistant' && !message.operationOnly && !['preparing', 'pending', 'streaming'].includes(message.status || ''));
  return showOperations || hasConversation ? [...messages] : conversation;
}

export function appendAiReferences(chat: AiChat, requested: readonly string[], availableIds: readonly string[]): AiChat {
  const available = new Set(availableIds);
  return { ...chat, refs: [...new Set([...chat.refs, ...requested.filter(id => available.has(id))])] };
}
