'use client';
import { useI18n } from './i18n';
import { translate as t, translateSystemMessage } from './i18n-core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
import { SoundIcon } from '@/components/ui/sound-icon';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { Dialog, DialogClose, DialogDescription, DialogOverlay, DialogPortal, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SpotifyCard } from '@/components/ui/spotify-card';
import { SoundOptionWheel } from './sound-option-wheel';
import { SoundEngine, type SoundStatus } from '@/lib/sound-engine';
import { displaySoundTitle, defaultSoundPreferences, readSoundPreferences, soundSources, soundStorageKey, type SoundMode, type SoundSource } from '@/lib/sound-sources';
import './sound-dock.css';

export function SoundDock({ children, visible = true, onInteract }: { children?: ReactNode; visible?: boolean; onInteract: () => void }) {
 useI18n();
  const [open, setOpen] = useState(false), [playlistOpen, setPlaylistOpen] = useState(false), [moreOpen, setMoreOpen] = useState(false);
  const [preferences, setPreferences] = useState(defaultSoundPreferences);
  const [ready, setReady] = useState(false), [mode, setMode] = useState<SoundMode>('ambient');
  const [portal, setPortal] = useState<HTMLElement | null>(null);
  const [status, setStatus] = useState<SoundStatus>({ phase: 'paused' }), [elapsed, setElapsed] = useState(0);
  const engine = useRef<SoundEngine | null>(null);
  const moreButton = useRef<HTMLButtonElement | null>(null);
  const playlistRegion = useRef<HTMLDivElement | null>(null);
  const source = soundSources.find(item => item.id === preferences.sourceId) || soundSources[0];
  const active = status.phase === 'playing' || status.phase === 'loading';
  useEffect(() => {
    const audio = new SoundEngine(setStatus); engine.current = audio;
    // Initial hydration reads browser storage; defaults remain identical to SSR.
    const frame = requestAnimationFrame(() => {
      setStatus({ phase: 'paused' }); setElapsed(0);
      setPortal(document.body);
      try { const stored = readSoundPreferences(localStorage.getItem(soundStorageKey)); setPreferences(stored); setMode(soundSources.find(item => item.id === stored.sourceId)?.mode || 'ambient'); } catch { /* Storage is optional; playback still works. */ }
      setReady(true);
    });
    return () => { cancelAnimationFrame(frame); audio.dispose(); engine.current = null; };
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem(soundStorageKey, JSON.stringify(preferences)); } catch { /* Keep usable without storage. */ } } }, [preferences, ready]);
  useEffect(() => { engine.current?.setVolume(preferences.volume, preferences.muted); }, [preferences.volume, preferences.muted, status.phase]);
  useEffect(() => {
    const update = () => setElapsed(engine.current?.elapsed || 0);
    update();
    if (!active) return;
    const timer = setInterval(update, 500); return () => clearInterval(timer);
  }, [active, source.id]);
  useEffect(() => { if (!visible) { const frame = requestAnimationFrame(() => { setOpen(false); setPlaylistOpen(false); setMoreOpen(false); }); return () => cancelAnimationFrame(frame); } }, [visible]);
  const toggle = () => { onInteract(); if (active) engine.current?.pause(); else void engine.current?.play(source, preferences.volume, preferences.muted); };
  const select = (next: SoundSource) => {
    if (next.id === source.id) return;
    setPreferences(value => ({ ...value, sourceId: next.id })); setMode(next.mode); setElapsed(0);
    if (active) void engine.current?.play(next, preferences.volume, preferences.muted);
    else engine.current?.pause(true);
  };
  const activate = (next: SoundSource) => {
    onInteract();
    const changed = next.id !== source.id;
    if (changed) {
      setPreferences(value => ({ ...value, sourceId: next.id })); setMode(next.mode); setElapsed(0);
    }
    if (changed || !active) void engine.current?.play(next, preferences.volume, preferences.muted);
  };
  const skip = (direction: number) => {
    const list = soundSources.filter(item => item.mode === source.mode), index = list.findIndex(item => item.id === source.id);
    select(list[(index + direction + list.length) % list.length]);
  };
  const mute = () => setPreferences(value => ({ ...value, muted: !value.muted }));
  const openPlayer = () => { onInteract(); setPlaylistOpen(false); setMoreOpen(false); setOpen(true); };
  const playbackAction = status.phase === 'loading' ? t("Cancel loading", "取消加载") : active ? t("Pause background sound", "暂停背景声音") : status.phase === 'error' ? t("Retry playback", "重试播放") : t("Play background sound", "播放背景声音");
  const playbackHint = status.phase === 'loading' ? t("Cancel loading", "取消加载") : active ? t("Pause · {title}", "暂停 · {title}", { title: displaySoundTitle(source) }) : t("Play · {title}", "播放 · {title}", { title: displaySoundTitle(source) });
  const dock = <div className={`sound-dock ${visible ? '' : 'is-global'}`}>
    <div className="sound-dock-controls" onPointerDown={event => event.stopPropagation()}>
      <Tooltip><TooltipTrigger render={<button type="button" className={`sound-dock-play ${active ? 'is-active' : ''}`} aria-label={playbackAction} aria-pressed={active} aria-busy={status.phase === 'loading'} disabled={!ready} onClick={toggle}><SoundIcon name={active ? 'pause' : 'play_arrow'}/></button>}/><TooltipContent className="lumior-tooltip" side="top" sideOffset={10}>{playbackHint}</TooltipContent></Tooltip>
      <Dialog open={playlistOpen} onOpenChange={next => { onInteract(); if (next) { setOpen(false); setMoreOpen(false); } setPlaylistOpen(next); }}>
        <Tooltip><TooltipTrigger render={<DialogTrigger className="sound-dock-music" aria-label={t("Playlist", "播放列表")}><SoundIcon name="queue_music"/></DialogTrigger>}/><TooltipContent className="lumior-tooltip" side="top" sideOffset={10}>{t("Playlist", "播放列表")}</TooltipContent></Tooltip>
        <DialogPortal>
        <DialogOverlay className="sound-playlist-backdrop"/>
        {/* A docked picker must not inherit the shared dialog's centering translate or zoom animation. */}
        <DialogPrimitive.Popup data-slot="dialog-content" className="sound-player sound-playlist" initialFocus={() => playlistRegion.current?.querySelector<HTMLElement>('[role=listbox]') || true}>
          <DialogTitle className="sr-only">{t("Playlist", "播放列表")}</DialogTitle>
          <DialogDescription className="sr-only">{t("Scroll, drag or use the arrow keys to choose a sound. Click an item or press Enter/Space to play. Press Escape to close.", "滚动、拖动或使用方向键选择音源，点击音源或按 Enter/空格播放，按 Escape 关闭。")}</DialogDescription>
          <div className="sound-playlist-region" ref={playlistRegion}>{playlistOpen && <SoundOptionWheel items={soundSources.map(item => ({ id: item.id, label: displaySoundTitle(item) }))} selectedId={source.id} onSelect={id => { const next = soundSources.find(item => item.id === id); if (next) select(next); }} onActivate={id => { const next = soundSources.find(item => item.id === id); if (next) activate(next); }} ariaLabel={t("Sound sources", "音源列表")}/>}</div>
          <DialogClose className="sound-playlist-close" aria-label={t("Close playlist", "关闭播放列表")}><SoundIcon name="close"/></DialogClose>
        </DialogPrimitive.Popup>
        </DialogPortal>
      </Dialog>
      <DropdownMenu open={moreOpen} onOpenChange={next => { onInteract(); if (next) { setOpen(false); setPlaylistOpen(false); } setMoreOpen(next); }}><Tooltip><TooltipTrigger render={<DropdownMenuTrigger ref={moreButton} className="sound-dock-more" aria-label={t("Sound options", "声音选项")}><SoundIcon name="more_horiz"/></DropdownMenuTrigger>}/><TooltipContent className="lumior-tooltip" side="top" sideOffset={10}>{t("Sound options", "声音选项")}</TooltipContent></Tooltip><DropdownMenuContent className="lumior-menu sound-menu" side="top" align="end" sideOffset={12} finalFocus={open ? false : undefined}><DropdownMenuItem onClick={openPlayer}><SoundIcon name="tune"/>{t("Open player", "打开播放器")}</DropdownMenuItem><DropdownMenuSeparator/><DropdownMenuItem onClick={mute}>{preferences.muted ? <SoundIcon name="volume_up"/> : <SoundIcon name="volume_off"/>} {preferences.muted ? t("Unmute", "取消静音") : t("Mute", "静音")}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverContent className="sound-player" anchor={moreButton} side="top" align="end" sideOffset={12} aria-labelledby="sound-player-title" finalFocus={moreButton}><SpotifyCard source={source} sources={soundSources} mode={mode} status={status} elapsed={elapsed} volume={preferences.volume} muted={preferences.muted} onMode={setMode} onSelect={select} onPlay={toggle} onPrevious={() => skip(-1)} onNext={() => skip(1)} onVolume={volume => setPreferences(value => ({ ...value, volume, muted: false }))} onMute={mute} onClose={() => setOpen(false)}/></PopoverContent>
      </Popover>
    </div>
    {status.phase === 'error' && status.error && !open && <p className="sound-dock-feedback" role="alert">{translateSystemMessage(status.error)}</p>}
    {visible && children}
  </div>;
  return visible ? dock : portal && (active || open || playlistOpen || moreOpen) ? createPortal(dock, portal) : null;
}
