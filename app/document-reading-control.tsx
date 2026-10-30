'use client';
import { useI18n } from './i18n';
import { pdfSystemMessage } from './pdf-system-messages';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Card } from './canvas-model';
import {
  cancelReading,
  readDocument,
  readingRevision,
  readingState,
  subscribeReading,
  warmReading,
} from './document-reading-store';
import './document-reading.css';

export function useReading(card: Card) {
  const subscribe = useCallback(
    (listener: () => void) => subscribeReading(card, listener),
    [card],
  );
  const snapshot = useCallback(() => readingState(card), [card]);
  const state = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    void warmReading(card);
  }, [card]);
  return state;
}

const serverRevision = () => 0;
export function useBoardReadings(cards: Card[], enabled: boolean) {
  const subscribe = useCallback(
    (listener: () => void) => {
      if (!enabled) return () => {};
      const subscriptions = cards
        .filter((card) => card.kind === 'pdf' || card.kind === 'video')
        .map((card) => subscribeReading(card, listener));
      return () => subscriptions.forEach((unsubscribe) => unsubscribe());
    },
    [cards, enabled],
  );
  useSyncExternalStore(subscribe, readingRevision, serverRevision);
  useEffect(() => {
    if (enabled)
      cards
        .filter((card) => card.kind === 'pdf' || card.kind === 'video')
        .forEach((card) => {
          void warmReading(card);
        });
  }, [cards, enabled]);
  return new Map(
    cards
      .filter((card) => card.kind === 'pdf' || card.kind === 'video')
      .map((card) => [card.id, readingState(card)]),
  );
}

export function DocumentReadingControl({ card, label }: { card: Card; label?: string }) {
  const { t, locale } = useI18n();
  const state = useReading(card),
    [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null);
  const action =
    card.kind === 'pdf'
      ? t('Read PDF content', '读取 PDF 内容')
      : t('Read existing captions', '读取已有字幕');
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  const read = (force = false) => {
    void readDocument(card, force).catch(() => {});
  };
  const result = state.document;
  const message =
    state.status === 'ready' && result
      ? card.kind === 'pdf'
        ? t(
            'Read {count} pages · {characters} characters',
            '已读取 {count} 页 · {characters} 字',
            {
              count: result.total.toLocaleString(locale),
              characters: result.characters.toLocaleString(locale),
            },
          )
        : t(
            'Read {count} captions · {characters} characters',
            '已读取 {count} 条字幕 · {characters} 字',
            {
              count: result.total.toLocaleString(locale),
              characters: result.characters.toLocaleString(locale),
            },
          )
      : state.status === 'empty'
        ? card.kind === 'pdf'
          ? t(
              'No extractable text. Scanned-document recognition is not available yet.',
              '没有可提取文字，扫描件识别尚未接入。',
            )
          : t(
              'This video has no existing captions. Automatic transcription is not available yet.',
              '这个视频没有已有字幕，自动转写尚未接入。',
            )
        : pdfSystemMessage(state.message || '') ||
          t(
            'Read and save locally so AI can find relevant passages.',
            '在本机读取并保存，供 AI 选取相关段落。',
          );
  return (
    <div ref={root} className="document-reading-control">
      <button
        className={`document-read-button ${state.status === 'reading' ? 'document-is-reading' : ''}`}
        aria-label={action}
        title={`${action} · ${state.status === 'ready' ? t('Read', '已读取') : t('Processed locally', '本机处理')}`}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (['idle', 'cancelled', 'error'].includes(state.status) && !open)
            read();
        }}
      >
        <span className="document-read-icon" aria-hidden="true" />
        {label && <span>{label}</span>}
        {state.status === 'ready' && <span className="document-read-dot" />}
      </button>
      {open && (
        <section className="document-reading-popover" aria-label={action}>
          <strong>
            {card.kind === 'pdf'
              ? t('PDF content', 'PDF 内容')
              : t('Existing video captions', '已有视频字幕')}
          </strong>
          <output>{message}</output>
          {!!result?.emptyPages.length && (
            <span>
              {t(
                '{count} pages have no text; OCR was not performed.',
                '{count} 页没有文字，本次未进行 OCR。',
                { count: result.emptyPages.length },
              )}
            </span>
          )}
          {state.cacheError && (
            <span>
              {t(
                'The text is available for this question, but could not be cached locally.',
                '文字可用于本次提问，但本机缓存保存失败。',
              )}
            </span>
          )}
          <small>
            {t(
              'Reading does not call a model. AI can cite page numbers or video times; formula recognition is not available yet.',
              '读取本身不调用模型。AI 回答可引用页码或视频时间；公式识别尚未接入。',
            )}
          </small>
          {state.status === 'reading' ? (
            <button onClick={() => cancelReading(card)}>
              {t('Stop reading', '停止读取')}
            </button>
          ) : (
            <button onClick={() => read(true)}>
              {result
                ? t('Read again', '重新读取')
                : t('Retry reading', '重试读取')}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

export function PdfReadingStatus({ card }: { card: Card }) {
  const { t, locale } = useI18n();
  const state = useReading(card),
    [open, setOpen] = useState(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(true);
  };
  const hide = () => {
    timer.current = setTimeout(() => setOpen(false), 150);
  };
  const result = state.document;
  const message =
    state.status === 'ready' && result
      ? t(
          'Read {count} pages · {characters} characters',
          '已读取 {count} 页 · {characters} 字',
          {
            count: result.total.toLocaleString(locale),
            characters: result.characters.toLocaleString(locale),
          },
        )
      : state.status === 'empty'
        ? t(
            'No extractable text. Scanned-document recognition is not available yet.',
            '没有可提取文字，扫描件识别尚未接入。',
          )
        : pdfSystemMessage(state.message || '') ||
          t(
            'AI automatically reads text when using this PDF.',
            'AI 使用此 PDF 时会自动读取文字。',
          );
  return (
    <div
      className={`document-reading-control pdf-reading-status status-${state.status}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) hide();
      }}
    >
      <button
        className="pdf-reading-status-dot"
        aria-label={t(
          'PDF content status: {message}',
          'PDF 内容状态：{message}',
          { message },
        )}
        aria-expanded={open}
        onClick={show}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      />
      {open && (
        <section className="document-reading-popover" role="tooltip">
          <strong>{t('PDF content', 'PDF 内容')}</strong>
          <output>{message}</output>
          {!!result?.emptyPages.length && (
            <span>
              {t(
                '{count} pages have no extractable text.',
                '{count} 页没有可提取文字。',
                { count: result.emptyPages.length },
              )}
            </span>
          )}
          <small>
            {state.status === 'error'
              ? t(
                  'You can read this document again in the AI chat.',
                  '可在 AI 对话中重新读取。',
                )
              : t(
                  'Reading does not call a model. AI can cite source page numbers.',
                  '读取本身不调用模型。AI 回答可引用原文页码。',
                )}
          </small>
        </section>
      )}
    </div>
  );
}
