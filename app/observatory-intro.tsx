'use client';
import { useI18n } from './i18n';
import { translate as t } from './i18n-core';
import { useCallback, useEffect, useRef } from 'react';
import type { Board } from './canvas-model';
import { LoadingMark } from './loading-mark';
import './workspace-loading.css';
import './observatory-intro.css';

export function ObservatoryIntro({
  onStart,
}: {
  boards: Board[];
  onStart: () => void;
}) {
 useI18n();
  const started = useRef(false);
  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    onStart();
  }, [onStart]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key === 'Enter' &&
        !event.defaultPrevented &&
        !event.repeat &&
        !event.isComposing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !(
          event.target instanceof HTMLElement &&
          event.target.closest(
            'button,input,textarea,[contenteditable=true],[role=dialog]',
          )
        )
      ) {
        event.preventDefault();
        start();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [start]);

  return (
    <section className="observatory-intro" aria-label={t("Observatory introduction", "Observatory 探索序章")}>
      <header className="observatory-topline">{t('OBSERVATORY','观测站')}</header>
      <div className="observatory-story">
        <div className="observatory-brand">
          <LoadingMark />
        </div>
        <button
          className="observatory-start"
          onClick={start}
          aria-label={t("Press Enter to begin", "按回车开始")}
        >
          <span>{t("Press", "按")}</span>
          <kbd>
            Enter <span aria-hidden="true">↵</span>
          </kbd>
          <span>{t("to begin", "开始")}</span>
        </button>
      </div>
    </section>
  );
}
