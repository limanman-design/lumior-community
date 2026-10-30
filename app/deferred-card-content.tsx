'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createDeferredContentQueue } from './deferred-content-queue';
import { useI18n } from './i18n';
import './deferred-card-content.css';

const enqueue = createDeferredContentQueue(callback => requestAnimationFrame(callback), id => cancelAnimationFrame(id));
// Weak keys keep this a session-only measurement cache, never workspace data.
const canvasHeights = new WeakMap<object, number>();

/** Retain the full editor after first visibility, including its live selection.
 * Unmeasured auto-height canvas notes mount immediately: their real dimensions
 * are needed by fit/connection/selection geometry. Subsequent visits can defer
 * with the exact measured body height; fixed-height notes are safe on first load.
 */
export function DeferredCardContent({ children, eager = false, surface, geometryKey, fixedHeight = false }: {
  children: () => ReactNode;
  eager?: boolean;
  surface: 'canvas' | 'sidebar';
  geometryKey?: object;
  fixedHeight?: boolean;
}) {
  const { t } = useI18n();
  const cachedHeight = geometryKey ? canvasHeights.get(geometryKey) : undefined;
  const [ready, setReady] = useState(() => eager || (surface === 'canvas' && !fixedHeight && cachedHeight === undefined));
  if (eager && !ready) setReady(true);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = element.current;
    if (!node || ready) return;
    let cancel: (() => void) | undefined;
    // A newly opened drawer should not sit behind a zoomed-out board's queue.
    const queue = () => { cancel ??= enqueue(() => { cancel = undefined; setReady(true); }, surface === 'sidebar' ? 1 : 0); };
    if (typeof IntersectionObserver === 'undefined') { queue(); return () => cancel?.(); }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) queue();
      else { cancel?.(); cancel = undefined; }
    }, { root: node.closest(surface === 'sidebar' ? '.information-sidebar-scroll' : '.canvas'), rootMargin: '160px' });
    observer.observe(node);
    return () => { observer.disconnect(); cancel?.(); };
  }, [ready, surface]);
  useEffect(() => {
    const node = element.current;
    if (!ready || !node || surface !== 'canvas') return;
    const measure = () => {
      // The dynamic import can briefly render its loading paragraph. Only cache
      // a real editor measurement, otherwise a later tab visit would shrink it.
      if (geometryKey && node.querySelector('.bn-editor') && node.offsetHeight > 0) canvasHeights.set(geometryKey, node.offsetHeight);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [ready, surface, geometryKey]);
  return <div ref={element} className="deferred-card-content" data-deferred-content={ready ? 'ready' : 'pending'} data-deferred-surface={surface}
    style={ready ? undefined : { height: cachedHeight ?? (surface === 'sidebar' ? 240 : 100) }}
    onPointerDownCapture={() => { if (!ready) flushSync(() => setReady(true)); }}>
    {ready ? children() : <span className="deferred-card-content-label">{t('Opening note…', '正在打开笔记…')}</span>}
  </div>;
}
