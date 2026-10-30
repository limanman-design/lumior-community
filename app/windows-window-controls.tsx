'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { getDesktopBridge, type WindowCloseBehavior, type DesktopWindowState } from './desktop-bridge';
import { MaterialIcon } from './material-icon';
import { useI18n } from './i18n';
import { SettingsSelect } from './settings-select';

const menus = [
  { id: 'file', en: 'File', zh: '文件' },
  { id: 'edit', en: 'Edit', zh: '编辑' },
  { id: 'view', en: 'View', zh: '视图' },
  { id: 'window', en: 'Window', zh: '窗口' },
] as const;

export function WindowsWindowMenus() {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const pending = useRef(false);
  return <nav className="windows-window-menus" aria-label={t('Application menus', '应用菜单')}>
    {menus.map(menu => <button type="button" key={menu.id} aria-haspopup="menu" aria-expanded={open === menu.id} onClick={async event => {
      const bridge = getDesktopBridge();
      if (!bridge?.openWindowMenu || pending.current) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      pending.current = true;
      setOpen(menu.id);
      try { await bridge.openWindowMenu({ menu: menu.id, x: bounds.left, y: bounds.bottom }); }
      catch { /* A closing window can dismiss a native popup before it opens. */ }
      finally { pending.current = false; setOpen(null); }
    }}>{t(menu.en, menu.zh)}</button>)}
  </nav>;
}

export function WindowsCaptionButtons() {
  const { t } = useI18n();
  const [state, setState] = useState<DesktopWindowState>({ maximized: false, fullscreen: false });
  useEffect(() => {
    const bridge = getDesktopBridge();
    let disposed = false, changed = false;
    const unsubscribe = bridge?.onWindowState?.(next => { changed = true; setState(next); });
    void bridge?.getWindowState?.().then(next => { if (!disposed && !changed) setState(next); }).catch(() => {});
    return () => { disposed = true; unsubscribe?.(); };
  }, []);
  const restore = state.maximized || state.fullscreen;
  const act = (action: 'minimize' | 'toggle-maximize' | 'close') => {
    void getDesktopBridge()?.performWindowAction?.(action).catch(() => { /* The native window may already be closing. */ });
  };
  return <nav className="windows-caption-buttons" aria-label={t('Window controls', '窗口控制')}>
    <button type="button" title={t('Minimize', '最小化')} aria-label={t('Minimize', '最小化')} onClick={() => act('minimize')}><MaterialIcon name="remove" size={20} /></button>
    <button type="button" title={restore ? t('Restore', '还原') : t('Maximize', '最大化')} aria-label={restore ? t('Restore', '还原') : t('Maximize', '最大化')} onClick={() => act('toggle-maximize')}><MaterialIcon name={restore ? 'filter_none' : 'crop_square'} size={20} /></button>
    <button type="button" className="windows-caption-close" title={t('Close window', '关闭窗口')} aria-label={t('Close window', '关闭窗口')} onClick={() => act('close')}><MaterialIcon name="close" size={20} /></button>
  </nav>;
}

export function WindowsCloseSettings() {
  const { t } = useI18n();
  const id = useId();
  const [behavior, setBehavior] = useState<WindowCloseBehavior>('ask');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    void getDesktopBridge()?.getWindowPreferences?.().then(value => {
      if (!disposed) setBehavior(value.closeBehavior);
    }).catch(() => { if (!disposed) setError(true); }).finally(() => { if (!disposed) setBusy(false); });
    return () => { disposed = true; };
  }, []);
  return <section>
    <h3>{t('Window', '窗口')}</h3>
    <div className="settings-language-row">
      <div>
        <label htmlFor={id}>{t('When closing the window', '点击窗口关闭按钮时')}</label>
        <p>{t('Minimize keeps Lumior in the taskbar. Exit saves your workspace and closes the app.', '最小化后仍在任务栏运行；退出会保存工作区并关闭应用。')}</p>
      </div>
      <SettingsSelect id={id} label={t('Close behavior', '关闭行为')} value={behavior} disabled={busy} options={[
        { value: 'ask', label: t('Ask each time', '每次询问') },
        { value: 'minimize', label: t('Minimize to taskbar', '最小化到任务栏') },
        { value: 'quit', label: t('Exit Lumior', '退出 Lumior') },
      ]} onChange={value => {
        const save = getDesktopBridge()?.setWindowCloseBehavior;
        if (!save) return;
        setBusy(true); setError(false);
        void save(value as WindowCloseBehavior).then(result => setBehavior(result.closeBehavior)).catch(() => setError(true)).finally(() => setBusy(false));
      }} />
    </div>
    {error && <p role="alert">{t('Could not load or save window settings. Please try again.', '未能读取或保存窗口设置，请重试。')}</p>}
  </section>;
}
