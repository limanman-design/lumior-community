'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import type { AiMessage } from './ai-chat-store';
import { useI18n } from './i18n';
import { translate, type TranslationParams } from './i18n-core';
import { localizeAiSystemText } from './ai-ui-text';
import { researchPresentation, researchActionLabel, researchMilestoneText, researchTimeline, researchTimelineLabel } from './ai-research-presentation';
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
  const open = visibility[phase] ?? active;
  const [groupVisibility, setGroupVisibility] = useState<Record<string, boolean>>({});
  const [updateVisibility, setUpdateVisibility] = useState<Record<string, boolean>>({});
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [now, setNow] = useState(message.createdAt);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active, message.createdAt]);
  const presentation = useMemo(() => researchPresentation(message), [message]);
  const timeline = useMemo(() => researchTimeline(presentation), [presentation]);
  const elapsed = active ? Math.max(0, message.elapsed ?? 0, presentation.steps.at(-1)?.elapsed ?? 0, Math.round((now - message.createdAt) / 1000)) : message.elapsed;
  const result = message.status === 'complete' ? t('Completed in', '用时') : message.status === 'stopped' ? t('Stopped · Elapsed', '已停止 · 用时') : message.status === 'interrupted' ? t('Interrupted · Recorded', '已中断 · 已记录') : message.status === 'error' ? t('Incomplete · Elapsed', '未完成 · 用时') : t('Thinking · Elapsed', '思考中 · 已用时');
  const currentLabel = presentation.groups.length ? researchActionLabel(presentation.currentAction, presentation.task, t) : t('Working on your request', '正在处理请求');
  const currentGroup = timeline.at(-1);
  const milestone = currentGroup?.updates.at(-1);
  const reply = milestone ? researchMilestoneText(milestone, t, presentation.task) : localizeAiSystemText(presentation.steps.at(-1)?.displayMessage || t('Working on your request…', '正在处理你的请求…'), t);
  const recordedCoverage = milestone?.kind === 'coverage' ? { read: milestone.read, total: milestone.total } : undefined;
  const sourceCoverage = message.context?.coverage;
  const coverage = recordedCoverage ?? (sourceCoverage && Number.isFinite(sourceCoverage.readPassages) && Number.isFinite(sourceCoverage.totalPassages) && sourceCoverage.readPassages >= 0 && sourceCoverage.readPassages <= sourceCoverage.totalPassages ? { read: sourceCoverage.readPassages, total: sourceCoverage.totalPassages } : undefined);
  const actionElapsed = Math.max(0, (elapsed ?? 0) - (currentGroup?.startedElapsed ?? 0));
  const quietElapsed = Math.max(0, (elapsed ?? 0) - (presentation.steps.at(-1)?.elapsed ?? 0));
  const statusLabel = !message.live ? t('Demo · No model used', '预设演示 · 未调用模型') : active ? currentLabel : elapsed == null ? t('Research record · Duration not recorded', '研究记录 · 用时未记录') : `${result} ${aiDuration(elapsed, t)}`;
  return <section className={`ai-process ${active ? 'is-active' : ''}`} aria-label={t('Research process', '研究过程')}>
    <button className="ai-process-toggle" aria-expanded={open} aria-controls={detailsId} onClick={() => setVisibility(value => ({ ...value, [phase]: !open }))}>
      {active && <span className="ai-process-orb" aria-hidden="true"><WakeOrb compact speed={1.8} /></span>}
      <span className="ai-process-chevron" aria-hidden="true"><MaterialIcon name="chevron_right" size={16}/></span>
      <span className="ai-process-heading">{statusLabel}</span>
      {active && <time className="ai-process-total" aria-hidden="true">{aiDuration(elapsed ?? 0, t)}</time>}
    </button>
    {open && <div className="ai-process-live" id={detailsId}>
      <ol className="ai-process-timeline" aria-label={t('Observed research actions', '已发生的研究步骤')}>{timeline.map(group => <li key={group.id} className={group.active ? 'is-current' : 'was-observed'} aria-current={group.active ? 'step' : undefined}>
        <span className="ai-process-action-dot" aria-hidden="true" />
        <div className="ai-process-step-heading"><span>{researchTimelineLabel(group, presentation.task, t)}</span><time>{aiDuration(group.active ? actionElapsed : Math.max(0, (group.endedElapsed ?? group.startedElapsed) - group.startedElapsed), t)}</time></div>
        {group.updates.length > 3 && <button className="ai-process-earlier" aria-expanded={!!updateVisibility[group.id]} onClick={() => setUpdateVisibility(value => ({ ...value, [group.id]: !value[group.id] }))}>{updateVisibility[group.id]
          ? t('Collapse earlier updates', '收起较早进展') : t('Earlier updates ({count})', '较早进展（{count}）', { count: group.updates.length - 3 })}</button>}
        <div className="ai-process-journal">{(updateVisibility[group.id] ? group.updates : group.updates.slice(-3)).map(update => <output
          className="ai-process-reply" key={update.id}
          aria-live={group.active && update.id === milestone?.id ? 'polite' : 'off'}>
          <time>{aiDuration(update.elapsed, t)}</time><span>{researchMilestoneText(update, t, presentation.task)}</span>
        </output>)}</div>
        {!group.updates.length && <p className="ai-process-reply">{localizeAiSystemText(group.steps.at(-1)?.displayMessage || '', t)}</p>}
        {group.active && <div className="ai-process-update">
        {coverage && coverage.total > 0 && presentation.currentAction === 'full-reading' && <div className="ai-process-coverage"><span className="ai-process-coverage-track" aria-hidden="true"><span style={{ width: `${Math.min(100, coverage.read / coverage.total * 100)}%` }} /></span><span>{t('{read} / {total} passages', '{read} / {total} 段', { read: coverage.read, total: coverage.total })}</span></div>}
        <div className="ai-process-live-meta"><span className="ai-process-breath" aria-hidden="true" /><span>{currentLabel}</span>{quietElapsed >= 25 && <span className="ai-process-wait-note">{t('Waiting for the next result · {duration} since the last update', '正在等待下一步结果 · 距上次进展 {duration}', { duration: aiDuration(quietElapsed, t) })}</span>}</div>
        </div>}
      </li>)}</ol>
      {!presentation.groups.length && <output className="ai-process-reply" aria-live="polite" aria-atomic="true">{reply}</output>}
    </div>}
    {open && <button className="ai-process-records-toggle" aria-expanded={recordsOpen} aria-controls={`${detailsId}-records`} onClick={() => setRecordsOpen(value => !value)}>{recordsOpen ? t('Hide detailed record', '收起详细记录') : t('View detailed record', '查看详细记录')}<span>{t('{count} events', '{count} 条', { count: presentation.steps.length })}</span></button>}
    {open && recordsOpen && <div className="ai-process-details" id={`${detailsId}-records`}>
      {!!presentation.steps.length && timeline.map(group => {
        const groupOpen = groupVisibility[group.id] ?? group.active;
        return <div key={group.id} className={`ai-process-group ${group.active ? 'is-current-group' : ''}`}>
          <button className="ai-process-group-toggle" aria-expanded={groupOpen} onClick={() => setGroupVisibility(value => ({ ...value, [group.id]: !groupOpen }))}><span className="ai-process-chevron" aria-hidden="true"><MaterialIcon name="chevron_right" size={16}/></span><strong>{researchTimelineLabel(group, presentation.task, t)}</strong><span>{t('{count} events', '{count} 条', { count: group.steps.length })}</span><time>{aiDuration(group.startedElapsed, t)}{group.endedElapsed != null ? ` – ${aiDuration(group.endedElapsed, t)}` : ''}</time></button>
          {groupOpen && <ol>{group.steps.map((step, index) => <li key={`${index}:${step.elapsed}`} className={group.active && index === group.steps.length - 1 ? 'is-current-step' : ''}><span aria-hidden="true" className="ai-process-dot" /><p>{localizeAiSystemText(step.displayMessage, t)}</p><time>{aiDuration(step.elapsed, t)}</time></li>)}</ol>}
        </div>;
      })}
      {!presentation.steps.length && <p className="ai-process-legacy">{t('This earlier answer has no saved live process. See the source records below.', '这条历史回答未保存实时过程，可查看下方的来源记录。')}</p>}
      {children}
    </div>}
  </section>;
}
