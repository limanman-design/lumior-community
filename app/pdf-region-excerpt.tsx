'use client';
/* oxlint-disable next/no-img-element -- Bundled PDF toolbar SVG artwork. */
import { useI18n } from './i18n';
import { pdfSystemMessage } from './pdf-system-messages';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from './canvas-model';
import { usePdfAnnotations, type PdfMark } from './pdf-annotations';
import { PdfAnnotationEditor } from './pdf-annotation-editor';

type Selection = {
  page: HTMLElement;
  x: number;
  y: number;
  w: number;
  h: number;
};
export function PdfRegionExcerpt({
  area,
  card,
}: {
  area: RefObject<HTMLDivElement | null>;
  card: Card;
}) {
  const { t } = useI18n();
  const store = usePdfAnnotations();
  const [active, setActive] = useState(false),
    [selection, setSelection] = useState<Selection | null>(null),
    [anchor, setAnchor] = useState({ x: 0, y: 0 }),
    [note, setNote] = useState(''),
    [drawing, setDrawing] = useState(false),
    [status, setStatus] = useState('');
  const current = useRef<Selection | null>(null);
  useEffect(() => {
    const root = area.current;
    if (!root || !active) return;
    root.classList.add('pdf-region-mode');
    let start: {
      page: HTMLElement;
      x: number;
      y: number;
      pointer: number;
    } | null = null;
    const point = (e: PointerEvent, page: HTMLElement) => {
      const r = page.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
        y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
      };
    };
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const page = (e.target as HTMLElement).closest<HTMLElement>(
        '[data-pdf-page]',
      );
      if (!page) return;
      e.preventDefault();
      e.stopPropagation();
      window.getSelection()?.removeAllRanges();
      start = { page, ...point(e, page), pointer: e.pointerId };
      setDrawing(true);
      setSelection(null);
      current.current = null;
      setNote('');
      setStatus('');
      root.setPointerCapture(e.pointerId);
    };
    const move = (e: PointerEvent) => {
      if (!start) return;
      e.preventDefault();
      e.stopPropagation();
      const p = point(e, start.page);
      const next = {
        page: start.page,
        x: Math.min(start.x, p.x),
        y: Math.min(start.y, p.y),
        w: Math.abs(p.x - start.x),
        h: Math.abs(p.y - start.y),
      };
      current.current = next;
      setSelection(next);
    };
    const up = (e: PointerEvent) => {
      if (!start) return;
      e.preventDefault();
      e.stopPropagation();
      move(e);
      if (root.hasPointerCapture(e.pointerId))
        root.releasePointerCapture(e.pointerId);
      start = null;
      setDrawing(false);
      setAnchor({ x: e.clientX, y: e.clientY });
      const s = current.current;
      if (!s || s.w < 0.5 || s.h < 0.5) {
        current.current = null;
        setSelection(null);
      } else setStatus('');
    };
    const cancel = () => {
      start = null;
      setDrawing(false);
      current.current = null;
      setSelection(null);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setActive(false);
        cancel();
      }
    };
    root.addEventListener('pointerdown', down, true);
    root.addEventListener('pointermove', move, true);
    root.addEventListener('pointerup', up, true);
    root.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', escape, true);
    return () => {
      root.classList.remove('pdf-region-mode');
      root.removeEventListener('pointerdown', down, true);
      root.removeEventListener('pointermove', move, true);
      root.removeEventListener('pointerup', up, true);
      root.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', escape, true);
    };
  }, [active, area]);
  const save = () => {
    const s = current.current;
    if (!s || !card.pdf) return;
    try {
      const source = s.page.querySelector<HTMLCanvasElement | HTMLImageElement>(
        'canvas, img.pdf-prerendered-page',
      );
      if (!source)
        throw Error(
          t(
            'This page is still loading. Try again shortly.',
            '该页还在加载，请稍后重试',
          ),
        );
      const sw =
          source instanceof HTMLImageElement
            ? source.naturalWidth
            : source.width,
        sh =
          source instanceof HTMLImageElement
            ? source.naturalHeight
            : source.height;
      if (!sw || !sh)
        throw Error(
          t(
            'This page is still loading. Try again shortly.',
            '该页还在加载，请稍后重试',
          ),
        );
      const output = document.createElement('canvas');
      output.width = Math.max(1, Math.round((sw * s.w) / 100));
      output.height = Math.max(1, Math.round((sh * s.h) / 100));
      const ctx = output.getContext('2d');
      if (!ctx)
        throw Error(t('Could not create the screenshot.', '无法创建截图'));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, output.width, output.height);
      ctx.drawImage(
        source,
        (sw * s.x) / 100,
        (sh * s.y) / 100,
        (sw * s.w) / 100,
        (sh * s.h) / 100,
        0,
        0,
        output.width,
        output.height,
      );
      const n = Number(s.page.dataset.pdfPage),
        mark: PdfMark = {
          id: crypto.randomUUID(),
          text: t(
            '{title} · Page {page} region excerpt',
            '{title} · 第 {page} 页区域摘录',
            { title: card.title, page: n },
          ),
          note: note.trim(),
          image: output.toDataURL('image/png'),
          color: '#b6c391',
          fragments: [
            { page: n, rects: [{ x: s.x, y: s.y, width: s.w, height: s.h }] },
          ],
        };
      if (s.page.closest('.pdf-layout-expanded')) {
        store.save(card.pdf.url, mark);
        setSelection(null);
        current.current = null;
        setNote('');
        setActive(false);
        setStatus(t('Saved to PDF notes.', '已保存到 PDF 笔记'));
        return;
      }
      const canvas = document.querySelector<HTMLElement>('.workspace .canvas');
      const r = canvas?.getBoundingClientRect();
      if (!r || r.width < 1 || !s.page.closest('aside'))
        throw Error(
          t(
            'Return to the whiteboard and save the excerpt from the PDF sidebar.',
            '请返回画板，在 PDF 侧栏中保存摘录',
          ),
        );
      // Put the card in the visible canvas, outside the docked reader.
      const panel = s.page.closest('aside')?.getBoundingClientRect();
      const right = Math.min(r.right, panel?.left ?? r.right);
      if (right - r.left < 30)
        throw Error(
          t(
            'Narrow the PDF sidebar to leave room for an excerpt card.',
            '请收窄 PDF 侧栏，留出放置卡片的画板空间',
          ),
        );
      store.drop(card, mark, {
        clientX: r.left + (right - r.left) * 0.35,
        clientY: r.top + r.height * 0.3,
      });
      store.save(card.pdf.url, mark);
      setSelection(null);
      current.current = null;
      setNote('');
      setActive(false);
      setStatus(
        t(
          'Excerpt card saved. Use its toolbar to return to the source.',
          '已保存区域摘录卡，可从卡片工具栏返回原文',
        ),
      );
    } catch (e) {
      setStatus(
        e instanceof Error
          ? e.message
          : t('Screenshot failed. Try again.', '截图失败，请重试'),
      );
    }
  };
  return (
    <>
      <div className="pdf-region-tools">
        <button
          aria-label={t('PDF region excerpt', 'PDF 区域摘录')}
          title={t('Region excerpt', '区域摘录')}
          aria-pressed={active}
          onClick={() => {
            setActive(!active);
            setSelection(null);
            current.current = null;
            setStatus('');
          }}
        >
          <img src="/assets/pdf-toolbar/select.svg" alt="" />
        </button>
        {active && !selection && (
          <span>
            {t(
              'Drag to select an image or formula · Esc to cancel',
              '拖动框选图片或公式 · Esc 取消',
            )}
          </span>
        )}
        {status && !active && (
          <output>{pdfSystemMessage(status)}</output>
        )}
      </div>
      {active && selection && !drawing && (
        createPortal(
          <PdfAnnotationEditor
            anchor={anchor}
            note={note}
            onNoteChange={setNote}
            allowEmpty
            onSave={save}
            onDelete={() => {
              setSelection(null);
              current.current = null;
              setNote('');
              setStatus('');
              setActive(false);
            }}
            status={pdfSystemMessage(status)}
          />,
          document.body,
        )
      )}
      {selection &&
        createPortal(
          <div
            className="pdf-region-selection"
            style={{
              left: `${selection.x}%`,
              top: `${selection.y}%`,
              width: `${selection.w}%`,
              height: `${selection.h}%`,
            }}
          />,
          selection.page,
        )}
    </>
  );
}
