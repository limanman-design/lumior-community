'use client';
import { useEffect } from 'react';
import type { Card } from './canvas-model';

function thinScrollbarWidth() {
  const probe = document.createElement('div');
  probe.className = 'pdf-page-area';
  probe.style.cssText = 'position:fixed;left:-10000px;width:100px;height:100px;padding:0;border:0;overflow:scroll;visibility:hidden;pointer-events:none';
  document.body.appendChild(probe);
  const width = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return width;
}

function sidebarReaderWidth() {
  const shell = document.querySelector<HTMLElement>('.workspace-shell'),
    stage = document.querySelector<HTMLElement>('.workspace-stage');
  if (!shell || !stage) return 400;
  const board = stage.getBoundingClientRect(),
    ai = document
      .querySelector<HTMLElement>('.ai-panel.ai-sidebar[data-state="open"]')
      ?.getBoundingClientRect(),
    right = ai ? ai.left - 8 : board.right - 8,
    reserve =
      parseFloat(
        getComputedStyle(shell).getPropertyValue('--canvas-tools-reserve'),
      ) || (ai ? 136 : 192),
    available = Math.max(80, right - board.left - reserve - 8);
  let preference = 640;
  try {
    const stored = Number(localStorage.getItem('lumior-pdf-panel-width'));
    if (stored > 0 && Number.isFinite(stored)) preference = stored;
  } catch {
    /* Preparation is optional when browser preferences are unavailable. */
  }
  const max = Math.min(1200, innerWidth * 0.5, available),
    pane = Math.round(Math.min(max, Math.max(Math.min(360, max), preference)));
  // Match ResizeObserver's content box, including the platform's actual
  // thin scrollbar gutter rather than guessing its CSS-pixel width.
  return Math.max(80, pane - 46 - thinScrollbarWidth());
}

function waitForIdle(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    let idle: number | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = () => {
      if (idle !== undefined) cancelIdleCallback(idle);
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    if (signal.aborted) return abort();
    signal.addEventListener('abort', abort, { once: true });
    if (typeof requestIdleCallback === 'function')
      idle = requestIdleCallback(finish, { timeout: 700 });
    else timer = setTimeout(finish, 40);
  });
}

async function warmPdf(card: Card, signal: AbortSignal) {
  if (!card.pdf || card.pdf.size > 50_000_000) return;
  await waitForIdle(signal);
  // Warm the same lazy reader module that opening either reading mode uses.
  const [, runtime, paint] = await Promise.all([
    import('./pdf-viewer'),
    import('./pdf-runtime'),
    import('./pdf-page-paint'),
  ]);
  if (signal.aborted) return;
  const handle = runtime.acquirePdf(card.pdf.url);
  try {
    const pdf = await handle.promise;
    if (signal.aborted) return;
    const width = sidebarReaderWidth(),
      token = Symbol('pdf-intent');
    for (let number = 1; number <= Math.min(2, pdf.numPages); number++) {
      await waitForIdle(signal);
      await paint.preparePdfPage(pdf, number, width, 1, {
        signal,
        priority: () => 4,
        warm: token,
      });
    }
  } finally {
    handle.release();
  }
}

// One delegated listener serves canvas PDF cards. Brief pointer crossings,
// removed/changed cards and another selected document cancel pending work.
export function usePdfPrewarmIntent(
  cards: readonly Card[],
  selectedIds: readonly string[],
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;
    const pdfs = new Map(
      cards
        .filter((card) => card.kind === 'pdf' && card.pdf)
        .map((card) => [card.id, card]),
    );
    const selected =
      selectedIds.length === 1 ? pdfs.get(selectedIds[0]) : undefined;
    let hovered: Card | undefined,
      current: string | undefined,
      controller: AbortController | undefined,
      timer: ReturnType<typeof setTimeout> | undefined;
    const choose = () => {
      const candidate = hovered || selected;
      if (candidate?.id === current) return;
      current = candidate?.id;
      clearTimeout(timer);
      controller?.abort();
      if (!candidate) return;
      const next = new AbortController();
      controller = next;
      timer = setTimeout(() => {
        void warmPdf(candidate, next.signal).catch(() => {});
      }, 220);
    };
    const cardAt = (target: EventTarget | null) =>
      target instanceof Element
        ? target.closest<HTMLElement>('[data-card-id]')
        : null;
    const over = (event: PointerEvent | FocusEvent) => {
      const node = cardAt(event.target);
      if (!node || node === cardAt(event.relatedTarget)) return;
      hovered = pdfs.get(node.dataset.cardId || '');
      choose();
    };
    const out = (event: PointerEvent | FocusEvent) => {
      const node = cardAt(event.target);
      if (!node || node === cardAt(event.relatedTarget)) return;
      hovered = pdfs.get(cardAt(event.relatedTarget)?.dataset.cardId || '');
      choose();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', over);
    document.addEventListener('focusout', out);
    choose();
    return () => {
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', over);
      document.removeEventListener('focusout', out);
    };
  }, [cards, selectedIds, enabled]);
}
