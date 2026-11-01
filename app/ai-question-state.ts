import type { AiMessage } from './ai-chat-store';

/** Only the latest completed, unanswered turn can send an option. */
export function aiMessageQuestions(messages: readonly AiMessage[]) {
  const result = new Map<string, { question: NonNullable<AiMessage['question']>; answer?: string; disabled: boolean }>();
  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || !message.question) return;
    const later = messages.slice(index + 1);
    const answer = later.find(item => item.role === 'user')?.text;
    result.set(message.id, { question: message.question, answer,
      disabled: message.status !== 'complete' || message.reason !== 'question' || later.length > 0 });
  });
  return result;
}
