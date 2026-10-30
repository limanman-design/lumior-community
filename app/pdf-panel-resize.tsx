'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This vertical separator is an interactive pointer/keyboard resize handle. */
import { useI18n } from './i18n';
import { useLayoutEffect, useRef } from 'react';

/** Resize only the reader; keep its right edge docked beside the AI panel. */
export function PdfPanelResize() {
  const { t } = useI18n();
  const handle = useRef<HTMLDivElement>(null),
    preferred = useRef(640),
    frame = useRef(0);
  const apply = useRef<(width: number) => void>(() => {});
  useLayoutEffect(() => {
    const panel = handle.current?.closest<HTMLElement>('.canvas-side-panel') ?? handle.current?.parentElement;
    if (!panel) return;
    const stage = panel.closest('.workspace-shell')?.querySelector<HTMLElement>('.workspace-stage');
    try {
      const saved = Number(localStorage.getItem('lumior-pdf-panel-width'));
      if (saved > 0) preferred.current = saved;
    } catch {}
    const originalWidth = panel.style.width;
    const update = (width: number) => {
      const right = parseFloat(getComputedStyle(panel).right) || 0;
      const reserve = parseFloat(getComputedStyle(panel).getPropertyValue('--canvas-tools-reserve')) || 192;
      const available = Math.max(80, window.innerWidth - right - (stage?.getBoundingClientRect().left ?? 0) - reserve - 8);
      const max = Math.min(
          1200,
          window.innerWidth * 0.5,
          available,
      );
      const min = Math.min(360, max),
        value = Math.round(Math.max(min, Math.min(max, width)));
      panel.style.width = `${value}px`;
      handle.current?.setAttribute('aria-valuenow', String(value));
      handle.current?.setAttribute('aria-valuemin', String(Math.round(min)));
      handle.current?.setAttribute('aria-valuemax', String(Math.round(max)));
    };
    apply.current = update;
    update(preferred.current);
    const resized = () => update(preferred.current);
    const observer = new MutationObserver(resized);
    observer.observe(panel, { attributes: true, attributeFilter: ['class'] });
    const topology = new MutationObserver(resized);
    if (panel.parentElement) topology.observe(panel.parentElement, { childList: true });
    const stageObserver = new ResizeObserver(resized);
    if (stage) stageObserver.observe(stage);
    const docked = (event: TransitionEvent) => {
      if (event.target === panel && event.propertyName === 'right') resized();
    };
    panel.addEventListener('transitionend', docked);
    window.addEventListener('resize', resized);
    return () => {
      cancelAnimationFrame(frame.current);
      observer.disconnect();
      topology.disconnect();
      stageObserver.disconnect();
      panel.removeEventListener('transitionend', docked);
      window.removeEventListener('resize', resized);
      panel.style.width = originalWidth;
    };
  }, []);
  const save = () => {
    try {
      localStorage.setItem('lumior-pdf-panel-width', String(preferred.current));
    } catch {}
  };
  return (
    <div
      ref={handle}
      className="pdf-panel-resizer"
      role="separator"
      aria-label={t('Resize PDF sidebar', '调整 PDF 侧栏宽度')}
      aria-orientation="vertical"
      tabIndex={0}
      title={t(
        'Drag to resize · Double-click to reset',
        '拖动调整宽度 · 双击恢复默认',
      )}
      onDoubleClick={() => {
        preferred.current = 640;
        apply.current(640);
        save();
      }}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const el = e.currentTarget;
        preferred.current =
          e.key === 'Home'
            ? Number(el.getAttribute('aria-valuemin'))
            : e.key === 'End'
              ? Number(el.getAttribute('aria-valuemax'))
              : Number(el.getAttribute('aria-valuenow')) +
                (e.key === 'ArrowLeft' ? 32 : -32);
        apply.current(preferred.current);
        save();
      }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.dataset.dragging = 'true';
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const right =
          (e.currentTarget.closest('.canvas-side-panel') ?? e.currentTarget.parentElement)!.getBoundingClientRect().right;
        preferred.current = Math.max(240, right - e.clientX);
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() =>
          apply.current(preferred.current),
        );
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          cancelAnimationFrame(frame.current);
          apply.current(preferred.current);
          preferred.current = Number(
            e.currentTarget.getAttribute('aria-valuenow'),
          );
          e.currentTarget.releasePointerCapture(e.pointerId);
          save();
        }
        delete e.currentTarget.dataset.dragging;
      }}
      onLostPointerCapture={(e) => {
        delete e.currentTarget.dataset.dragging;
      }}
    />
  );
}
