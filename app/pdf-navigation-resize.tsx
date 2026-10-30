'use client';
import { useI18n } from './i18n';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- A focusable window splitter is not a static thematic break. */

import { useLayoutEffect, useRef } from 'react';
import {
  defaultPdfNavigationWidth,
  pdfNavigationSize,
  preferredPdfNavigationWidth,
} from './pdf-navigation-sizing';

const storageKey = 'lumior-pdf-navigation-width';

export function PdfNavigationResize() {
  const { t } = useI18n();
  const handle = useRef<HTMLDivElement>(null);
  const preferred = useRef(defaultPdfNavigationWidth);
  const frame = useRef(0);
  const gesture = useRef<{ pointer: number; x: number; width: number } | null>(
    null,
  );
  const apply = useRef<(width: number) => number>((width) => width);

  useLayoutEffect(() => {
    const divider = handle.current;
    const viewer = divider?.closest<HTMLElement>('.pdf-viewer');
    const paper = viewer?.querySelector<HTMLElement>('.pdf-paper-column');
    const notes = viewer?.querySelector<HTMLElement>('.pdf-reading-notes');
    if (!divider || !viewer || !paper) return;
    try {
      preferred.current = preferredPdfNavigationWidth(
        Number(localStorage.getItem(storageKey)),
      );
    } catch {}
    const original = viewer.style.getPropertyValue('--pdf-navigation-width');
    const update = (width: number) => {
      const style = getComputedStyle(viewer);
      let room =
        viewer.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      const gap = parseFloat(style.columnGap) || 0;
      const noteBounds = notes?.getBoundingClientRect();
      const besidePaper =
        noteBounds &&
        Math.abs(noteBounds.top - paper.getBoundingClientRect().top) < 2;
      if (notes && besidePaper) {
        const noteStyle = getComputedStyle(notes);
        room -=
          noteBounds.width +
          (parseFloat(noteStyle.marginLeft) || 0) +
          (parseFloat(noteStyle.marginRight) || 0) +
          gap;
      }
      const size = pdfNavigationSize(width, room - gap);
      const value = `${size.width}px`;
      if (viewer.style.getPropertyValue('--pdf-navigation-width') !== value)
        viewer.style.setProperty('--pdf-navigation-width', value);
      divider.setAttribute('aria-valuenow', String(size.width));
      divider.setAttribute('aria-valuemin', String(size.min));
      divider.setAttribute('aria-valuemax', String(size.max));
      divider.setAttribute('aria-valuetext', `${size.width}px`);
      return size.width;
    };
    apply.current = update;
    update(preferred.current);
    const observer = new ResizeObserver(() => update(preferred.current));
    observer.observe(viewer);
    if (notes) observer.observe(notes);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame.current);
      gesture.current = null;
      if (original)
        viewer.style.setProperty('--pdf-navigation-width', original);
      else viewer.style.removeProperty('--pdf-navigation-width');
    };
  }, []);

  const save = () => {
    try {
      localStorage.setItem(storageKey, String(preferred.current));
    } catch {}
  };
  const reset = () => {
    preferred.current = defaultPdfNavigationWidth;
    apply.current(preferred.current);
    save();
  };
  return (
    <div
      ref={handle}
      className="pdf-navigation-resizer"
      role="separator"
      aria-valuenow={defaultPdfNavigationWidth}
      aria-valuemin={200}
      aria-valuemax={400}
      aria-label={t('Resize PDF navigation', '调整 PDF 导航宽度')}
      aria-orientation="vertical"
      aria-controls="pdf-navigation-content"
      tabIndex={0}
      title={t(
        'Drag to resize · Double-click to reset to 268px',
        '拖动调整宽度 · 双击恢复 268px',
      )}
      onDoubleClick={reset}
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key))
          return;
        event.preventDefault();
        event.stopPropagation();
        const divider = event.currentTarget;
        const width =
          event.key === 'Home'
            ? Number(divider.getAttribute('aria-valuemin'))
            : event.key === 'End'
              ? Number(divider.getAttribute('aria-valuemax'))
              : Number(divider.getAttribute('aria-valuenow')) +
                (event.key === 'ArrowRight' ? 16 : -16);
        preferred.current = preferredPdfNavigationWidth(apply.current(width));
        save();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        gesture.current = {
          pointer: event.pointerId,
          x: event.clientX,
          width: Number(event.currentTarget.getAttribute('aria-valuenow')),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = 'true';
      }}
      onPointerMove={(event) => {
        const drag = gesture.current;
        if (!drag || drag.pointer !== event.pointerId) return;
        const width = drag.width + event.clientX - drag.x;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          preferred.current = preferredPdfNavigationWidth(apply.current(width));
        });
      }}
      onPointerUp={(event) => {
        const drag = gesture.current;
        if (!drag || drag.pointer !== event.pointerId) return;
        cancelAnimationFrame(frame.current);
        if (event.clientX !== drag.x)
          preferred.current = preferredPdfNavigationWidth(
            apply.current(drag.width + event.clientX - drag.x),
          );
        gesture.current = null;
        delete event.currentTarget.dataset.dragging;
        event.currentTarget.releasePointerCapture(event.pointerId);
        save();
      }}
      onPointerCancel={(event) => {
        if (gesture.current?.pointer !== event.pointerId) return;
        cancelAnimationFrame(frame.current);
        gesture.current = null;
        delete event.currentTarget.dataset.dragging;
      }}
      onLostPointerCapture={(event) => {
        if (gesture.current?.pointer !== event.pointerId) return;
        cancelAnimationFrame(frame.current);
        gesture.current = null;
        delete event.currentTarget.dataset.dragging;
      }}
    />
  );
}
