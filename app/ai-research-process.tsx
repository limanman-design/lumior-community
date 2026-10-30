'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { AiMessage } from './ai-chat-store';
import { useI18n } from './i18n';
import { translate, type TranslationParams } from './i18n-core';
import { localizeAiSystemText } from './ai-ui-text';
import { researchPresentation, researchActionLabel, researchMilestoneText } from './ai-research-presentation';
import { WakeOrb } from './wake-orb';
import { MaterialIcon } from './material-icon';
import './ai-research-process.css';

export function aiDuration(seconds: number, t: (en: string, zh: string, params?: TranslationParams) => string = translate) {
  const value = Math.max(0, Math.floor(seconds));
  if (value < 60) return t('{seconds} s', '{seconds} 秒', { seconds: value });
  return t('{minutes} min {seconds} s', '{minutes} 分 {seconds} 秒', { minutes: Math.floor(value / 60), seconds: value % 60 });
}

export function AiResearchProcess({ message, children }: { message: AiMessage; children?: ReactNode }) {
  const { t } = useI18n();
  const active = ['preparing', 'pending', 'streaming'].includes(message.status || '');
  const detailsId = useId();
  const [visibility, setVisibility] = useState<{ active?: boolean; settled?: boolean }>({});
  const phase = active ? 'active' : 'settled';
  const open = visibility[phase] ?? false;
  const [groupVisibility, setGroupVisibility] = useState<Record<string, boolean>>({});
  const [now, setNow] = useState(message.createdAt);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, message.createdAt]);
  const presentation = useMemo(() => researchPresentation(message), [message.process, message.progress, message.status, message.elapsed, message.context, message.references]);
  const elapsed = active ? Math.max(0, Math.round((now - message.createdAt) / 1000)) : message.elapsed;
  const result = message.status === 'complete' ? t('Completed in', '用时') : message.status === 'stopped' ? t('Stopped · Elapsed', '已停止 · 用时') : message.status === 'interrupted' ? t('Interrupted · Recorded', '已中断 · 已记录') : message.status === 'error' ? t('Incomplete · Elapsed', '未完成 · 用时') : t('Thinking · Elapsed', '思考中 · 已用时');
  const currentLabel = presentation.groups.length ? researchActionLabel(presentation.currentAction, presentation.task, t) : t('Working on your request', '正在处理请求');
  const currentGroup = presentation.groups.at(-1);
  const currentStepIds = new Set(currentGroup?.steps.map(step => step.id));
  const milestone = [...presentation.milestones].reverse().find(item => currentStepIds.has(item.id));
  const reply = milestone ? researchMilestoneText(milestone, t, presentation.task) : localizeAiSystemText(presentation.steps.at(-1)?.displayMessage || t('Working on your request…', '正在处理你的请求…'), t);
  const recordedCoverage = milestone?.kind === 'coverage' ? { read: milestone.read, total: milestone.total } : undefined;
  const sourceCoverage = message.context?.coverage;
  const coverage = recordedCoverage ?? (sourceCoverage && Number.isFinite(sourceCoverage.readPassages) && Number.isFinite(sourceCoverage.totalPassages) && sourceCoverage.readPassages >= 0 && sourceCoverage.readPassages <= sourceCoverage.totalPassages ? { read: sourceCoverage.readPassages, total: sourceCoverage.totalPassages } : undefined);
  const actionElapsed = Math.max(0, (elapsed ?? 0) - presentation.currentActionStartedElapsed);
  const statusLabel = !message.live ? t('Demo · No model used', '预设演示 · 未调用模型') : active ? currentLabel : elapsed == null ? t('Research record · Duration not recorded', '研究记录 · 用时未记录') : `${result} ${aiDuration(elapsed, t)}`;
  return <section className={`ai-process ${active ? 'is-active' : ''}`} aria-label={t('Research process', '研究过程')}>
    <button className="ai-process-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setVisibility(value => ({ ...value, [phase]: !open }))}>
      {active && <span className="ai-process-orb" aria-hidden="true"><WakeOrb compact speed={1.8} /></span>}
      <span className="ai-process-chevron" aria-hidden="true"><MaterialIcon name="chevron_right" size={16}/></span>
      <span className="ai-process-heading">{statusLabel}</span>
      {active && <time className="ai-process-total" aria-hidden="true">{aiDuration(elapsed ?? 0, t)}</time>}
    </button>
    {active && <div className="ai-process-live">
      <ol className="ai-process-timeline" aria-label={t('Observed research actions', '已发生的研究步骤')}>{presentation.groups.map(group => <li key={group.id} className={group.active ? 'is-current' : 'was-observed'} aria-current={group.active ? 'step' : undefined}>
        <span className="ai-process-action-dot" aria-hidden="true" />
        <div className="ai-process-step-heading"><span>{researchActionLabel(group.action, presentation.task, t)}</span><time>{aiDuration(group.active ? actionElapsed : Math.max(0, (group.endedElapsed ?? group.startedElapsed) - group.startedElapsed), t)}</time></div>
        {group.active && <div className="ai-process-update" key={milestone?.id || presentation.steps.at(-1)?.displayMessage || 'request'}>
        <p className="ai-process-reply" role="status" aria-live="polite" aria-atomic="true">{reply}</p>
        {coverage && coverage.total > 0 && presentation.currentAction === 'full-reading' && <div className="ai-process-coverage"><span className="ai-process-coverage-track" aria-hidden="true"><span style={{ width: `${Math.min(100, coverage.read / coverage.total * 100)}%` }} /></span><span>{t('{read} / {total} passages', '{read} / {total} 段', { read: coverage.read, total: coverage.total })}</span></div>}
        <div className="ai-process-live-meta"><span className="ai-process-breath" aria-hidden="true" /><span>{t('This step', '本步骤')} <time>{aiDuration(actionElapsed, t)}</time></span>{actionElapsed >= 25 && <span className="ai-process-wait-note">{t('This step is still in progress', '这一步仍在进行')}</span>}</div>
        </div>}
      </li>)}</ol>
      {!presentation.groups.length && <p className="ai-process-reply" role="status" aria-live="polite" aria-atomic="true">{reply}</p>}
    </div>}
    {active && <button className="ai-process-records-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setVisibility(value => ({ ...value, [phase]: !open }))}>{open ? t('Hide detailed record', '收起详细记录') : t('View detailed record', '查看详细记录')}<span>{t('{count} events', '{count} 条', { count: presentation.steps.length })}</span></button>}
    {open && <div className="ai-process-details" id={detailsId}>
      {!!presentation.steps.length && presentation.groups.map(group => {
        const groupOpen = groupVisibility[group.id] ?? group.active;
        return <div key={group.id} className={`ai-process-group ${group.active ? 'is-current-group' : ''}`}>
          <button className="ai-process-group-toggle" aria-expanded={groupOpen} onClick={() => setGroupVisibility(value => ({ ...value, [group.id]: !groupOpen }))}><span className="ai-process-chevron" aria-hidden="true"><MaterialIcon name="chevron_right" size={16}/></span><strong>{researchActionLabel(group.action, presentation.task, t)}</strong><span>{t('{count} events', '{count} 条', { count: group.steps.length })}</span><time>{aiDuration(group.startedElapsed, t)}{group.endedElapsed != null ? ` – ${aiDuration(group.endedElapsed, t)}` : ''}</time></button>
          {groupOpen && <ol>{group.steps.map((step, index) => <li key={`${index}:${step.elapsed}`} className={group.active && index === group.steps.length - 1 ? 'is-current-step' : ''}><span aria-hidden="true" className="ai-process-dot" /><p>{localizeAiSystemText(step.displayMessage, t)}</p><time>{aiDuration(step.elapsed, t)}</time></li>)}</ol>}
        </div>;
      })}
      {!presentation.steps.length && <p className="ai-process-legacy">{t('This earlier answer has no saved live process. See the source records below.', '这条历史回答未保存实时过程，可查看下方的来源记录。')}</p>}
      {children}
    </div>}
  </section>;
}
