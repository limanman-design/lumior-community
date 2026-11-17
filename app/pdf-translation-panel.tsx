'use client';
import { useI18n } from './i18n';
import { translate as tr } from './i18n-core';
import { pdfSystemMessage } from './pdf-system-messages';
/* oxlint-disable react/react-compiler -- Cancellable PDF resources and source guards synchronize the external reader across document changes. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, LoaderCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { Card } from './canvas-model';
import type { ImportedCard } from './file-import';
import type { PdfTranslation } from '../lib/pdf-translation';
import type { TranslationPageLayout, TranslationPageSize } from '../lib/pdf-translation-pdf';
import { PdfPage, type MarkGesture } from './pdf-sheet';
import { acquirePdf } from './pdf-runtime';
import { readLayoutPdf } from '../lib/pdf-layout-artifact';
import type { PdfScrollPageMapping } from './pdf-scroll-sync';
import './pdf-translation.css';
const noGesture: MarkGesture = () => {};
const noMarks: [] = [];
const noHits: [] = [];
export function PdfTranslationPanel({
  card,
  translation,
  requestedMode,
  busy,
  error,
  progress,
  onPage,
  onRetry,
  onStop,
  onLocal,
  onCreated,
  hoverId,
  onHover,
  zoom = 1,
  rasterZoom = zoom,
  controlsTarget,
  statusTarget,
  onScrollRoot,
  onScrollPages,
  onSourcePageSizes,
  onScrollIntent,
}: {
  card: Card;
  translation?: PdfTranslation;
  requestedMode?: 'original-layout' | 'reflow';
  busy: boolean;
  error: string;
  progress: string;
  onPage: (page: number) => void;
  onRetry: () => void;
  onStop: () => void;
  onLocal?: () => void;
  onCreated?: (card: ImportedCard) => void | Promise<void>;
  hoverId?: string;
  onHover: (id?: string) => void;
  zoom?: number;
  rasterZoom?: number;
  controlsTarget?: HTMLElement | null;
  statusTarget?: HTMLElement | null;
  onScrollRoot: (node: HTMLDivElement | null) => void;
  onScrollPages: (pages: PdfScrollPageMapping[]) => void;
  onSourcePageSizes?: (sizes: TranslationPageSize[]) => void;
  onScrollIntent: () => void;
}) {
  const { t } = useI18n();
  const [saving, setSaving] = useState(false),
    [exportError, setExportError] = useState(''),
    [saved, setSaved] = useState(false);
  const originalLayout =
      (requestedMode || translation?.mode) === 'original-layout',
    sourceIdentity = `${card.pdf?.url}:${translation?.sourceKey || ''}:${requestedMode || translation?.mode || 'reflow'}`,
    previewIdentity = `${sourceIdentity}:${originalLayout ? 'layout:' + translation?.layout?.url : 'reflow'}`;
  const complete =
    !!translation?.complete &&
    (originalLayout
      ? translation.mode === 'original-layout' && !!translation.layout
      : translation.mode !== 'original-layout');
  const previewAllowed =
    !!translation &&
    (originalLayout
      ? complete
      : translation.mode !== 'original-layout' && !!translation.units.length);
  const [preview, setPreview] = useState<{
      pdf: PDFDocumentProxy;
      pages: (TranslationPageLayout & { target?: number })[];
      identity: string;
    } | null>(null),
    [previewError, setPreviewError] = useState<{
      identity: string;
      message: string;
    } | null>(null),
    [width, setWidth] = useState(400),
    [previewRetry, setPreviewRetry] = useState(0);
  const root = useRef<HTMLDivElement>(null),
    alive = useRef(true),
    previewResource = useRef<{ release: () => void; identity: string } | null>(
      null,
    ),
    currentSource = useRef(sourceIdentity);
  currentSource.current = sourceIdentity;
  const registerRoot = useCallback(
    (node: HTMLDivElement | null) => {
      root.current = node;
      onScrollRoot(node);
    },
    [onScrollRoot],
  );
  const visiblePreview =
    previewAllowed && preview?.identity === previewIdentity ? preview : null;
  const visiblePreviewError =
    previewAllowed && previewError?.identity === previewIdentity
      ? previewError.message
      : '';
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      previewResource.current?.release();
      previewResource.current = null;
    };
  }, []);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setSaved(false);
    setExportError('');
    setSaving(false);
    root.current?.scrollTo({ top: 0, left: 0 });
  }, [sourceIdentity]);
  useEffect(() => {
    if (!translation || !previewAllowed) {
      previewResource.current?.release();
      previewResource.current = null;
      setPreview(null);
      setPreviewError(null);
      return;
    }
    if (previewResource.current?.identity !== previewIdentity) {
      previewResource.current?.release();
      previewResource.current = null;
      setPreview(null);
    }
    let live = true,
      attached = false,
      handle: ReturnType<typeof acquirePdf> | undefined,
      url: string | undefined;
    const preparation = new AbortController();
    const release = () => {
      handle?.release();
      if (url) URL.revokeObjectURL(url);
    };
    const timer = setTimeout(() => {
      void (async () => {
        try {
          let pages: (TranslationPageLayout & { target?: number })[];
          if (originalLayout) {
            await readLayoutPdf(translation.layout!);
            if (!live) return;
            handle = acquirePdf(translation.layout!.url);
            pages = translation.layout!.pages;
          } else {
            const [{ buildTranslationPdf }, { loadTranslationFont }, { loadTranslationSource }] =
              await Promise.all([
                import('../lib/pdf-translation-pdf'),
                import('./pdf-translation-font'),
                import('./pdf-translation-formulas'),
              ]);
            if (!live) return;
            const [font, source] = await Promise.all([
              loadTranslationFont(),
              loadTranslationSource(card.pdf!.url, translation, preparation.signal),
            ]);
            if (!live) return;
            onSourcePageSizes?.(source.pageSizes);
            const result = await buildTranslationPdf(
              card.pdf!.name.replace(/\.pdf$/i, ''),
              translation,
              font,
              true,
              source.formulas,
              source.pageSizes,
            );
            if (!live) return;
            url = URL.createObjectURL(
              new Blob([new Uint8Array(result.bytes)], {
                type: 'application/pdf',
              }),
            );
            handle = acquirePdf(url);
            pages = result.pages;
          }
          const pdf = await handle.promise;
          if (!live) return;
          if (
            originalLayout &&
            (pdf.numPages !== pages.length ||
              pages.some((value, index) => value.target !== index + 1))
          )
            throw new Error(
              tr(
                'Translated page mapping is incomplete. Generate it again.',
                '译文页面对照信息不完整，请重新生成。',
              ),
            );
          const previous = previewResource.current;
          previewResource.current = { release, identity: previewIdentity };
          attached = true;
          setPreview({ pdf, pages, identity: previewIdentity });
          setPreviewError(null);
          previous?.release();
        } catch (failure) {
          preparation.abort();
          release();
          if (live)
            setPreviewError({
              identity: previewIdentity,
              message:
                failure instanceof Error
                  ? failure.message
                  : tr(
                      'Could not load the translation preview. Try again.',
                      '译文预览加载失败，可重试。',
                    ),
            });
        }
      })();
    }, 200);
    return () => {
      live = false;
      preparation.abort();
      clearTimeout(timer);
      if (!attached) release();
    };
  }, [
    translation,
    card.pdf?.name,
    card.pdf?.url,
    originalLayout,
    previewIdentity,
    previewAllowed,
    previewRetry,
    onSourcePageSizes,
  ]);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      onScrollPages(
        visiblePreview?.pages.map((value, index) => ({
          page: value.target || index + 1,
          source: value.source,
          ...(!originalLayout ? { alignment: 'page' as const } : {}),
        })) || [],
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [visiblePreview, onScrollPages, width, zoom, originalLayout]);
  const save = async () => {
    if (!complete || !translation || saving) return;
    const savingSource = sourceIdentity;
    setSaving(true);
    setExportError('');
    try {
      const { exportTranslatedPdf } = await import('./pdf-translation-export');
      const { file, imported } = await exportTranslatedPdf(card, translation);
      if (!alive.current || currentSource.current !== savingSource) return;
      if (!onCreated)
        throw new Error(
          t(
            'Return to the whiteboard to save the translation.',
            '请返回画板后保存译文。',
          ),
        );
      await onCreated(imported);
      if (!alive.current || currentSource.current !== savingSource) return;
      const url = URL.createObjectURL(file),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      setSaved(true);
    } catch (failure) {
      if (alive.current && currentSource.current === savingSource)
        setExportError(
          failure instanceof Error
            ? failure.message
            : t('Export failed. Try again.', '导出失败，请重试。'),
        );
    } finally {
      if (alive.current && currentSource.current === savingSource)
        setSaving(false);
    }
  };
  const status =
    pdfSystemMessage(exportError || error) ||
    (saving
      ? t('Exporting…', '正在导出…')
      : saved
        ? t(
            'Translation card added and PDF exported.',
            '已添加译文卡片并导出。',
          )
        : pdfSystemMessage(progress) ||
          (complete
            ? t(
                'Translation complete and saved locally.',
                '翻译完成，已保存在本机。',
              )
            : t('Preparing translation…', '正在准备翻译…')));
  const controls = (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className="pdf-translation-export"
              aria-label={t('Export', '导出')}
              disabled={
                !complete || !previewAllowed || busy || saving || !onCreated
              }
              onClick={() => void save()}
            >
              {saving ? (
                <LoaderCircle
                  className="pdf-translation-export-spinner"
                  size={18}
                />
              ) : (
                <Download size={18} />
              )}
            </button>
          }
        />
        <TooltipContent className="lumior-tooltip" side="bottom">
          {t('Export', '导出')}
        </TooltipContent>
      </Tooltip>
    </>
  );
  const statusContent = (
    <div
      className={`pdf-translation-progress${error || exportError ? ' has-error' : ''}`}
    >
      <output title={status} aria-live="polite">
        {status}
      </output>
      {busy ? (
        <button
          onClick={onStop}
          aria-label={t('Pause translation', '暂停翻译')}
        >
          {t('Pause', '暂停')}
        </button>
      ) : (
        error || !complete ? (
          <button disabled={saving} onClick={onRetry}>
            {error && !translation?.units.length ? t('Retry', '重试') : t('Continue', '继续')}
          </button>
        ) : !originalLayout && translation?.model === 'local:hy-mt2-1.8b' && translation.inlineMathVersion !== 1 && (
          <button disabled={saving} onClick={onRetry}>
            {t('Restore inline formulas', '还原行内公式')}
          </button>
        )
      )}
    </div>
  );
  return (
    <aside
      className="pdf-reading-notes pdf-translation-panel"
      aria-label={t('Chinese PDF translation', 'PDF 中文译文')}
    >
      {controlsTarget && createPortal(controls, controlsTarget)}
      {statusTarget ? createPortal(statusContent, statusTarget) : statusContent}
      <div
        ref={registerRoot}
        className="pdf-page-area pdf-translation-pages"
        onWheelCapture={onScrollIntent}
        onPointerDownCapture={onScrollIntent}
        onKeyDownCapture={onScrollIntent}
      >
        {visiblePreviewError ? (
          <div className="pdf-translation-preview-error">
            <p role="alert">{pdfSystemMessage(visiblePreviewError)}</p>
            <button onClick={() => setPreviewRetry((value) => value + 1)}>
              {t('Reload preview', '重新加载预览')}
            </button>
            {originalLayout && (
              <button disabled={busy} onClick={onRetry}>
                {t('Regenerate translation', '重新生成译文')}
              </button>
            )}
            {originalLayout && onLocal && (
              <button disabled={busy || saving} onClick={onLocal}>
                {t('Translate locally', '使用本地翻译')}
              </button>
            )}
          </div>
        ) : visiblePreview ? (
          visiblePreview.pages.map((layout, index) => (
            <div
              key={layout.target || index + 1}
              className="pdf-translation-sheet-group"
            >
              <button
                className="pdf-translation-page-number"
                onClick={() => onPage(layout.source)}
              >
                {t('Source page {page}', '原文第 {page} 页', {
                  page: layout.source,
                })}
                {index > 0 &&
                visiblePreview.pages[index - 1].source === layout.source
                  ? t(' · continued', ' · 续')
                  : ''}
              </button>
              <PdfPage
                pdf={visiblePreview.pdf}
                number={layout.target || index + 1}
                width={width}
                zoom={zoom}
                rasterZoom={rasterZoom}
                defaultRatio={layout.width && layout.height ? layout.height / layout.width : undefined}
                root={root}
                hits={noHits}
                marks={noMarks}
                onMarkDown={noGesture}
                onMarkMove={noGesture}
                onMarkUp={noGesture}
                hoverRects={layout.rects}
                hoverId={hoverId}
                onHover={onHover}
              />
            </div>
          ))
        ) : (
          <div className="pdf-translation-empty-paper">
            <div>
              <p>
                {originalLayout
                  ? complete
                    ? t(
                        'Loading original-layout translation…',
                        '正在加载原版式译文…',
                      )
                    : busy
                      ? t(
                          'Translating and restoring the original layout…',
                          '正在翻译并还原原版式…',
                        )
                      : error
                        ? t(
                            'Original-layout translation is incomplete. Completed text has been kept.',
                            '原版式翻译未完成，已完成的译文仍保留。',
                          )
                        : t(
                            'Original-layout translation is paused. You can continue.',
                            '原版式翻译已暂停，可继续完成。',
                          )
                  : error
                    ? t(
                        'No translation yet. See the notice above.',
                        '暂无译文，请查看上方提示。',
                      )
                    : translation?.units.length
                      ? t('Generating PDF preview…', '正在生成 PDF 预览…')
                      : t(
                          'Translated pages will appear here.',
                          '译文会逐页显示在这里。',
                        )}
              </p>
              {originalLayout &&
                translation?.mode === 'original-layout' &&
                !complete &&
                !!translation.units.length && (
                  <p>
                    {t(
                      '{count} translated paragraphs saved',
                      '已保存 {count} 段译文',
                      {
                        count: translation.units.reduce(
                          (count, unit) => count + (unit.parts?.length || 1),
                          0,
                        ),
                      },
                    )}
                  </p>
                )}
              {originalLayout && error && onLocal && (
                <button disabled={busy || saving} onClick={onLocal}>
                  {t('Translate locally', '使用本地翻译')}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
