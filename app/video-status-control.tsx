'use client';

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Card } from './canvas-model';
import { useI18n } from './i18n';
import { useReading } from './document-reading-control';
import { cancelReading, readDocument } from './document-reading-store';
import { pdfSystemMessage } from './pdf-system-messages';
import { createVideoStatusStore, videoStatusTone, type VideoStatusChannel, type VideoStatusMessage, type VideoStatusNotice, type VideoStatusStore } from './video-status';
import './video-status.css';

const VideoStatusContext = createContext<VideoStatusStore | null>(null);

export function VideoStatusProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createVideoStatusStore);
  return <VideoStatusContext.Provider value={store}>{children}</VideoStatusContext.Provider>;
}

export function useVideoStatusReporter(channel: VideoStatusChannel) {
  const store = useContext(VideoStatusContext);
  const reporter = useRef<ReturnType<VideoStatusStore['bind']> | null>(null);
  useEffect(() => {
    const binding = store?.bind(channel);
    reporter.current = binding || null;
    return () => { binding?.release(); reporter.current = null; };
  }, [store, channel]);
  const report = useCallback((notice: VideoStatusNotice) => reporter.current?.report(notice), []);
  return store ? report : undefined;
}

export function VideoStatusDot({ card }: { card: Card }) {
  const store = useContext(VideoStatusContext);
  if (!store) return null;
  return <VideoStatusDetails card={card} store={store} />;
}

function VideoStatusDetails({ card, store }: { card: Card; store: VideoStatusStore }) {
  const { t, locale } = useI18n();
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const reading = useReading(card);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 48 });
  const root = useRef<HTMLDivElement>(null), panel = useRef<HTMLDialogElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasCaptions = !!(card.video?.transcriptUrl || card.video?.subtitleUrl);
  const tone = videoStatusTone(snapshot, reading.status, hasCaptions, !!reading.cacheError);
  const message = (value: VideoStatusMessage) => typeof value === 'string' ? pdfSystemMessage(value) : t(value.en, value.zh);
  const result = reading.document;
  const readingMessage = reading.status === 'ready' && result
    ? t('Read {count} captions · {characters} characters', '已读取 {count} 条字幕 · {characters} 字', { count: result.total.toLocaleString(locale), characters: result.characters.toLocaleString(locale) })
    : reading.status === 'empty' ? t('There are no captions for AI to read.', '暂无可供 AI 读取的字幕。')
    : pdfSystemMessage(reading.message || '') || (hasCaptions ? t('AI reads these captions automatically when using this video.', 'AI 使用此视频时会自动读取字幕。') : t('AI needs captions to answer questions about this video.', 'AI 需要字幕才能根据此视频回答问题。'));
  const notices = (['playback', 'caption-import', 'captions'] as const).flatMap(channel => snapshot[channel] ? [{ channel, notice: snapshot[channel]! }] : []);
  const overview = notices.find(({ notice }) => notice.status === 'error') || notices.find(({ notice }) => notice.status === 'loading') || notices.find(({ notice }) => notice.status === 'missing') || notices[0];
  const summary = ['error', 'reading', 'loading'].includes(reading.status) ? readingMessage : overview ? message(overview.notice.message) : readingMessage;
  const show = () => { if (timer.current) clearTimeout(timer.current); setOpen(true); };
  const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => setOpen(false), 150); };
  const blur = (event: React.FocusEvent) => {
    if (!root.current?.contains(event.relatedTarget) && !panel.current?.contains(event.relatedTarget)) hide();
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = root.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(16, Math.min(rect.left, window.innerWidth - 316)), top: Math.min(rect.bottom + 8, window.innerHeight - 100) });
    };
    place();
    const observer = new ResizeObserver(place);
    if (root.current) observer.observe(root.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open, card.title]);
  return <div ref={root} className={`video-status-control status-${tone}`} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={blur} onPointerDown={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <button className="video-status-dot" aria-label={t('Video status: {message}', '视频状态：{message}', { message: summary })} aria-expanded={open} onClick={show} />
    {open && createPortal(
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The status popover keeps its interactive controls open during pointer/focus handoff.
      <dialog open ref={panel} className="video-status-popover" aria-label={t('Video status', '视频状态')} style={{ left: position.left, top: position.top, maxHeight: `calc(100dvh - ${position.top + 16}px)` }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={blur}>
      <strong>{t('Video status', '视频状态')}</strong>
      {notices.map(({ channel, notice }) => <div className={`video-status-detail status-${notice.status}`} key={channel}>
        <span>{channel === 'playback' ? t('Playback', '播放') : channel === 'captions' ? t('Captions', '字幕') : t('Caption import', '字幕导入')}</span>
        <output>{message(notice.message)}</output>
        {notice.retry && <button disabled={notice.retryDisabled} onClick={notice.retry}>{notice.retryLabel ? message(notice.retryLabel) : t('Retry', '重试')}</button>}
      </div>)}
      {!snapshot.captions && !hasCaptions && <div className="video-status-detail"><span>{t('Captions', '字幕')}</span><output>{card.video?.localUrl ? t('Import an SRT or VTT file to read and search this video’s captions.', '导入 SRT 或 VTT 文件后，即可阅读和搜索字幕。') : t('Website captions have not been imported into Lumior.', '网站字幕尚未导入到 Lumior。')}</output></div>}
      <div className={`video-status-detail status-${reading.status}`}><span>{t('AI reading', 'AI 读取')}</span><output>{readingMessage}</output>
        {reading.cacheError && <output>{t('The text is available for this question, but could not be cached locally.', '文字可用于本次提问，但本机缓存保存失败。')}</output>}
        {reading.status === 'reading' ? <button onClick={() => cancelReading(card)}>{t('Stop reading', '停止读取')}</button> : hasCaptions && <button onClick={() => { void readDocument(card, !!result || reading.status === 'error').catch(() => {}); }}>{result ? t('Read again', '重新读取') : reading.status === 'error' ? t('Retry reading', '重试读取') : t('Read captions', '读取字幕')}</button>}
      </div>
      {!card.video?.localUrl && card.video?.url && <a href={card.video.url} target="_blank" rel="noreferrer">{card.video.youtubeId ? t('Watch on YouTube ↗', '前往 YouTube 观看 ↗') : t('Watch original video ↗', '查看原视频 ↗')}</a>}
      <small>{t('Caption reading happens locally and does not call a model.', '字幕读取在本机完成，本身不调用模型。')}</small>
    </dialog>, document.body)}
  </div>;
}
