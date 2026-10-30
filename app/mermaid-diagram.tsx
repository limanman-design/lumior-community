'use client';
import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { subscribeLanguage, translate } from './i18n-core.ts';
import { useI18n } from './i18n';

let queue: Promise<unknown> = Promise.resolve();
let sequence = 0;
// Mermaid has shared renderer state: serialize jobs, and load it only when needed.
export function mountMermaid(host: HTMLElement, source: string) {
  let disposed = false;
  host.classList.add('mermaid-diagram');
  const updateNotice = () => {
    if (disposed) return;
    if (host.dataset.state === 'loading')
      host.textContent = translate('Loading diagram…', '正在加载图表…');
    else if (host.dataset.state === 'error')
      host.textContent = translate(
        'Diagram could not be rendered. Check the Mermaid source.',
        '图表无法显示，请检查 Mermaid 源码。',
      );
  };
  host.dataset.state = 'loading';
  updateNotice();
  const unsubscribe = subscribeLanguage(updateNotice);
  const job = async () => {
    if (disposed) return;
    try {
      const { default: mermaid } = await import('mermaid');
      if (disposed) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        theme: 'dark',
        suppressErrorRendering: true,
        themeVariables: {
          primaryColor: '#25263f',
          primaryBorderColor: '#5259E2',
          lineColor: '#898ba8',
          fontFamily: 'Arial, sans-serif',
        },
        secure: [
          'secure',
          'securityLevel',
          'startOnLoad',
          'maxTextSize',
          'suppressErrorRendering',
        ],
      });
      const { svg } = await mermaid.render(
        `lumior-diagram-${++sequence}`,
        source,
      );
      if (!disposed) {
        host.innerHTML = DOMPurify.sanitize(svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
        });
        host.dataset.state = 'ready';
      }
    } catch {
      if (!disposed) {
        host.dataset.state = 'error';
        updateNotice();
      }
    }
  };
  queue = queue.then(job, job);
  return () => {
    disposed = true;
    unsubscribe();
  };
}
export function MermaidDiagram({ source }: { source: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) return mountMermaid(ref.current, source);
  }, [source]);
  return (
    <div
      ref={ref}
      className="mermaid-diagram"
      aria-label={t('Mermaid diagram', 'Mermaid 图表')}
    />
  );
}
