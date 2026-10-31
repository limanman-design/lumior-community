'use client';
import { useState } from 'react';
import { MaterialIcon } from './material-icon';
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from '../components/ui/popover';
import { translate as t } from './i18n-core';
import './card-ai-change.css';

/** Shared presentation for any note-writing assistant; persistence stays with its owner. */
export type CardAiChange = { text: string; current: string; identity: string; accepted?: boolean; loadCurrent?: () => Promise<string> };
export function CardAiChangeBubble({ change, onResolve }: { change: CardAiChange; onResolve: (accept: boolean) => Promise<void> }) {
  const [current, setCurrent] = useState(change.current), [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const resolve = async (accept: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onResolve(accept); } catch (e) { setError(e instanceof Error ? e.message : t('Unable to save. Try again.', '保存失败，请重试。')); }
    finally { setBusy(false); }
  };
  return <div className="card-ai-change-anchor">
    <Popover onOpenChange={open => {
      if (open && change.loadCurrent) { setLoading(true); setError(''); void change.loadCurrent().then(setCurrent).catch(error => setError(error instanceof Error ? error.message : '无法读取原文')).finally(() => setLoading(false)); }
    }}><PopoverTrigger render={<button onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()} className="card-ai-change-trigger" aria-label={change.accepted ? t('Review accepted AI changes', '查看已接受的 AI 修改') : t('Review AI changes', '查看 AI 修改建议')} title={change.accepted ? t('AI changes accepted · undo available', 'AI 修改已接受 · 可撤销') : t('AI changes awaiting acceptance', 'AI 修改建议待接受')}><MaterialIcon name={change.accepted ? "history" : "comment"} size={20}/></button>}/>
      <PopoverContent side="right" align="start" sideOffset={12} className="card-ai-change-panel" onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <PopoverTitle>{change.accepted ? t('Accepted AI changes', '已接受的 AI 修改') : t('AI suggested changes', 'AI 修改建议')}</PopoverTitle>
        <p>{change.accepted ? t('Undo restores the previous content if this note has no later edits.', '没有后续编辑时，可以撤销这次替换、恢复原文。') : t('Review before replacing the note. Shared references update together. You can undo after accepting.', '确认后替换正文，共享引用会一起更新，接受后可以撤销。')}</p>
        <div className="card-ai-change-text"><pre>{change.text}</pre><details><summary>{t('View current content', '查看当前内容')}</summary><pre>{loading ? t('Loading…', '正在读取…') : change.loadCurrent ? current : change.current}</pre></details></div>
        {error && <p role="alert">{error}</p>}
        <div className="card-ai-change-actions"><button disabled={busy} onClick={() => void resolve(false)}>{change.accepted ? t('Remove this record', '清除这条记录') : t('Keep current', '保留原文')}</button><button className="card-ai-change-accept" disabled={busy} onClick={() => void resolve(true)}>{busy ? t('Saving…', '保存中…') : change.accepted ? t('Undo replacement', '撤销这次替换') : t('Accept and replace', '接受并替换')}</button></div>
      </PopoverContent>
    </Popover>
  </div>;
}
