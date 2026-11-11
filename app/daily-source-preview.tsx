'use client';
/* eslint-disable @next/next/no-img-element -- Workspace images may use local asset URLs; preserve the existing native image path. */
import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { Maximize2 } from 'lucide-react';
import { acquirePdf, openPdf } from './pdf-runtime';
import { PdfPage } from './pdf-sheet';
import { findDailyPdfEvidence, type DailyPdfEvidence } from './daily-pdf-evidence';
import BlockEditor from './block-editor';
import type { Card } from './canvas-model';
import { useI18n } from './i18n';
import './pdf-viewer.css';
import './pdf-citation.css';
const noop = () => {};

function ReadOnlyPdf({ url, initialPage = 1, quote = '' }: { url: string; initialPage?: number; quote?: string }) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>();
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const pages = useRef<HTMLDivElement>(null);
  const interacted = useRef(false);
  const [evidence, setEvidence] = useState<{ pdf: PDFDocumentProxy; quote: string; result?: DailyPdfEvidence }>();
  const [width, setWidth] = useState(400);
  useEffect(() => {
    let live = true;
    const retry = attempt ? openPdf(url) : undefined;
    const resource = retry ? { promise: retry.promise, release: () => { void retry.destroy(); } } : acquirePdf(url);
    resource.promise.then(document => { if (live) { setPdf(document); } }, () => { if (live) setError(true); });
    return () => { live = false; resource.release(); };
  }, [url, attempt]);
  useEffect(() => {
    if (!root.current) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(160, (root.current?.clientWidth || 400) + 24)));
    observer.observe(root.current); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!pdf) return;
    const controller = new AbortController();
    void findDailyPdfEvidence(pdf, quote, initialPage, controller.signal).then(result => {
      if (!controller.signal.aborted) setEvidence({ pdf, quote, result });
    });
    return () => controller.abort();
  }, [pdf, quote, initialPage]);
  const match = evidence && evidence.pdf === pdf && evidence.quote === quote ? evidence.result : undefined;
  useEffect(() => { interacted.current = false; }, [pdf, quote]);
  useEffect(() => {
    const container = root.current, content = pages.current;
    if (!container || !content || !pdf) return;
    const focus = () => {
      if (interacted.current) return;
      const number = match?.page || Math.max(1, Math.min(initialPage, pdf.numPages));
      const sheet = content.querySelector<HTMLElement>(`[data-pdf-page="${number}"]`);
      if (!sheet) return;
      const box = sheet.getBoundingClientRect(), viewport = container.getBoundingClientRect();
      const y = match?.location.stops[0]?.y || 0;
      container.scrollTo({ top: Math.max(0, container.scrollTop + box.top - viewport.top + box.height * y / 100 - (match ? container.clientHeight * .32 : 16)) });
    };
    const observer = new ResizeObserver(focus);
    observer.observe(content); observer.observe(container); focus();
    return () => observer.disconnect();
  }, [pdf, match, initialPage]);
  return <div className="daily-source-pdf">
    <div className="daily-source-scroll" ref={root} onWheel={() => { interacted.current = true; }} onPointerDown={() => { interacted.current = true; }} onTouchStart={() => { interacted.current = true; }}>
      {pdf ? <div className="daily-source-pdf-pages" ref={pages}>{Array.from({ length: pdf.numPages }, (_, index) => <PdfPage key={index + 1} pdf={pdf} number={index + 1} width={width} zoom={1} rasterZoom={1} hits={[]} root={root} marks={[]} evidenceRects={match?.page === index + 1 ? match.location.rects : undefined} onMarkDown={noop} onMarkMove={noop} onMarkUp={noop} />)}</div> : <output className="daily-preview-empty">{error ? <>{t('Could not load PDF', 'PDF 加载失败')} <button type="button" onClick={() => { setError(false); setAttempt(value => value + 1); }}>{t('Retry', '重试')}</button></> : t('Loading PDF…', '正在加载 PDF…')}</output>}
    </div>
  </div>;
}

export function DailySourcePreview({ card, page, quote, onOpen }: { card: Card; page?: number; quote?: string; onOpen: () => void }) {
  const { t } = useI18n();
  if (card.pdf) return <ReadOnlyPdf key={card.pdf.url} url={card.pdf.url} initialPage={page} quote={quote} />;
  if (card.kind === 'note' || card.kind === 'text') return <div className="daily-source-document"><h2>{card.title}</h2><BlockEditor key={card.id} card={card} editable={false} sourceControls={false} /></div>;
  return <div className="daily-source-media">{(card.image || card.video?.poster) && <img src={card.image || card.video?.poster} alt={card.title} />}<h2>{card.title}</h2>{card.body && <p>{card.body}</p>}<button type="button" onClick={onOpen}><Maximize2 size={16} />{t('Open content', '打开内容')}</button></div>;
}
