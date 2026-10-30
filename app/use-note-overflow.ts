'use client';

import { useEffect, type RefObject } from 'react';
import './note-overflow.css';

/** A visual hint only: never change the document, selection or card geometry. */
export function useNoteOverflow(article: RefObject<HTMLElement | null>, enabled: boolean) {
  useEffect(() => {
    const card = article.current;
    const scroll = card?.querySelector<HTMLElement>(':scope > .card-scroll');
    if (!card || !scroll || !enabled) return;
    let frame = 0;
    const observed = new Set<Element>();
    const resize = new ResizeObserver(schedule);

    function measure() {
      frame = 0;
      if (!card || !scroll) return;
      const title = scroll.querySelector<HTMLElement>('.card-title-wrap');
      const group = scroll.querySelector<HTMLElement>('.bn-editor > .bn-block-group');
      const targets = [scroll, title, group].filter((node): node is HTMLElement => !!node);
      for (const node of observed) {
        if (!targets.includes(node as HTMLElement)) { resize.unobserve(node); observed.delete(node); }
      }
      for (const node of targets) {
        if (!observed.has(node)) { resize.observe(node); observed.add(node); }
      }

      // Editor min-height and its trailing "add a paragraph" widget are empty
      // writing space. Measure actual blocks instead of scrollHeight.
      const blocks = group?.querySelectorAll<HTMLElement>(':scope > .bn-block-outer');
      const lastBlock = Array.from(blocks ?? []).findLast(block => {
        const content = block.querySelector<HTMLElement>('.bn-block-content');
        const emptyParagraph = content?.dataset.contentType === 'paragraph'
          && !block.textContent?.replace(/[\u200b-\u200d\ufeff]/g, '').trim()
          && !block.querySelector('img,video,audio,iframe,svg,canvas,table,hr,[data-inline-content-type]');
        return !emptyParagraph;
      });
      const viewport = scroll.getBoundingClientRect();
      const scale = scroll.offsetHeight ? viewport.height / scroll.offsetHeight : 0;
      const visibleBottom = viewport.top + (scroll.clientTop + scroll.clientHeight) * scale;
      const contentBottom = Math.max(title?.getBoundingClientRect().bottom ?? 0, lastBlock?.getBoundingClientRect().bottom ?? 0);
      const overflow = scale > 0 && contentBottom > visibleBottom + scale;
      if (card.hasAttribute('data-note-overflow') !== overflow) card.toggleAttribute('data-note-overflow', overflow);
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(measure);
    }

    // Dynamic editor loading, block updates and embedded media can all change
    // the preview without changing the card's own dimensions.
    const mutation = new MutationObserver(schedule);
    mutation.observe(scroll, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    scroll.addEventListener('scroll', schedule, { passive: true });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      scroll.removeEventListener('scroll', schedule);
      card.removeAttribute('data-note-overflow');
    };
  }, [article, enabled]);
}
