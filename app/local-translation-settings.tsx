'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { getDesktopBridge, type LocalTranslationState } from './desktop-bridge';
import { useI18n } from './i18n';
import './local-translation-settings.css';

const preference = 'lumior.pdf-translation-engine.v1';
const changed = 'lumior-local-translation-choice';
export function selectedTranslationEngine(): 'cloud' | 'local' {
  if (!getDesktopBridge()?.startLocalTranslation) return 'cloud';
  try { return localStorage.getItem(preference) === 'local' ? 'local' : 'cloud'; } catch { return 'cloud'; }
}
function selectEngine(value: 'local' | 'cloud') {
  localStorage.setItem(preference, value);
  window.dispatchEvent(new Event(changed));
}
function subscribe(callback: () => void) {
  window.addEventListener(changed, callback);
  window.addEventListener('storage', callback);
  return () => { window.removeEventListener(changed, callback); window.removeEventListener('storage', callback); };
}
export function useTranslationEngine() {
  return useSyncExternalStore(subscribe, selectedTranslationEngine, () => 'cloud' as const);
}
export function LocalTranslationSettings() {
  const { t } = useI18n();
  const bridge = getDesktopBridge();
  const engine = useTranslationEngine();
  const [state, setState] = useState<LocalTranslationState>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!bridge?.getLocalTranslationState) return;
    let active = true;
    void bridge.getLocalTranslationState().then(value => { if (active) setState(value); }).catch(() => { if (active) setError(t('Could not read local translation status.', '无法读取本地翻译状态。')); });
    const unsubscribe = bridge.onLocalTranslationState?.(value => { if (active) setState(value); });
    return () => { active = false; unsubscribe?.(); };
  }, [bridge, t]);
  if (!bridge?.getLocalTranslationState) return null;
  const downloading = state?.status === 'downloading';
  const running = state?.status === 'starting' || state?.status === 'running';
  const action = async (fn?: () => Promise<LocalTranslationState>) => {
    if (!fn) return;
    setPending(true); setError('');
    try { setState(await fn()); } catch (failure) { setError(failure instanceof Error ? failure.message : t('Operation failed.', '操作失败。')); }
    finally { setPending(false); }
  };
  return <section className="local-translation-settings" aria-label={t('Local translation extension', '本地翻译扩展')}>
    <strong>{t('Local translation · Optional download', '本地翻译 · 按需下载')}</strong>
    <p>{t('HY-MT2-1.8B · About 1.13 GB plus the runner. After installation, PDF text stays on this computer. No API key or cloud credits required.', 'HY-MT2-1.8B · 模型约 1.13 GB，另含运行组件。安装后 PDF 文字只在本机处理，无需 Key，不消耗云端额度。')}</p>
    <p>{t('For reading assistance. Select a sentence or paragraph in a text PDF, then choose Translate locally. You can also translate the whole PDF locally. Scanned pages are not supported yet.', '适合辅助阅读。PDF 中拖选一句或一段，点击“本地翻译”即可查看译文；也支持整篇 PDF 本地翻译。暂不支持扫描页。')}</p>
    {state && !state.supported ? <output>{t('Available on Mac and Windows x64 supported configurations.', '此电脑配置暂不支持本地翻译。')}</output> : <>
      <div className="local-translation-actions">
        {!state?.installed && !downloading && <button type="button" disabled={!state || pending} onClick={() => void action(bridge.installLocalTranslation)}>{t('Download and install', '下载并安装')}</button>}
        {downloading && <button type="button" onClick={() => void action(bridge.cancelLocalTranslationDownload)}>{t('Cancel download', '取消下载')}</button>}
        {state?.installed && <button type="button" disabled={pending || running} onClick={() => void action(bridge.removeLocalTranslation)}>{t('Uninstall extension', '卸载扩展')}</button>}
        <output>{downloading ? `${t('Downloading', '正在下载')} ${Math.round((state?.progress || 0) * 100)}%` : running ? t('Translating locally', '本地翻译运行中') : state?.status === 'standby' ? t('Ready · releases memory after 5 idle minutes', '待命中 · 闲置 5 分钟后释放内存') : state?.installed ? t('Installed', '已安装') : t('Not installed', '未安装')}</output>
      </div>
      {downloading && <progress max={100} value={(state?.progress || 0) * 100} aria-label={t('Download progress', '下载进度')} />}
      <label><input type="checkbox" checked={engine === 'local'} disabled={running || (!state?.installed && engine !== 'local')} onChange={event => { try { selectEngine(event.target.checked ? 'local' : 'cloud'); } catch { setError(t('Could not save this choice.', '无法保存选择。')); } }} />{t('Use local translation for whole PDFs', '整篇 PDF 使用本地翻译')}</label>
      <p>{t('Local failures never switch to the cloud automatically. Turning this off keeps your saved translations.', '本地失败时不会自动切换云端。关闭后仍保留已保存的译文。')}</p>
    </>}
    {(error || state?.error) && <p role="alert">{error || state?.error}</p>}
  </section>;
}
