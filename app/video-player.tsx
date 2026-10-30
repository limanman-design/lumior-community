'use client';
import { useI18n } from './i18n';
import { translate as t } from './i18n-core';
/* oxlint-disable next/no-img-element -- Local SVG controls and media posters retain their original dimensions. */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Card, CardVideo } from './canvas-model';
import { WakeOrb } from './wake-orb';
import { MaterialIcon } from './material-icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { activeVideoCue, videoTimestamp, type VideoCue } from './video-transcript';
import { DocumentReadingControl } from './document-reading-control';
import { fetchVideoCues } from './video-caption-loader';
import { bilibiliEmbedUrl } from './video-url';
import { youtubePlaybackErrorForCode, youtubePlaybackErrorMessage, type YoutubePlaybackError } from './youtube-playback-error';
import { importVideoCaptionFile, type CaptionFileStore } from './video-caption-import';
import { writeStoredFiles } from './local-repository';
import { fileUrl } from './workspace-assets';
import { VideoStatusDot, VideoStatusProvider, useVideoStatusReporter } from './video-status-control';
import { useTabReadingScroll, useTabReadingSession } from './tab-reading-session';
import './video-player.css';
import './expanded-information-sidebar.css';

const positions = new Map<string, number>();
const playbackEvent = 'lumior-video-play';
function videoKey(card: Card) {
  return card.video?.localUrl || card.video?.youtubeId || card.video?.url || card.id;
}

function videoStart(card: Card) { return positions.get(videoKey(card)) ?? card.video?.startTime ?? 0; }

export function VideoIcon({ name }: { name: 'video' | 'video-type' | 'play' | 'transcribe' | 'search' | 'pin' | 'close' | 'ai' | 'collapse' }) {
  return <img className={`video-ui-icon video-ui-${name}`} src={`/assets/video-card/${name}.svg`} alt="" draggable={false} />;
}

export function VideoTranscribeButton({ card }: { card: Card }) { return <DocumentReadingControl card={card} />; }

export type VideoCardChange = (patch: Partial<Card>, expectedVideo: CardVideo) => boolean;
const storeCaptionFiles: CaptionFileStore = async files => {
  const records = files.map(({ blob, name }) => ({ id: crypto.randomUUID(), name, type: blob.type, size: blob.size, blob }));
  // Both representations are durable before the card changes, or neither is written.
  await writeStoredFiles(records);
  return [fileUrl(records[0]), fileUrl(records[1])];
};

function VideoCaptionImport({ card, onChange }: { card: Card; onChange: VideoCardChange }) {
  useI18n();
  const reportStatus = useVideoStatusReporter('caption-import');
  const input = useRef<HTMLInputElement>(null), pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  // The parent keys this control by card and media source, so a change aborts its import.
  useEffect(() => () => { pending.current?.abort(); pending.current = null; }, []);
  const importFile = async (file?: File) => {
    const video = card.video;
    if (!file || !video?.localUrl || pending.current) return;
    const controller = new AbortController();
    pending.current = controller; setBusy(true); setError(''); setSuccess('');
    reportStatus?.({ status: 'loading', message: { en: 'Importing captions…', zh: '正在导入字幕…' } });
    try {
      const { transcriptUrl, subtitleUrl, cueCount } = await importVideoCaptionFile(file, storeCaptionFiles, controller.signal);
      if (controller.signal.aborted) return;
      if (!onChange({ video: { ...video, transcriptUrl, subtitleUrl } }, video)) {
        const message = t('The video changed before import finished. Choose the captions again.', '导入期间视频已更改，请重新选择字幕。');
        setError(message); reportStatus?.({ status: 'error', message });
        return;
      }
      const message = t('Imported {count} captions', '已导入 {count} 条字幕', { count: cueCount });
      setSuccess(message); reportStatus?.({ status: 'ready', message });
    } catch (failure) {
      if (!controller.signal.aborted) {
        const message = failure instanceof Error ? failure.message : t('Captions could not be imported. Try again.', '字幕导入失败，请重试。');
        setError(message); reportStatus?.({ status: 'error', message, retry: () => input.current?.click(), retryLabel: { en: 'Choose captions again', zh: '重新选择字幕' } });
      }
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  };
  return <div className="video-caption-import">
    <input ref={input} type="file" accept=".srt,.vtt" aria-label={t('Choose captions file', '选择字幕文件')} hidden onChange={event => {
      const file = event.target.files?.[0]; event.target.value = ''; void importFile(file);
    }} />
    <button className="video-caption-import-button" disabled={busy} onClick={() => input.current?.click()} title={t('SRT or VTT · up to 8 MB', 'SRT 或 VTT · 不超过 8 MB')}>
      {busy ? t('Importing captions…', '正在导入字幕…') : card.video?.transcriptUrl || card.video?.subtitleUrl ? t('Replace captions', '替换字幕') : t('Import captions', '导入字幕')}
    </button>
    <span className="video-caption-import-help">{t('SRT / VTT · up to 8 MB', 'SRT / VTT · 不超过 8 MB')}</span>
    {!reportStatus && error && <p className="video-caption-import-error" role="alert">{error}</p>}
    {!reportStatus && success && <output className="video-caption-import-success">{success}</output>}
  </div>;
}

type YoutubePlayer = { seekTo: (time: number, allow: boolean) => void; getCurrentTime: () => number; getPlayerState: () => number; pauseVideo: () => void; playVideo: () => void; destroy: () => void };
type YoutubeApi = { Player: new (element: HTMLElement, options: Record<string, unknown>) => YoutubePlayer };
let youtubeApiPromise: Promise<YoutubeApi> | undefined;
function loadYoutubeApi() {
  if (!youtubeApiPromise) youtubeApiPromise = new Promise<YoutubeApi>((resolve, reject) => {
    const w = window as typeof window & { YT?: YoutubeApi; onYouTubeIframeAPIReady?: () => void };
    if (w.YT?.Player) { resolve(w.YT); return; }
    const previous = w.onYouTubeIframeAPIReady;
    let settled = false;
    const script = document.createElement('script');
    const fail = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      script.remove();
      youtubeApiPromise = undefined;
      reject(new Error('YouTube unavailable'));
    };
    const timeout = setTimeout(fail, 15000);
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (settled || !w.YT?.Player) return;
      settled = true;
      clearTimeout(timeout);
      resolve(w.YT);
    };
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return youtubeApiPromise;
}

type VideoMediaProps = { card: Card; seek: { time: number; nonce: number }; onTime: (time: number) => void; autoplay?: boolean; suspended?: boolean };

function BilibiliMedia({ card, seek, autoplay = false, suspended = false }: VideoMediaProps) {
  useI18n();
  const reportStatus = useVideoStatusReporter('playback');
  const token = useRef<object>({});
  const frame = useRef<HTMLIFrameElement>(null);
  const [stopped, setStopped] = useState(false), [retry, setRetry] = useState(0);
  const [loadedSource, setLoadedSource] = useState<string | null>(null), [failedSource, setFailedSource] = useState<string | null>(null);
  const [wantsAutoplay, setWantsAutoplay] = useState(autoplay);
  const source = card.video && bilibiliEmbedUrl(card.video, wantsAutoplay, Math.floor(seek.time));
  const playerKey = `${source}:${retry}`;
  const ready = loadedSource === playerKey, error = failedSource === playerKey;
  const loaded = useRef(false);
  if (suspended && !stopped) setStopped(true);
  const announcePlayback = () => window.dispatchEvent(new CustomEvent(playbackEvent, { detail: token.current }));
  useEffect(() => {
    const stop = (event: Event) => { if ((event as CustomEvent).detail !== token.current) setStopped(true); };
    const focused = () => {
      if (document.activeElement === frame.current) window.dispatchEvent(new CustomEvent(playbackEvent, { detail: token.current }));
    };
    window.addEventListener(playbackEvent, stop);
    window.addEventListener('blur', focused);
    return () => { window.removeEventListener(playbackEvent, stop); window.removeEventListener('blur', focused); };
  }, []);
  useEffect(() => {
    if (!source || stopped || suspended) return;
    loaded.current = false;
    if (wantsAutoplay) announcePlayback();
    const timer = setTimeout(() => { if (!loaded.current) setFailedSource(`${source}:${retry}`); }, 18000);
    return () => clearTimeout(timer);
  }, [source, retry, stopped, suspended, wantsAutoplay]);
  const restart = useCallback(() => { setFailedSource(null); setLoadedSource(null); setStopped(false); setWantsAutoplay(true); setRetry(value => value + 1); window.dispatchEvent(new CustomEvent(playbackEvent, { detail: token.current })); }, []);
  useEffect(() => {
    reportStatus?.(error ? { status: 'error', message: { en: 'Unable to load Bilibili. Try again or open the original video.', zh: '哔哩哔哩播放器暂时无法加载，请重试或查看原视频。' }, retry: restart, retryDisabled: suspended }
      : stopped || suspended ? { status: 'stopped', message: { en: 'Playback stopped. Playing again restarts at the linked timestamp.', zh: '播放已停止，重新播放将从链接指定的时间开始。' }, retry: restart, retryDisabled: suspended, retryLabel: { en: 'Play again', zh: '重新播放' } }
      : ready ? { status: 'ready', message: { en: 'Bilibili player loaded. Playback access is controlled by the original website.', zh: '哔哩哔哩播放器已加载，播放权限由原网站决定。' } }
      : { status: 'loading', message: { en: 'Loading the Bilibili player…', zh: '正在加载哔哩哔哩播放器…' } });
  }, [reportStatus, error, stopped, suspended, ready, restart]);
  return <div className="video-embedded-shell">
    <div className="video-media">
      {source && !stopped && !suspended ? <iframe key={playerKey} ref={frame} className="video-bilibili-frame" src={source}
        title={card.title} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
        sandbox="allow-scripts allow-same-origin allow-presentation"
        onLoad={() => { loaded.current = true; setLoadedSource(playerKey); setFailedSource(null); }} onError={() => setFailedSource(playerKey)} /> :
        <div className="video-embed-stopped"><span>{t('Playback stopped', '播放已停止')}</span><button disabled={suspended} onClick={restart}>{t('Play again', '重新播放')}</button></div>}
      {!reportStatus && error && <div className="video-playback-error" role="alert"><span>{t('Unable to load Bilibili. Try again or open the original video.', '哔哩哔哩播放器暂时无法加载，请重试或查看原视频。')}</span><button disabled={suspended} onClick={restart}>{t('Retry', '重试')}</button></div>}
    </div>
    <div className="video-embed-controls">
      <button disabled={stopped || suspended} onClick={() => setStopped(true)} title={t('Stopping resets the embedded player. Play again restarts at the linked timestamp.', '停止会关闭播放器，重新播放将从链接指定的时间开始。')}>{t('Stop playback', '停止播放')}</button>
      {!reportStatus && <a href={card.video?.url} target="_blank" rel="noreferrer">{t('Watch original video ↗', '查看原视频 ↗')}</a>}
    </div>
  </div>;
}

function VideoMedia(props: VideoMediaProps) {
  return !props.card.video?.localUrl && props.card.video?.bilibiliId && bilibiliEmbedUrl(props.card.video)
    ? <BilibiliMedia {...props} /> : <LocalOrYoutubeMedia {...props} />;
}

function LocalOrYoutubeMedia({ card, seek, onTime, autoplay = false, suspended = false }: {
  card: Card; seek: { time: number; nonce: number }; onTime: (time: number) => void; autoplay?: boolean; suspended?: boolean;
}) {
 useI18n();
  const reportStatus = useVideoStatusReporter('playback');
  const native = useRef<HTMLVideoElement>(null), host = useRef<HTMLDivElement>(null), player = useRef<YoutubePlayer | null>(null);
  const [error, setError] = useState(false), [retry, setRetry] = useState(0);
  const [mediaReady, setMediaReady] = useState(false);
  const [youtubeError, setYoutubeError] = useState<YoutubePlaybackError | null>(null);
  const state = useRef({ seek, onTime, autoplay, suspended });
  state.current = { seek, onTime, autoplay, suspended };
  const token = useRef<object>({}), ready = useRef(false);
  const lastReported = useRef(-1), expectedStart = useRef(seek.time);
  const key = videoKey(card);
  const youtube = !card.video?.localUrl && !!card.video?.youtubeId;
  const src = card.video?.localUrl || card.video?.url;
  const report = (time: number) => {
    if (state.current.suspended || !Number.isFinite(time) || time < 0) return;
    positions.set(key, time);
    lastReported.current = time;
    state.current.onTime(time);
  };
  useEffect(() => {
    const pause = (event: Event) => {
      if ((event as CustomEvent).detail === token.current) return;
      native.current?.pause();
      if (ready.current) player.current?.pauseVideo();
    };
    window.addEventListener(playbackEvent, pause);
    return () => window.removeEventListener(playbackEvent, pause);
  }, []);
  useEffect(() => {
    if (suspended) { native.current?.pause(); if (ready.current) player.current?.pauseVideo(); }
    else {
      const time = positions.get(key) ?? state.current.seek.time;
      expectedStart.current = time; lastReported.current = -1;
      if (native.current?.readyState) native.current.currentTime = time;
      if (ready.current) player.current?.seekTo(time, true);
    }
  }, [suspended]);
  useEffect(() => {
    expectedStart.current = seek.time; lastReported.current = -1;
    if (native.current?.readyState) native.current.currentTime = seek.time;
    if (ready.current) player.current?.seekTo(seek.time, true);
  }, [seek.nonce, seek.time]);
  useEffect(() => {
    if (!youtube) return;
    let alive = true, timer: ReturnType<typeof setInterval> | undefined;
    let sdkError: YoutubePlaybackError | null = null;
    const mount = document.createElement('div');
    host.current?.replaceChildren(mount);
    setError(false); setMediaReady(false);
    setYoutubeError(null);
    const timeout = setTimeout(() => { if (alive && !sdkError) setYoutubeError({ reason: 'initialization-timeout' }); }, 18000);
    void loadYoutubeApi().then((api) => {
      if (!alive || !host.current) return;
      try { player.current = new api.Player(mount, {
        videoId: card.video?.youtubeId,
        playerVars: { playsinline: 1, origin: window.location.origin, start: Math.floor(state.current.seek.time) },
        events: {
          onReady: () => {
            if (!alive) return;
            ready.current = true; clearTimeout(timeout);
            // An SDK error is more specific than readiness; only actual playback clears it.
            if (!sdkError) {
              setYoutubeError(null); setMediaReady(true);
              player.current?.seekTo(state.current.seek.time, true);
              if (state.current.autoplay && !state.current.suspended) player.current?.playVideo();
            }
            timer = setInterval(() => {
              if (state.current.suspended || ![1, 2].includes(player.current?.getPlayerState() ?? -1)) return;
              const value = player.current?.getCurrentTime();
              if (value === undefined || value === lastReported.current) return;
              // The iframe can report zero before restoring a saved playback position.
              if (lastReported.current < 0 && value === 0 && expectedStart.current > 1) return;
              report(value);
            }, 250);
          },
          onStateChange: (event: { data: number }) => {
            if (!alive || event.data !== 1) return;
            sdkError = null; setYoutubeError(null); setMediaReady(true);
            if (state.current.suspended) { if (ready.current) player.current?.pauseVideo(); }
            else window.dispatchEvent(new CustomEvent(playbackEvent, { detail: token.current }));
          },
          onError: (event: { data: unknown }) => {
            if (!alive) return;
            clearTimeout(timeout);
            sdkError = youtubePlaybackErrorForCode(event.data);
            setYoutubeError(sdkError);
          },
        },
      }); } catch { if (alive) { clearTimeout(timeout); setYoutubeError({ reason: 'unknown' }); } }
    }, () => { if (alive) { clearTimeout(timeout); setYoutubeError({ reason: 'network' }); } });
    return () => {
      alive = false; clearTimeout(timeout); if (timer) clearInterval(timer);
      const value = player.current?.getCurrentTime?.(); if (value !== undefined) report(value);
      player.current?.destroy(); player.current = null; ready.current = false;
    };
  }, [key, retry, youtube]);
  const youtubeMessage = youtubeError && youtubePlaybackErrorMessage(youtubeError);
  const retryPlayback = useCallback(() => { setError(false); setMediaReady(false); setYoutubeError(null); setRetry((value) => value + 1); }, []);
  useEffect(() => {
    const message = youtubeError && youtubePlaybackErrorMessage(youtubeError);
    reportStatus?.(youtube && message ? { status: 'error', message, retry: message.retryable ? retryPlayback : undefined, retryDisabled: suspended }
      : error ? { status: 'error', message: { en: 'Unable to load the video. Please try again.', zh: '视频加载失败，请重试。' }, retry: retryPlayback, retryDisabled: suspended }
      : mediaReady ? { status: 'ready', message: { en: 'Video player ready.', zh: '视频播放器已就绪。' } }
      : { status: 'loading', message: { en: 'Loading the video player…', zh: '正在加载视频播放器…' } });
  }, [reportStatus, youtube, youtubeError, error, mediaReady, retryPlayback, suspended]);
  return <div className={youtube ? 'video-embedded-shell' : 'video-media'}>
    {/* Uploaded videos may have no captions until transcription is available. */}
    {/* oxlint-disable-next-line jsx-a11y/media-has-caption */}
    {youtube ? <div className="video-media"><div className="video-youtube-host" ref={host} /></div> : <video key={`${src}:${retry}`} ref={native} controls playsInline preload="metadata" poster={card.video?.poster || undefined} src={src} autoPlay={autoplay && !suspended}
      onLoadedMetadata={() => { setError(false); setMediaReady(true); if (native.current) native.current.currentTime = state.current.seek.time; }}
      onTimeUpdate={() => report(native.current?.currentTime || 0)} onPause={() => report(native.current?.currentTime || 0)}
      onPlay={() => { if (state.current.suspended) native.current?.pause(); else window.dispatchEvent(new CustomEvent(playbackEvent, { detail: token.current })); }}
      onError={() => setError(true)}>
      {card.video?.subtitleUrl && <track key={card.video.subtitleUrl} kind="subtitles" src={card.video.subtitleUrl} srcLang="und" label={t("Captions", "字幕")} default />}
    </video>}
    {!reportStatus && youtube && youtubeMessage && <div className="video-youtube-error" role="alert"><span>{t(youtubeMessage.en, youtubeMessage.zh)}</span><div>{youtubeMessage.retryable && <button disabled={suspended} onClick={retryPlayback}>{t('Retry', '重试')}</button>}<a href={card.video?.url} target="_blank" rel="noreferrer">{t('Watch on YouTube ↗', '前往 YouTube 观看 ↗')}</a></div></div>}
    {!reportStatus && !youtube && error && <div className="video-playback-error" role="alert"><span>{t("Unable to load the video. Please try again.", "视频加载失败，请重试。")}</span><button onClick={retryPlayback}>{t("Retry", "重试")}</button>{card.video?.youtubeId && <a href={card.video.url} target="_blank" rel="noreferrer">{t("Watch original video ↗", "查看原视频 ↗")}</a>}</div>}
  </div>;
}

export function CanvasVideo({ card, suspended = false, onSelect }: { card: Card; suspended?: boolean; onSelect: () => void }) {
  return <VideoStatusProvider key={`${card.id}:${videoKey(card)}`}><CanvasVideoCard card={card} suspended={suspended} onSelect={onSelect} /></VideoStatusProvider>;
}

function CanvasVideoCard({ card, suspended, onSelect }: { card: Card; suspended: boolean; onSelect: () => void }) {
 useI18n();
  const [playing, setPlaying] = useState(false);
  const [seek] = useState(() => ({ time: videoStart(card), nonce: 0 }));
  return <div className="video-card-content">
    <div className="canvas-video-picture">
      {playing ? <VideoMedia key={`${card.id}:${videoKey(card)}`} card={card} seek={seek} onTime={() => {}} autoplay suspended={suspended} /> : <button className="canvas-video-start" aria-label={t("Play {title} on whiteboard","在画板播放 {title}",{title:card.title})} onPointerDown={(event) => event.stopPropagation()} onClick={() => { onSelect(); setPlaying(true); }}>
        {card.video?.poster && <img className="canvas-video-poster" src={card.video.poster} alt={card.title} draggable={false} />}<span className="video-play-badge"><VideoIcon name="play" /></span>
      </button>}
    </div>
    <div className="canvas-video-caption"><div className="canvas-video-title"><h2>{card.title}</h2><VideoStatusDot card={card} /></div><p>{card.sourceName || (card.video?.youtubeId ? 'YouTube' : card.video?.bilibiliId ? t('Bilibili', '哔哩哔哩') : t("Video", "视频"))}{card.video?.duration ? ` · ${videoTimestamp(card.video.duration)}` : ''}</p></div>
  </div>;
}

export function VideoViewer({ card, time, focusRequest, layout = 'sidebar', aiOpen = false, onChange }: { card: Card; time?: number; focusRequest?: object; layout?: 'sidebar' | 'expanded'; aiOpen?: boolean; onChange?: VideoCardChange }) {
 useI18n();
  const reportStatus = useVideoStatusReporter('captions');
  const sourceKey = `${videoKey(card)}:${card.video?.transcriptUrl || ''}:${card.video?.subtitleUrl || ''}`;
  const session = useTabReadingSession<{ currentTime: number; query: string; follow: boolean }>(card.id, 'video-expanded', sourceKey);
  const saveSession = session.save;
  const remembered = layout === 'expanded' && time === undefined && !focusRequest ? session.snapshot : undefined;
  const [current, setCurrent] = useState(() => time ?? remembered?.currentTime ?? videoStart(card));
  const [seek, setSeek] = useState(() => ({ time: current, nonce: 0 }));
  const [lines, setLines] = useState<VideoCue[]>([]), [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [query, setQuery] = useState(remembered?.query ?? ''), [follow, setFollow] = useState(remembered?.follow ?? true);
  const [captionRetry, setCaptionRetry] = useState(0);
  const retryCaptions = useCallback(() => setCaptionRetry(value => value + 1), []);
  const list = useRef<HTMLDivElement>(null);
  useTabReadingScroll(card.id, 'video-expanded-transcript', list, {
    sourceKey,
    enabled: layout === 'expanded' && status === 'ready' && !follow,
    restore: time === undefined && !focusRequest,
  });
  useLayoutEffect(() => {
    if (layout === 'expanded') saveSession({ currentTime: current, query, follow });
  }, [saveSession, layout, current, query, follow]);
  const active = activeVideoCue(lines, current);
  const seekTo = (value: number) => { positions.set(videoKey(card), value); setSeek((old) => ({ time: value, nonce: old.nonce + 1 })); setCurrent(value); };
  useEffect(() => { if (time !== undefined) { seekTo(time); setQuery(''); setFollow(true); } }, [time, focusRequest]);
  useEffect(() => {
    const controller = new AbortController();
    setLines([]); setStatus('loading');
    const video = card.video;
    if (!video?.transcriptUrl && !video?.subtitleUrl) { setStatus('missing'); return; }
    const load = async () => {
      const cues = await fetchVideoCues(video, controller.signal);
      if (!controller.signal.aborted) { setLines(cues); setStatus(cues.length ? 'ready' : 'missing'); }
    };
    void load().catch(() => { if (!controller.signal.aborted) setStatus('error'); });
    return () => controller.abort();
  }, [card.video?.transcriptUrl, card.video?.subtitleUrl, captionRetry]);
  useEffect(() => {
    if (!follow || active < 0 || !list.current) return;
    const row = list.current.querySelector<HTMLElement>(`[data-cue="${active}"]`);
    if (row) list.current.scrollTo({ top: row.offsetTop - list.current.clientHeight * .25, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [active, follow, query]);
  const visible = lines.map((cue, index) => ({ ...cue, index })).filter((cue) => cue.text.toLowerCase().includes(query.toLowerCase()) || videoTimestamp(cue.time).includes(query));
  const missingCaptions = !card.video?.localUrl && (card.video?.youtubeId || card.video?.bilibiliId)
    ? t('Website captions have not been imported into Lumior. You can view them in the video player when the original provides them.', '网站字幕尚未导入到 Lumior；若原视频提供字幕，可在播放器内查看。')
    : card.video?.localUrl && onChange ? t('Import an SRT or VTT file to read, search and discuss this video’s captions.', '导入 SRT 或 VTT 字幕，即可阅读、搜索并让 AI 根据字幕回答。')
    : t('This video has no captions yet. Automatic transcription is not available yet.', '这个视频还没有已有字幕。自动转写尚未接入。');
  useEffect(() => {
    reportStatus?.(status === 'loading' ? { status, message: { en: 'Loading captions…', zh: '正在加载字幕…' } }
      : status === 'error' ? { status, message: { en: 'Captions could not be loaded. You can still play the video.', zh: '字幕加载失败，仍可播放视频。' }, retry: retryCaptions }
      : status === 'ready' ? { status, message: t('{count} captions available for search and AI reading.', '已有 {count} 条字幕，可供搜索和 AI 读取。', { count: lines.length }) }
      : { status, message: missingCaptions });
  }, [reportStatus, status, lines.length, missingCaptions, retryCaptions]);
  return <div className={`lumior-video-view video-layout-${layout} ${aiOpen ? 'video-with-ai' : ''}`}>
    <div className="video-player-column"><VideoMedia key={`${card.id}:${videoKey(card)}`} card={card} seek={seek} onTime={setCurrent} /></div>
    <div className="video-transcript-panel" aria-label={t("Video transcript", "视频字幕")}>
      {card.video?.localUrl && onChange && <VideoCaptionImport key={`${card.id}:${card.video.localUrl}:${card.video.url}`} card={card} onChange={onChange} />}
      <label className="video-transcript-search"><VideoIcon name="search" /><input aria-label={t("Search transcript", "搜索字幕")} placeholder={t("Search transcript...", "搜索字幕…")} value={query} onChange={(event) => { setQuery(event.target.value); setFollow(false); }} /></label>
      <div className="video-transcript-scroll" ref={list} onWheel={() => setFollow(false)} onTouchMove={() => setFollow(false)}>
        {visible.map((cue) => <button key={cue.index} data-cue={cue.index} className={`video-transcript-line ${active === cue.index ? 'active' : ''}`} aria-current={active === cue.index ? 'true' : undefined} onClick={() => { seekTo(cue.time); setFollow(true); }}><time>{videoTimestamp(cue.time)}</time><span>{cue.text}</span></button>)}
        {!visible.length && (lines.length > 0 || !reportStatus) && <p className="video-transcript-empty">{status === 'loading' ? t("Loading captions…", "正在加载字幕…") : status === 'error' ? t("Captions could not be loaded. You can still play the video.", "字幕加载失败，仍可播放视频。") : lines.length ? t("No matching captions", "没有匹配的字幕") : missingCaptions}</p>}
      </div>
      {lines.length > 0 && <div className="video-transcript-sync"><button onClick={() => { setQuery(''); setFollow(true); }}>{t("Sync to video time", "跟随视频时间")}</button></div>}
    </div>
  </div>;
}

export function VideoSidePanel({ card, besideAi, onClose, onChange }: { card: Card; besideAi: boolean; onClose: () => void; onChange?: VideoCardChange }) {
 useI18n();
  return <VideoStatusProvider key={`${card.id}:${videoKey(card)}`}><aside className={`card-side-panel video-side-panel ${besideAi ? 'beside-ai' : ''}`} aria-label={t("Pinned video", "固定视频")}>
    <header className="video-side-heading"><div className="video-side-title"><VideoIcon name="video" /><span title={card.title}>{card.title}</span><VideoStatusDot card={card} /></div><div><button aria-label={t("Close pinned card", "关闭固定卡片")} onClick={onClose}><VideoIcon name="collapse" /></button></div></header>
    <VideoViewer key={card.id} card={card} onChange={onChange} />
  </aside></VideoStatusProvider>;
}

export function ExpandedVideo({ card, aiOpen, onAi, onPin, onClose, time, focusRequest, sidebarOpen, onExpandSidebar, onChange, infoSidebarOpen = false, moreActions }: { infoSidebarOpen?: boolean; moreActions?: ReactNode; sidebarOpen: boolean; onExpandSidebar: () => void; card: Card; aiOpen: boolean; onAi: () => void; onPin: () => void; onClose: () => void; time?: number; focusRequest?: object; onChange?: VideoCardChange }) {
 useI18n();
  return <VideoStatusProvider key={`${card.id}:${videoKey(card)}`}><section className={`expanded-video-page ${aiOpen ? 'expanded-video-with-ai' : ''}`} aria-label={t("Expanded video", "展开的视频")} style={{ '--video-sidebar-inset': sidebarOpen ? 'var(--sidebar-width)' : '0px' } as CSSProperties}>
    <header className="expanded-video-header">
      <div className="expanded-video-title">
        {!sidebarOpen && <button className="board-sidebar-toggle" aria-label={t("Expand sidebar", "展开侧边栏")} onClick={onExpandSidebar}><img className="board-heading-logo" src="/assets/board-chrome/logo.png" alt="" width={24} height={24}/><img className="board-heading-open" src="/assets/board-chrome/open-sidebar.svg" alt="" width={20} height={20}/></button>}
        <VideoIcon name="video" /><span title={card.title}>{card.title}</span><VideoStatusDot card={card} />
      </div>
    <div className="expanded-video-controls">
      <Tooltip><TooltipTrigger render={<button aria-label={t("Discuss video with AI", "用此视频与 AI 对话")} aria-pressed={aiOpen} onClick={onAi}><WakeOrb compact /></button>} /><TooltipContent className="lumior-tooltip" side="bottom">{t("Discuss video with AI", "用此视频与 AI 对话")}</TooltipContent></Tooltip>
      <Tooltip><TooltipTrigger render={<button aria-label={t("Show sidebar", "显示侧边栏")} aria-expanded={infoSidebarOpen} onClick={onPin}><MaterialIcon name="home_storage" size={20} /></button>} /><TooltipContent className="lumior-tooltip" side="bottom">{t("Show sidebar", "显示侧边栏")}</TooltipContent></Tooltip>
      {moreActions}
      <button aria-label={t("Collapse expanded card", "收起展开卡片")} title={t("Return to whiteboard · Esc", "收起，返回画板 · Esc")} onClick={onClose}><VideoIcon name="close" /></button>
    </div>
    </header>
    <VideoViewer card={card} layout="expanded" aiOpen={aiOpen} time={time} focusRequest={focusRequest} onChange={onChange} />
  </section></VideoStatusProvider>;
}
