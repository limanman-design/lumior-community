'use client';
import { useI18n } from './i18n';
import { MaterialIcon } from './material-icon';
import type { AiBoardGeneration } from '../lib/ai-board-generation';
import { generatingCardSize } from './ai-generating-layout';
import './ai-generating-card.css';

export type PendingAiCard = AiBoardGeneration & { requestId: string; x: number; y: number; cancel: () => void };

export function AiGeneratingCard({ pending }: { pending: PendingAiCard }) {
  const { t } = useI18n();
  const title = pending.titles[0] || t('note card', '笔记卡');
  return <section className="ai-generating-card" aria-label={t('Generating card', '正在生成卡片')}
    style={{ left: pending.x, top: pending.y, ...generatingCardSize }} onPointerDown={event => event.stopPropagation()}>
    <MaterialIcon name="atlas" size={20}/>
    <output><strong>{t('Generating {title}…', '正在生成 {title}…', { title })}</strong>
      {pending.titles.length > 1 && <span>{t('{count} cards in this batch', '本次共 {count} 张卡片', { count: pending.titles.length })}</span>}</output>
    <div className="ai-generating-lines" aria-hidden="true"><i/><i/><i/></div>
    <button type="button" onClick={pending.cancel}>{t('Cancel', '取消')}</button>
  </section>;
}
