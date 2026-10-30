'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- The animated preview is painted on canvas, not a static image. */
import { useEffect, useId, useRef, useState } from 'react';
import { DialogTitle } from '@/components/ui/dialog';
import { getDesktopBridge, type DesktopPetState } from './desktop-bridge';
import { ChevronDown, Pencil } from 'lucide-react';
import { useI18n } from './i18n';
import './desktop-pet.css';
import { petAnimationDefaults, petAnimationRanges, type PetAnimationOptions, type PetNumericOption } from './pet-animation-options';

type PetAnimation = { ready: Promise<unknown>; start: () => void; destroy: () => void; setOptions: (options: PetAnimationOptions) => void; setEyes: (eyes: string | null) => void };
type PetPlayerModule = { LumiorPet: new (canvas: HTMLCanvasElement, data: unknown, options: PetAnimationOptions) => PetAnimation };

function PetPreview({ size, options }: { size: number; options: PetAnimationOptions }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<PetAnimation | null>(null), latest = useRef(options);
  useEffect(() => { latest.current = options; }, [options]);
  const [failed, setFailed] = useState(false);
  const { t } = useI18n();
  useEffect(() => {
    let cancelled = false, animation: PetAnimation | undefined;
    const load = async () => {
      const urls = ['lumior-pet.js', 'pet-data@2x.js'].map(name => `/assets/lumior-pet/${name}`);
      const [player, data] = await Promise.all(urls.map(url => import(/* @vite-ignore */ url)));
      if (cancelled || !canvas.current) return;
      animation = new (player as PetPlayerModule).LumiorPet(canvas.current, data.default, latest.current);
      await animation.ready;
      if (cancelled) animation.destroy(); else { playerRef.current = animation; animation.setOptions(latest.current); animation.setEyes(latest.current.eyes === 'auto' ? null : latest.current.eyes); animation.start(); }
    };
    void load().catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; playerRef.current = null; animation?.destroy(); };
  }, []);
  useEffect(() => { playerRef.current?.setOptions(options); playerRef.current?.setEyes(options.eyes === 'auto' ? null : options.eyes); }, [options]);
  return <div className="pet-preview-character" style={{ width: Math.round(104 * size / 100), height: Math.round(112 * size / 100) }}>
    <canvas ref={canvas} role="img" aria-label={t('Lumior idle animation', 'Lumior 待机动画')} />
    {failed && <span>{t('Preview unavailable', '预览暂不可用')}</span>}
  </div>;
}

export function DesktopPetPanel({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<DesktopPetState>();
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const [customizing, setCustomizing] = useState(false), [size, setSize] = useState(100);
  const [options, setOptions] = useState<PetAnimationOptions>({ ...petAnimationDefaults });
  const pending = useRef(false), adjusting = useRef(false);
  const customId = useId(), sizeId = useId();
  useEffect(() => {
    const bridge = getDesktopBridge(); let cancelled = false, events = 0;
    const receive = (next: DesktopPetState) => { setState(next); if (!adjusting.current) { setSize(next.size ?? 100); setOptions(next.animation ?? { ...petAnimationDefaults }); } };
    const unsubscribe = bridge?.onPetState?.(next => { events++; receive(next); });
    bridge?.getPetState?.().then(next => { if (!cancelled && !events) receive(next); }, () => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; unsubscribe?.(); };
  }, []);
  const run = async (action: () => Promise<DesktopPetState | void>) => {
    if (pending.current || !state) return;
    pending.current = true; setBusy(true); onBusyChange(true); setFailed(false);
    try { const next = await action(); if (next) { setState(next); setSize(next.size ?? 100); setOptions(next.animation ?? { ...petAnimationDefaults }); } }
    catch { setFailed(true); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  };
  const applySize = (next: number) => {
    adjusting.current = false;
    if (next !== (state?.size ?? 100)) void run(() => getDesktopBridge()!.setPetSize!(next));
  };
  const supported = !!state?.supported;
  const applyOptions = (next: PetAnimationOptions) => {
    adjusting.current = false;
    if (JSON.stringify(next) !== JSON.stringify(state?.animation ?? petAnimationDefaults)) void run(() => getDesktopBridge()!.setPetAnimation!(next));
  };
  const updateOption = (key: PetNumericOption, value: number) => {
    const next = { ...options, [key]: value };
    if (key === 'blinkMin') next.blinkMax = Math.max(value, next.blinkMax);
    if (key === 'blinkMax') next.blinkMin = Math.min(value, next.blinkMin);
    return next;
  };
  const slider = (key: PetNumericOption, en: string, zh: string, unit = '') => {
    const [min, max, step] = petAnimationRanges[key], id = `${customId}-${key}`;
    const display = key === 'doubleBlinkChance' ? `${Math.round(options[key] * 100)}%` : `${Number(options[key].toFixed(2))}${unit}`;
    const commit = (value: string) => applyOptions(updateOption(key, Number(value)));
    return <div className="pet-parameter" key={key}><label htmlFor={id}>{t(en, zh)}</label><input id={id} type="range" min={min} max={max} step={step} value={options[key]} aria-valuetext={display} disabled={!supported || !getDesktopBridge()?.setPetAnimation} aria-disabled={busy}
      onPointerDown={event => { if (pending.current) event.preventDefault(); }} onKeyDown={event => { if (pending.current) event.preventDefault(); }}
      onChange={event => { if (pending.current) return; adjusting.current = true; setOptions(updateOption(key, Number(event.target.value))); }}
      onPointerUp={event => commit(event.currentTarget.value)} onKeyUp={event => commit(event.currentTarget.value)} onBlur={event => commit(event.currentTarget.value)} /><output htmlFor={id}>{display}</output></div>;
  };
  return <section className="desktop-pet-panel">
    <div className="pet-settings-heading">
      <div><DialogTitle>{t('Desktop pet', '桌宠与速记')}</DialogTitle><p>{t('A small companion for your desktop. Click to capture an idea.', '让灵感有个落脚点，点击桌宠就能开始速记。')}</p></div>
      <button type="button" className="pet-visibility-toggle" disabled={!supported || busy} aria-pressed={!!state?.enabled} aria-busy={busy} onClick={() => void run(() => getDesktopBridge()!.setPetEnabled!(!state?.enabled))}>{state?.enabled ? t('Hide pet', '隐藏桌宠') : t('Show pet', '显示桌宠')}</button>
    </div>
    <div className="pet-preview-card">
      <div className="pet-preview-stage"><PetPreview size={size} options={options} /></div>
      <div className="pet-preview-actions">
        <span className="pet-quick-note-hint"><Pencil size={18} aria-hidden="true" /><span>{t('Quick note', '速记')}</span></span>
      </div>
      <button type="button" className="pet-customize-toggle" aria-expanded={customizing} aria-controls={customId} onClick={() => setCustomizing(value => !value)}>{t('Customize', '自定义')}<ChevronDown size={16} aria-hidden="true" /></button>
    </div>
    {customizing && <div className="pet-customization" id={customId}>
      <div className="pet-size-heading"><label htmlFor={sizeId}>{t('Pet size', '桌宠大小')}</label><output htmlFor={sizeId}>{size}%</output></div>
      <input id={sizeId} type="range" min={75} max={300} step={5} value={size} disabled={!supported || !getDesktopBridge()?.setPetSize} aria-disabled={busy} aria-valuetext={`${size}%`} onPointerDown={event => { if (pending.current) event.preventDefault(); }} onKeyDown={event => { if (pending.current) event.preventDefault(); }} onChange={event => { if (pending.current) return; adjusting.current = true; setSize(Number(event.target.value)); }} onPointerUp={event => applySize(Number(event.currentTarget.value))} onKeyUp={event => applySize(Number(event.currentTarget.value))} onBlur={event => applySize(Number(event.currentTarget.value))} />
      <div className="pet-size-footer"><span>{t('Small', '小')}</span><button type="button" disabled={!supported || busy || size === 100} onClick={() => { setSize(100); applySize(100); }}>{t('Reset to default', '恢复默认')}</button><span>{t('Large', '大')}</span></div>
      <div className="pet-parameter-group"><h3>{t('Motion', '常用动画')}</h3>
        {slider('breathAmp', 'Breathing amplitude', '呼吸幅度')}{slider('breathPeriod', 'Breathing period', '呼吸周期', 's')}
        {slider('tiltDeg', 'Head tilt', '歪头角度', '°')}{slider('tiltPeriod', 'Tilt period', '歪头周期', 's')}
        {slider('swayAmount', 'Hair sway', '头发摆动幅度')}{slider('swayPeriod', 'Sway period', '头发摆动周期', 's')}
      </div>
      <div className="pet-parameter-group"><h3>{t('Blinking', '眨眼')}</h3>
        {slider('blinkMin', 'Minimum interval', '最短间隔', 's')}{slider('blinkMax', 'Maximum interval', '最长间隔', 's')}{slider('doubleBlinkChance', 'Double blink chance', '连眨概率')}
        <div className="pet-eye-controls" role="group" aria-label={t('Eye state', '眼睛状态')}>
          {(['auto', 'open', 'closed'] as const).map((eyes, index) => <button type="button" key={eyes} aria-pressed={options.eyes === eyes} disabled={!supported || busy} onClick={() => { const next = { ...options, eyes }; setOptions(next); applyOptions(next); }}>{t(['Auto', 'Open', 'Closed'][index], ['自动', '睁眼', '闭眼'][index])}</button>)}
        </div>
      </div>
      <details className="pet-parameter-group"><summary>{t('Advanced', '高级')}</summary>
        {slider('headLag', 'Head delay', '头部延迟')}{slider('holdLag', 'Hand and paper delay', '纸手延迟')}
        <div className="pet-fps"><span>{t('Frame rate', '帧率上限')}</span>{[15, 30].map(fps => <button type="button" key={fps} disabled={!supported || busy} aria-pressed={options.fps === fps} onClick={() => { const next = { ...options, fps }; setOptions(next); applyOptions(next); }}>{fps === 15 ? t('15 · Lower power', '15 · 省电') : t('30 · Smooth', '30 · 流畅')}</button>)}</div>
      </details>
      <button className="pet-reset-animation" type="button" disabled={!supported || busy} onClick={() => { const next = { ...petAnimationDefaults }; setOptions(next); applyOptions(next); }}>{t('Reset animation', '恢复默认动画')}</button>
      <p>{t('Changes are saved automatically and kept the next time you open Lumior.', '调整后自动保存，下次启动仍会保留。')}</p>
    </div>}
    <div className="pet-settings-help"><p>{t('Click to write, drag to move, or right-click for more.', '点击开始速记，拖动调整位置，右键打开更多操作。')}</p><p>{t('Notes go to Home and Recents. Unfinished drafts are kept automatically.', '笔记保存到首页根目录并进入最近列表，未完成的草稿会自动保留。')}</p><p>{t('The pet stays when you close the main window. Quit Lumior from the app menu to close both.', '关闭主窗口后，桌宠会继续陪伴；从应用菜单退出 Lumior 时一并关闭。')}</p></div>
    {(failed || state?.error) && <p className="pet-settings-error" role="alert">{state?.error || t('Could not apply the change. Please retry.', '设置未能应用，请重试。')}</p>}
  </section>;
}
