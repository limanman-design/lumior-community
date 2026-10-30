'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import type { WorkspaceContent } from './workspace-files';
import type { Bibliography } from '../lib/bibliography';

type Options = {
  contents: readonly WorkspaceContent[];
  ready: boolean;
  onResult: (id: string, file: { url: string; size: number }, result: Bibliography) => void;
};

/** Only new imports explicitly marked pending are processed; old libraries stay unchanged. */
export function usePdfBibliography(options: Options) {
  const live = useRef(options);
  useLayoutEffect(() => { live.current = options; }, [options]);
  const tasks = useRef(new Map<string, { controller: AbortController; url: string; size: number }>());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    // Release ownership before scheduling a replacement with the same content ID.
    for (const [id, task] of tasks.current) {
      if (!options.ready || !options.contents.some(item => item.id === id && item.card.pdf?.url === task.url && item.card.pdf?.size === task.size && item.card.bibliography?.status === 'pending')) {
        task.controller.abort();
        tasks.current.delete(id);
      }
    }
    if (!options.ready) return;
    for (const content of options.contents) {
      const card = content.card;
      if (card.kind !== 'pdf' || !card.pdf || card.bibliography?.status !== 'pending' || tasks.current.has(content.id)) continue;
      const file = { url: card.pdf.url, size: card.pdf.size }, controller = new AbortController();
      const task = { ...file, controller };
      tasks.current.set(content.id, task);
      queue.current = queue.current.catch(() => {}).then(async () => {
        const current = () => live.current.contents.find(item => item.id === content.id);
        const stillPending = () => !controller.signal.aborted && live.current.ready && current()?.card.pdf?.url === file.url && current()?.card.pdf?.size === file.size && current()?.card.bibliography?.status === 'pending';
        try {
          if (!stillPending()) return;
          const { readPdfBibliography } = await import('./pdf-bibliography');
          const result = await readPdfBibliography(card, controller.signal);
          if (stillPending()) live.current.onResult(content.id, file, result);
        } catch {
          if (stillPending()) live.current.onResult(content.id, file, { status: 'unavailable', reason: 'network' });
        } finally {
          if (tasks.current.get(content.id) === task) tasks.current.delete(content.id);
        }
      });
    }
  }, [options.contents, options.ready]);
  useEffect(() => () => {
    tasks.current.forEach(task => task.controller.abort());
    tasks.current.clear();
  }, []);
}
