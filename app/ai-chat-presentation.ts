import type { AiChat, AiMessage } from './ai-chat-store';

// Preset demo records stay in storage for backup compatibility, but are not
// product conversations and cannot appear as model answers.
export function visibleAiMessages(messages: readonly AiMessage[]): AiMessage[] {
  return messages.filter(message => message.live !== false);
}

export function visibleAiChats(chats: readonly AiChat[]): AiChat[] {
  return chats.filter(chat => chat.messages.length ? visibleAiMessages(chat.messages).length > 0 : chat.live !== false);
}

export function presentedAiChat(chats: readonly AiChat[], activeId: string): AiChat | undefined {
  const visible = visibleAiChats(chats);
  return visible.find(chat => chat.id === activeId) || visible[0];
}

export function aiChatDisplayTitle(chat: AiChat, fallback: string): string {
  if (!visibleAiMessages(chat.messages).length) return chat.draft.trim().slice(0, 36) || fallback;
  if (chat.messages[0]?.live === false) {
    return visibleAiMessages(chat.messages).find(message => message.role === 'user')?.text.trim().slice(0, 36) || fallback;
  }
  return chat.title;
}

export function presentedAiModel(model?: string): string {
  return !model || /^(demo|prototype|预设演示|原型演示)$/i.test(model.trim()) ? 'auto' : model;
}
