'use client';
import { useState } from 'react';
import { MaterialIcon } from './material-icon';
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from '../components/ui/popover';
import { translate as t } from './i18n-core';
import './card-ai-change.css';

/** Shared presentation for any note-writing assistant; persistence stays with its owner. */
export type CardAiChange = { text: string; current: string; identity: string };
export function CardAiChangeBubble({ change, onResolve }: { change: CardAiChange; onResolve: (accept: boolean) => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const resolve = async (accept: boolean) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onResolve(accept); } catch (e) { setError(e instanceof Error ? e.message : t('Unable to save. Try again.', '保存失败，请重试。')); }
    finally { setBusy(false); }
  };
  return <div className="card-ai-change-anchor" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
    <Popover><PopoverTrigger render={<button className="card-ai-change-trigger" aria-label={t('Review AI changes', '查看 AI 修改建议')} title={t('AI changes awaiting acceptance', 'AI 修改建议待接受')}><MaterialIcon name="comment" size={20}/></button>}/>
      <PopoverContent side="right" align="start" sideOffset={12} className="card-ai-change-panel" onPointerDown={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <PopoverTitle>{t('AI suggested changes', 'AI 修改建议')}</PopoverTitle>
        <p>{t('Review before replacing the note. You can undo after accepting.', '确认后替换卡片内容，接受后可以撤销。')}</p>
        <div className="card-ai-change-text"><pre>{change.text}</pre><details><summary>{t('View current content', '查看当前内容')}</summary><pre>{change.current}</pre></details></div>
        {error && <p role="alert">{error}</p>}
        <div className="card-ai-change-actions"><button disabled={busy} onClick={() => void resolve(false)}>{t('Keep current', '保留原文')}</button><button className="card-ai-change-accept" disabled={busy} onClick={() => void resolve(true)}>{busy ? t('Saving…', '保存中…') : t('Accept and replace', '接受并替换')}</button></div>
      </PopoverContent>
    </Popover>
  </div>;
}
