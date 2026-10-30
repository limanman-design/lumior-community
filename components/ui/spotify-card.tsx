'use client';
import { useI18n } from '@/app/i18n';
import { translate as t, translateSystemMessage } from '@/app/i18n-core';
import { useState, type CSSProperties } from 'react';
import { SoundIcon } from './sound-icon';
import { displaySoundTitle, displaySoundAlbum, type SoundMode, type SoundSource } from '@/lib/sound-sources';
import type { SoundStatus } from '@/lib/sound-engine';
import './spotify-card.css';

type SpotifyCardProps = {
  source: SoundSource; sources: SoundSource[]; mode: SoundMode; status: SoundStatus;
  elapsed: number; volume: number; muted: boolean;
  onMode: (mode: SoundMode) => void; onSelect: (source: SoundSource) => void;
  onPlay: () => void; onPrevious: () => void; onNext: () => void;
  onVolume: (volume: number) => void; onMute: () => void; onClose: () => void;
};
export function SoundArtwork({ source, small = false }: { source: SoundSource; small?: boolean }) {
  return <div className={`sound-art ${small ? 'is-small' : ''}`} style={{ backgroundImage: `url(${source.cover})` }} aria-hidden="true"/>;
}
const formatElapsed = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;

// Adapted from the supplied Spotify card: controlled by a real audio engine.
// Looping nature recordings and live streams have no fake seek/duration bar.
export function SpotifyCard(props: SpotifyCardProps) {
 useI18n();
  const { source, sources, mode, status, elapsed, volume, muted, onMode, onSelect, onPlay, onPrevious, onNext, onVolume, onMute, onClose } = props;
  const [browse, setBrowse] = useState(false);
  const [pointer, setPointer] = useState({ x: 50, y: 30 });
  const playing = status.phase === 'playing', loading = status.phase === 'loading';
  const action = loading ? t("Cancel loading", "取消加载") : playing ? t("Pause background sound", "暂停背景声音") : status.phase === 'error' ? t("Retry playback", "重试播放") : t("Play background sound", "播放背景声音");
  return <div className={`sound-card ${browse ? 'is-browsing' : ''}`} style={{ '--sound-pointer-x': `${pointer.x}%`, '--sound-pointer-y': `${pointer.y}%` } as CSSProperties} onPointerMove={event => { const rect = event.currentTarget.getBoundingClientRect(); setPointer({ x: (event.clientX - rect.left) / rect.width * 100, y: (event.clientY - rect.top) / rect.height * 100 }); }}>
    <div className="sound-card-glow"/>
    <div className="sound-card-heading"><strong id="sound-player-title">{t("Soundscape", "声景")}</strong><button className="sound-icon-button" aria-label={t("Close sound player", "关闭声音播放器")} onClick={onClose}><SoundIcon name="close"/></button></div>
    <div className="sound-tabs" role="tablist" aria-label={t("Sound categories", "声音分类")}>{(['ambient', 'radio'] as const).filter(category => sources.some(item => item.mode === category)).map(category => <button key={category} id={`sound-tab-${category}`} role="tab" aria-selected={mode === category} aria-controls="sound-choices" onClick={() => { onMode(category); setBrowse(true); }}>{category === 'ambient' ? t("Ambient", "环境音") : t("Radio", "电台")}</button>)}</div>
    <div className="sound-hero"><SoundArtwork source={source}/><button className="sound-cover-play" aria-label={action} onClick={onPlay}><SoundIcon name={loading ? 'progress_activity' : playing ? 'pause' : 'play_arrow'} className={loading ? 'sound-spinner' : ''}/></button></div>
    <div className="sound-now-playing"><strong>{displaySoundTitle(source)}</strong></div>
    <button className="sound-browse-toggle" aria-expanded={browse} onClick={() => setBrowse(!browse)}><span>{mode === 'ambient' ? t("Choose a sound", "选择声音") : t("Choose a station", "选择电台")}</span><SoundIcon name="keyboard_arrow_down" className={browse ? 'is-open' : ''}/></button>
    {browse && <div className="sound-choices" role="tabpanel" id="sound-choices" aria-labelledby={`sound-tab-${mode}`}>{sources.filter(item => item.mode === mode).map(item => <button key={item.id} className={`sound-choice ${source.id === item.id ? 'is-selected' : ''}`} aria-label={t("Select {title}","选择 {title}",{title:displaySoundTitle(item)})} aria-pressed={source.id === item.id} onClick={() => onSelect(item)}><SoundArtwork source={item} small/><span><strong>{displaySoundTitle(item)}</strong><small>{displaySoundAlbum(item)}</small></span>{source.id === item.id && <span className="sound-choice-dot"/>}</button>)}</div>}
    <div className="sound-player-controls">
      <div className={`sound-live-line ${loading ? 'is-loading' : ''}`} aria-hidden="true"/>
      <div className="sound-track-info"><span className="sound-track-meta"><strong>{displaySoundTitle(source)}</strong><small>{displaySoundAlbum(source)}</small></span><span className="sound-time"><span aria-label={t("Playback elapsed", "已播放时长")}>{formatElapsed(elapsed)}</span>{source.mode === 'radio' && <span className="sound-live-badge">{t("LIVE", "直播")}</span>}</span></div>
      <div className="sound-transport"><div className="sound-transport-buttons"><button className="sound-icon-button" aria-label={t("Previous sound", "上一首声音")} onClick={onPrevious}><SoundIcon name="skip_previous"/></button><button className="sound-main-play" aria-label={action} onClick={onPlay}><SoundIcon name={loading ? 'progress_activity' : playing ? 'pause' : 'play_arrow'} className={loading ? 'sound-spinner' : ''}/></button><button className="sound-icon-button" aria-label={t("Next sound", "下一首声音")} onClick={onNext}><SoundIcon name="skip_next"/></button></div><div className="sound-volume"><button className="sound-icon-button" aria-label={muted ? t("Unmute background sound", "取消背景声音静音") : t("Mute background sound", "静音背景声音")} aria-pressed={muted} onClick={onMute}><SoundIcon name={muted || volume === 0 ? 'volume_off' : 'volume_up'}/></button><input type="range" aria-label={t("Background sound volume", "背景声音音量")} min="0" max="100" step="1" value={volume} style={{ '--sound-volume': `${volume}%` } as CSSProperties} onChange={event => onVolume(Number(event.target.value))}/></div></div>
      {status.phase === 'error' && status.error && <p className="sound-playback-error" role="alert">{translateSystemMessage(status.error)}</p>}
      {source.homepage && <a className="sound-source-link" href={source.homepage} target="_blank" rel="noopener noreferrer">{t("Visit station", "访问电台")} <SoundIcon name="chevron_right"/></a>}
    </div>
  </div>;
}
