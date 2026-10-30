'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { aiOperationSummary, aiOperationRecordResult } from './ai-operation-summary';
import { useI18n } from './i18n';
import { aiChatDisplayTitle, visibleAiMessages } from './ai-chat-presentation';
import { canvasConversationMessages } from './ai-canvas-presentation';
import type { AiChat } from './ai-chat-store';
import type { AiOperationRecord, AiOperationStatus } from './ai-operation-history';
import { localizeAiSystemText } from './ai-ui-text';
import './ai-canvas-history.css';

export function AiCanvasHistory({ open, onClose, chats, operations, statuses, initialOperation, onOpenChat, onUndo }: {
  open: boolean; onClose: () => void; chats: AiChat[]; operations: AiOperationRecord[]; statuses: Record<string, AiOperationStatus>;
  initialOperation?: string; onOpenChat: (id: string, showOperations?: boolean) => void; onUndo: (id: string) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const [tab, setTab] = useState(initialOperation ? 'operations' : 'chats');
  const [detail, setDetail] = useState(initialOperation || '');
  const [pending, setPending] = useState(''), [error, setError] = useState('');
  const undo = async (id: string) => { setPending(id); setError(''); try { await onUndo(id); } catch (error) { setError(error instanceof Error ? error.message : t('Undo failed', '撤销失败')); } finally { setPending(''); } };
  const conversations = chats.filter(chat => visibleAiMessages(chat.messages).some(message => message.role === 'assistant' && !message.operationOnly) || !!chat.draft.trim() || !chat.messages.length);
  const conversationTitle = (chat: AiChat) => canvasConversationMessages(visibleAiMessages(chat.messages)).find(message => message.role === 'user')?.text.trim().slice(0, 36) || aiChatDisplayTitle(chat, t('New conversation', '新对话'));
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}><DialogContent className="ai-records-dialog">
    <DialogTitle>{t('AI records', 'AI 记录')}</DialogTitle>
    <DialogDescription>{t('Conversations and changes to this canvas.', '这块画板的对话与 AI 操作。')}</DialogDescription>
    <div className="ai-record-tabs" aria-label={t('Record type', '记录类型')}><button aria-pressed={tab === 'chats'} onClick={() => setTab('chats')}>{t('Conversations', '对话')}</button><button aria-pressed={tab === 'operations'} onClick={() => setTab('operations')}>{t('AI operations', 'AI 操作')}</button></div>
    {error && <p role="alert" className="ai-record-error">{localizeAiSystemText(error, t)}</p>}
    <div className="ai-record-list">{tab === 'chats' ? <>{!conversations.length && <p>{t('No conversations yet', '还没有对话')}</p>}{conversations.map(chat => <button className="ai-record-chat" key={chat.id} onClick={() => onOpenChat(chat.id)}><strong>{conversationTitle(chat)}</strong><time>{new Date(chat.updatedAt).toLocaleString(locale)}</time></button>)}</> : <>
      {!operations.length && <p>{t('No AI changes yet. Manual edits are kept in normal undo history.', '还没有 AI 操作。手动编辑仍保留在普通撤销历史中。')}</p>}
      {[...operations].sort((a, b) => b.createdAt - a.createdAt).map(item => <article className="ai-record-operation" key={item.id}>
        <header><strong>{item.request}</strong><span>{statuses[item.id] === 'undone' ? t('Undone', '已撤销') : statuses[item.id] === 'conflict' ? t('Changed since', '有后续改动') : t('Completed', '已完成')}</span></header>
        <p>{aiOperationSummary(aiOperationRecordResult(item), t)} · <time>{new Date(item.createdAt).toLocaleString(locale)}</time></p>
        <div className="ai-record-actions"><button aria-expanded={detail === item.id} onClick={() => setDetail(detail === item.id ? '' : item.id)}>{t('View process', '查看过程')}</button><button disabled={!chats.some(chat => chat.id === item.chatId)} onClick={() => onOpenChat(item.chatId, true)}>{t('View conversation', '查看对话')}</button><button disabled={!!pending || statuses[item.id] !== 'applied'} onClick={() => void undo(item.id)}>{pending === item.id ? t('Undoing…', '正在撤销…') : t('Undo this operation', '撤销这条操作')}</button></div>
        {statuses[item.id] === 'conflict' && <p className="ai-record-conflict">{t('Cards, connections or sections were edited or referenced later. Undo is paused to preserve those changes.', '相关卡片、连线或分区已有编辑、关联或同步引用，暂不撤销，以保留后续改动。')}</p>}
        {detail === item.id && <div className="ai-record-detail"><ol>{item.process.map((step, index) => <li key={index}><span>{localizeAiSystemText(step.message, t)}</span><time>{step.elapsed}s</time></li>)}<li>{t('Saved to this canvas', '已保存到这块画板')}</li></ol><p>{item.answer}</p></div>}
      </article>)}
    </>}</div>
  </DialogContent></Dialog>;
}
