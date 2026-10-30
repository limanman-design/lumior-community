'use client';
import { useI18n } from './i18n';
import { translate as t, translateSystemMessage } from './i18n-core';

import { useEffect, useState } from 'react';
import { LumiorSplitLoader } from '@/components/ui/lumior-split-loader';
import './workspace-loading.css';

export function WorkspaceLoading({ ready, error, onRetry }: {
  ready: boolean;
  error?: string;
  onRetry: () => void;
}) {
 useI18n();
  const [finished, setFinished] = useState(false);
  const [minimumElapsed, setMinimumElapsed] = useState(false);
  const canExit = ready && minimumElapsed && !error;

  useEffect(() => {
    const timeout = window.setTimeout(() => setMinimumElapsed(true), 3000);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!canExit) return;
    // Data loads in parallel; exit once both hydration and the minimum display finish.
    const timeout = window.setTimeout(() => setFinished(true), 240);
    return () => window.clearTimeout(timeout);
  }, [canExit]);

  if (finished) return null;

  return <div
    className={`workspace-loading${canExit ? ' is-ready' : ''}${error ? ' has-error' : ''}`}
    onAnimationEnd={event => {
      if (canExit && event.target === event.currentTarget && event.animationName === 'workspace-loading-exit') setFinished(true);
    }}
  >
    <LumiorSplitLoader variant="splash" size={200} label="Lumior" />
    {error ? <div className="workspace-loading-error" role="alert">
      <strong>{t("Unable to read local data", "无法读取本地资料")}</strong>
      <p>{translateSystemMessage(error)}</p>
      <button onClick={onRetry}>{t("Reopen", "重新打开")}</button>
    </div> : <output className="workspace-loading-label" aria-live="polite">{t("Loading whiteboard…", "正在加载画板…")}</output>}
  </div>;
}
