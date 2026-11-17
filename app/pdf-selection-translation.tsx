'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { LoaderCircle, X } from 'lucide-react';
import { useI18n } from './i18n';
import { usePdfSelectionTranslation } from './use-pdf-selection-translation';
import './pdf-selection-translation.css';

export function PdfSelectionTranslation({ sourceKey, text, page, onSave, onSettings, render }: {
  sourceKey: string;
  text: string;
  page: number;
  onSave: (translation: string) => void;
  onSettings: () => void;
  render: (trigger: ReactNode, panel: ReactNode) => ReactNode;
}) {
  const { t } = useI18n();
  const translation = usePdfSelectionTranslation(sourceKey);
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => {
    if (open) closeButton.current?.focus({ preventScroll: true });
    else if (wasOpen.current) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  const start = () => {
    setOpen(true); setCopyStatus('');
    void translation.start(text, page);
  };
  const close = () => {
    translation.clear(); setOpen(false);
  };
  const copy = async () => {
    if (translation.result?.status !== 'done') return;
    try {
      await navigator.clipboard.writeText(translation.result.text);
      if (alive.current) setCopyStatus(t('Copied', '已复制'));
    } catch {
      if (alive.current) setCopyStatus(t('Could not copy. Try again.', '复制失败，请重试。'));
    }
  };
  const result = translation.result;
  return render(
    <button ref={trigger} type="button" className="pdf-annotation-icon pdf-selection-translate-button"
      aria-label={t('Translate locally', '本地翻译')} title={t('Translate locally', '本地翻译')}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={open ? close : start}>
      <span className="pdf-selection-translate-glyph" aria-hidden="true" />
    </button>,
    open ? <dialog open id={panelId} className="pdf-selection-translation-panel" data-local-translation-open="true" aria-label={t('Local translation', '本地翻译')}
      onKeyDown={event => {
        if (event.key === 'Escape' && !event.defaultPrevented && !event.nativeEvent.isComposing) {
          event.preventDefault(); event.stopPropagation(); close();
        }
      }}>
      <header>
        <strong>{t('Local translation', '本地翻译')}</strong>
        <button ref={closeButton} type="button" aria-label={t('Close selected text translation', '关闭选段翻译')} onClick={close}><X size={16} /></button>
      </header>
      <div className="pdf-selection-translation-result" aria-live="polite" aria-busy={translation.busy}>
        {translation.busy ? <p className="pdf-selection-translation-status"><LoaderCircle size={14} className="pdf-selection-translation-spinner" />{result?.status === 'starting' ? t('Starting local model…', '正在启动本地模型…') : t('Translating…', '正在翻译…')}</p>
          : result?.status === 'done' ? <p className="pdf-selection-translated-text">{result.text}</p>
          : result?.status === 'needs-install' ? <p>{result.error || t('Download the local translation extension in AI settings first.', '先在 AI 服务设置中下载本地翻译扩展。')}</p>
          : result?.status === 'cancelled' ? <p>{t('Cancelled. You can translate this selection again.', '已取消，可重新翻译这段文字。')}</p>
          : result?.error ? <p role="alert">{result.error}</p> : null}
      </div>
      <div className="pdf-selection-translation-actions">
        {translation.busy ? <button type="button" onClick={translation.cancel}>{t('Cancel translation', '取消翻译')}</button>
          : result?.status === 'done' ? <>
            <button type="button" onClick={() => void copy()}>{t('Copy translation', '复制译文')}</button>
            <button type="button" className="pdf-selection-save-translation" onClick={() => onSave(result.text)}>{t('Save as annotation', '保存为标注')}</button>
          </> : result?.status === 'needs-install' ? <button type="button" onClick={onSettings}>{t('Download model', '去下载模型')}</button>
          : <button type="button" onClick={start}>{t('Try again', '重新翻译')}</button>}
        {copyStatus && <output>{copyStatus}</output>}
      </div>
  </dialog> : null);
}
