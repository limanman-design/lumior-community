'use client';
/* oxlint-disable next/no-img-element -- PDF thumbnails are rendered locally rather than served as image assets. */
import { useI18n } from './i18n';
import { translate as tr } from './i18n-core';
import { pdfSystemMessage } from './pdf-system-messages';

import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { PdfNavigationResize } from './pdf-navigation-resize';
import { pdfRenderScheduler } from './pdf-render-scheduler';

export function PdfReadingIcon({
  name,
  collapsed = false,
}: {
  name: 'edit' | 'expand-more' | 'add';
  collapsed?: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`pdf-reading-icon ${collapsed ? 'pdf-chevron-closed' : ''}`}
      style={{
        maskImage: `url('/assets/material-symbols/${name}-outlined.svg')`,
      }}
    />
  );
}

type Outline = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>;
const thumbnails = new WeakMap<PDFDocumentProxy, Map<number, string>>();

export function PdfPageControl({
  page,
  total,
  onPage,
}: {
  page: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  const [entry, setEntry] = useState({ page, value: String(page) });
  const editedPage = useRef<number | undefined>(undefined);
  const draft = entry.page === page ? entry.value : String(page);
  const submit = (explicit = false) => {
    const edited = editedPage.current === page && entry.page === page;
    // Enter and blur can run before another render. Consume the edit first so
    // leaving the field cannot repeat a page jump after the reader scrolls.
    editedPage.current = undefined;
    if (!explicit && !edited) return;
    const value = Number(draft);
    if (Number.isInteger(value) && value > 0) {
      const target = Math.min(total, value);
      setEntry({ page: target, value: String(target) });
      onPage(target);
    } else setEntry({ page, value: String(page) });
  };
  return (
    <label className="pdf-page-count">
      <input
        aria-label={t('Go to PDF page', '跳转到 PDF 页码')}
        inputMode="numeric"
        value={draft}
        onChange={(event) => {
          editedPage.current = page;
          setEntry({ page, value: event.target.value });
        }}
        onBlur={() => submit()}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            submit(true);
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            editedPage.current = undefined;
            setEntry({ page, value: String(page) });
          }
        }}
      />
      <span>/ {total}</span>
    </label>
  );
}

function Thumbnail({
  pdf,
  number,
  selected,
  root,
  onSelect,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  selected: boolean;
  root: React.RefObject<HTMLDivElement | null>;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  const button = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  const [image, setImage] = useState(thumbnails.get(pdf)?.get(number));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setNear(entry.isIntersecting),
      { root: root.current, rootMargin: '160px' },
    );
    if (button.current) observer.observe(button.current);
    return () => observer.disconnect();
  }, [root]);
  useEffect(() => {
    if (!near || image || failed) return;
    let live = true;
    let task: RenderTask | undefined;
    const controller = new AbortController();
    void pdfRenderScheduler
      .schedule(
        () => 3,
        async () => {
          const page = await pdf.getPage(number);
          if (!live) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: 180 / base.width });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          task = page.render({ canvas, viewport });
          task.onContinue = (resume: () => void) =>
            setTimeout(() => {
              if (live) resume();
            }, 0);
          await task.promise;
          if (!live) return;
          const source = canvas.toDataURL('image/jpeg', 0.72);
          let cache = thumbnails.get(pdf);
          if (!cache) {
            cache = new Map();
            thumbnails.set(pdf, cache);
          }
          cache.set(number, source);
          // Large documents do not keep hundreds of thumbnail images in memory.
          if (cache.size > 80) cache.delete(cache.keys().next().value!);
          setImage(source);
        },
        controller.signal,
      )
      .catch((error) => {
        if (
          live &&
          error.name !== 'RenderingCancelledException' &&
          error.name !== 'AbortError'
        )
          setFailed(true);
      });
    return () => {
      live = false;
      controller.abort();
      task?.cancel();
    };
  }, [near, pdf, number, image, failed]);
  return (
    <button
      ref={button}
      className="pdf-thumbnail"
      aria-label={t('Go to PDF page {page}', '跳转到 PDF 第 {page} 页', {
        page: number,
      })}
      aria-current={selected ? 'page' : undefined}
      onClick={onSelect}
    >
      <span className="pdf-thumbnail-paper">
        {image ? (
          <img
            src={image}
            alt={t('Page {page}', '第 {page} 页', { page: number })}
          />
        ) : (
          <span>
            {failed ? t('Preview unavailable', '预览不可用') : number}
          </span>
        )}
      </span>
      <span>{number}</span>
    </button>
  );
}

function OutlineBranch({
  items,
  onSelect,
}: {
  items: Outline;
  onSelect: (item: Outline[number]) => void;
}) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  return (
    <ul className="pdf-outline-tree">
      {items.map((item, index) => (
        <li key={index}>
          <div>
            {item.items?.length > 0 ? (
              <button
                className="pdf-outline-toggle"
                aria-label={t('Toggle {title}', '展开或收起 {title}', {
                  title: item.title,
                })}
                aria-expanded={!collapsed.has(index)}
                onClick={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(index)) next.delete(index);
                    else next.add(index);
                    return next;
                  })
                }
              >
                <PdfReadingIcon
                  name="expand-more"
                  collapsed={collapsed.has(index)}
                />
              </button>
            ) : (
              <span className="pdf-outline-toggle" />
            )}
            <button
              className="pdf-outline-link"
              disabled={!item.dest}
              onClick={() => onSelect(item)}
            >
              {item.title || t('Untitled', '未命名')}
            </button>
          </div>
          {!!item.items?.length && !collapsed.has(index) && (
            <OutlineBranch items={item.items} onSelect={onSelect} />
          )}
        </li>
      ))}
    </ul>
  );
}

export function PdfNavigation({
  pdf,
  page,
  onPage,
}: {
  pdf: PDFDocumentProxy | null;
  page: number;
  onPage: (page: number) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'thumbnails' | 'outline'>('thumbnails');
  const [outline, setOutline] = useState<Outline | null>(null);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const live = useRef(false);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  useEffect(() => {
    if (!pdf || tab !== 'outline') return;
    let active = true;
    void pdf
      .getOutline()
      .then((items) => {
        if (active) {
          setOutline(items || []);
          setError('');
        }
      })
      .catch(() => {
        if (active)
          setError(
            tr(
              'Could not load this PDF’s outline.',
              '无法加载这个 PDF 的大纲。',
            ),
          );
      });
    return () => {
      active = false;
    };
  }, [pdf, tab]);
  const selectOutline = async (item: Outline[number]) => {
    if (!pdf || !item.dest) return;
    try {
      const destination =
        typeof item.dest === 'string'
          ? await pdf.getDestination(item.dest)
          : item.dest;
      if (!destination?.length) throw Error('Missing destination');
      const ref = destination[0];
      const index = typeof ref === 'number' ? ref : await pdf.getPageIndex(ref);
      if (live.current) onPage(index + 1);
    } catch {
      if (live.current)
        setError(
          t(
            'This outline entry has no available page.',
            '这个大纲条目没有可用页码。',
          ),
        );
    }
  };
  return (
    <aside
      className="pdf-navigation"
      aria-label={t('PDF navigation', 'PDF 导航')}
    >
      <div
        className="pdf-navigation-tabs"
        role="tablist"
        aria-label={t('PDF navigation view', 'PDF 导航视图')}
      >
        <button
          role="tab"
          id="pdf-thumbnails-tab"
          aria-controls="pdf-navigation-content"
          aria-selected={tab === 'thumbnails'}
          onClick={() => setTab('thumbnails')}
        >
          {t('Thumbnails', '缩略图')}
        </button>
        <button
          role="tab"
          id="pdf-outline-tab"
          aria-controls="pdf-navigation-content"
          aria-selected={tab === 'outline'}
          onClick={() => setTab('outline')}
        >
          {t('Outline', '大纲')}
        </button>
      </div>
      <div
        ref={root}
        className="pdf-navigation-scroll"
        id="pdf-navigation-content"
        role="tabpanel"
        aria-labelledby={`pdf-${tab}-tab`}
      >
        {!pdf ? (
          <p className="pdf-navigation-empty">{t('Loading…', '正在加载…')}</p>
        ) : tab === 'thumbnails' ? (
          Array.from({ length: pdf.numPages }, (_, index) => (
            <Thumbnail
              key={index}
              pdf={pdf}
              number={index + 1}
              selected={page === index + 1}
              root={root}
              onSelect={() => onPage(index + 1)}
            />
          ))
        ) : error ? (
          <output className="pdf-navigation-empty">
            {pdfSystemMessage(error)}
          </output>
        ) : outline === null ? (
          <p className="pdf-navigation-empty">
            {t('Loading outline…', '正在加载大纲…')}
          </p>
        ) : outline.length ? (
          <OutlineBranch
            items={outline}
            onSelect={(item) => void selectOutline(item)}
          />
        ) : (
          <p className="pdf-navigation-empty">
            {t('This PDF has no built-in outline.', '这个 PDF 没有内置大纲。')}
          </p>
        )}
      </div>
      <PdfNavigationResize />
    </aside>
  );
}
