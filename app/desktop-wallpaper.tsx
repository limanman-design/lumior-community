'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from './i18n';
import { getDesktopBridge, type DesktopWallpaperScene, type DesktopWallpaperState } from './desktop-bridge';
import './desktop-wallpaper.css';

export function DesktopWallpaperPanel({ onBusyChange }: { onBusyChange?: (busy: boolean) => void }) {
  const { t } = useI18n();
  const [state, setState] = useState<DesktopWallpaperState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(false);
  const mounted = useRef(false), revision = useRef(0), pending = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    const bridge = getDesktopBridge(), initialRevision = revision.current;
    const unsubscribe = bridge?.onWallpaperState?.(next => {
      if (cancelled) return;
      revision.current++;
      setState(next);
    });
    void Promise.resolve().then(() => {
      if (!bridge?.getWallpaperState) throw new Error('Wallpaper state unavailable.');
      return bridge.getWallpaperState();
    }).then(next => {
        if (!cancelled && initialRevision === revision.current) setState(next);
    }, () => { if (!cancelled) setFailure(true); });
    return () => { cancelled = true; mounted.current = false; unsubscribe?.(); };
  }, []);
  const run = async (action: () => Promise<DesktopWallpaperState>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setFailure(false); onBusyChange?.(true);
    const startRevision = revision.current;
    try {
      const next = await action();
      if (mounted.current && revision.current === startRevision) setState(next);
    } catch { if (mounted.current) setFailure(true); }
    finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
      onBusyChange?.(false);
    }
  };
  const bridge = getDesktopBridge();
  const supported = !!state?.supported && !!bridge?.setWallpaperEnabled && !!bridge?.setWallpaperScene;
  const scene = (value: DesktopWallpaperScene) => run(() => bridge!.setWallpaperScene!(value));
  return <section className="desktop-wallpaper-panel">
    <div className="wallpaper-status-row">
      <div><h3>{t('Memory Sea on your desktop', '桌面上的星海')}</h3>
        <p>{t('Let the sea or galaxy flow quietly behind the icons on your main display.', '让海岸或星河在主显示器的桌面图标后方安静流动。')}</p></div>
      <button type="button" aria-pressed={!!state?.enabled} disabled={!supported || busy}
        onClick={() => run(() => bridge!.setWallpaperEnabled!(!state!.enabled))}>
        {busy ? t('Applying…', '正在应用…') : state?.enabled ? t('Turn off wallpaper', '关闭动态壁纸') : t('Enable wallpaper', '启用动态壁纸')}
      </button>
    </div>
    <fieldset className="wallpaper-scenes" aria-label={t('Wallpaper scene', '壁纸场景')}>
      {(['galaxy', 'shore'] as const).map(value => <button type="button" key={value} aria-pressed={state?.scene === value}
        disabled={!supported || busy} onClick={() => void scene(value)}>
        <span aria-hidden="true" className={`wallpaper-swatch wallpaper-swatch-${value}`} />
        <strong>{value === 'galaxy' ? t('Galaxy', '星河') : t('Coast', '海岸')}</strong>
      </button>)}
    </fieldset>
    <output className="wallpaper-current">{state?.enabled
      ? state.paused ? t('Wallpaper is paused to save power or while the system rests.', '动态壁纸已暂停，等待接通电源或系统恢复。') : t('Dynamic wallpaper is on.', '动态壁纸已开启。')
      : t('Your original desktop background is active.', '当前使用原来的桌面背景。')}</output>
    {(failure || state?.error) && <p className="wallpaper-failure" role="alert">{state?.enabled && state.error
      ? t('The wallpaper is on, but its preference could not be saved. You may need to enable it again next time.', '壁纸已开启，但偏好未能保存，下次启动可能需要重新开启。')
      : t('The wallpaper could not be applied. Your original background is still available. Try again.', '动态壁纸未能应用，原桌面背景仍然可用，请重试。')}</p>}
    {state && !state.supported && <p>{t('Dynamic wallpaper is available in the packaged Mac app.', '动态壁纸可在安装后的 Mac 应用中使用。')}</p>}
    <p className="wallpaper-footnote">{t('Animation pauses on battery power, screen lock and sleep. Turning it off or quitting Lumior restores your original background.', '电池供电、锁屏和睡眠时自动暂停。关闭此功能或退出 Lumior，会恢复原来的桌面背景。')}</p>
  </section>;
}
