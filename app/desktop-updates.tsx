'use client';
import { useEffect, useRef, useState } from 'react';
import {
  getDesktopBridge,
  useDesktopRuntime,
  type DesktopUpdateState,
} from './desktop-bridge';
import {
  desktopUpdateCopy,
  desktopUpdateInstallFailure,
  desktopUpdateNoticeKey,
  desktopUpdateProgress,
} from './desktop-update-status';
import { useI18n } from './i18n';
import './desktop-updates.css';

type UpdateAction = 'read' | 'check' | 'install';

export function useDesktopUpdates() {
  const desktop = useDesktopRuntime();
  const supported =
    desktop && typeof getDesktopBridge()?.getUpdateState === 'function';
  const [state, setState] = useState<DesktopUpdateState | null>(null);
  const [action, setAction] = useState<UpdateAction | null>(null);
  const [failure, setFailure] = useState<UpdateAction | null>(null);
  const eventRevision = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    if (!supported) return;
    mounted.current = true;
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const revision = eventRevision.current;
    void Promise.resolve()
      .then(() => {
        if (cancelled) return null;
        const bridge = getDesktopBridge();
        if (!bridge?.getUpdateState)
          throw new Error('Update state unavailable.');
        unsubscribe = bridge.onUpdateState?.((next) => {
          if (cancelled) return;
          eventRevision.current++;
          setState(next);
          setFailure(null);
        });
        return bridge.getUpdateState();
      })
      .then(
        (next) => {
          if (!cancelled && next && revision === eventRevision.current)
            setState(next);
        },
        () => {
          if (!cancelled) setFailure('read');
        },
      );
    return () => {
      cancelled = true;
      mounted.current = false;
      unsubscribe?.();
    };
  }, [supported]);

  const run = async (nextAction: UpdateAction) => {
    if (action || !mounted.current) return;
    const bridge = getDesktopBridge();
    const method =
      nextAction === 'install'
        ? bridge?.installUpdate
        : nextAction === 'check'
          ? bridge?.checkForUpdates
          : bridge?.getUpdateState;
    if (!method) {
      setFailure(nextAction);
      return;
    }
    const revision = eventRevision.current;
    setAction(nextAction);
    setFailure(null);
    try {
      const next = await method.call(bridge);
      if (mounted.current && revision === eventRevision.current) setState(next);
    } catch {
      if (mounted.current) setFailure(nextAction);
    } finally {
      if (mounted.current) setAction(null);
    }
  };
  return {
    desktop,
    supported,
    state,
    action,
    failure,
    refresh: () => run('read'),
    check: () => run('check'),
    install: () => run('install'),
  };
}

export function DesktopUpdatesPanel({
  onBusyChange,
}: {
  onBusyChange?: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const updates = useDesktopUpdates();
  if (!updates.desktop) return null;
  const { state, action, failure, supported } = updates;
  const copy = desktopUpdateCopy(state, t);
  const progress = desktopUpdateProgress(state);
  const installing = action === 'install' || state?.status === 'installing';
  const canCheck =
    supported &&
    !!getDesktopBridge()?.checkForUpdates &&
    !!state &&
    ![
      'disabled',
      'development',
      'checking',
      'available',
      'downloading',
      'downloaded',
      'installing',
    ].includes(state.status);
  const installFailure = desktopUpdateInstallFailure(state, t);
  const install = async () => {
    onBusyChange?.(true);
    try {
      await updates.install();
    } finally {
      onBusyChange?.(false);
    }
  };
  return (
    <section className="desktop-updates-panel">
      <h3>{t('Lumior updates', 'Lumior 更新')}</h3>
      <p>
        {t(
          'New versions download automatically in the background. Ready updates install when you next quit Lumior, or you can restart now to use them.',
          '新版本会在后台自动下载。准备好后会在下次退出 Lumior 时安装，也可以立即重启升级。',
        )}
      </p>
      {state?.currentVersion && (
        <p className="desktop-updates-version">
          {t('Current version: {version}', '当前版本：{version}', {
            version: state.currentVersion,
          })}
        </p>
      )}
      <div className="data-settings-status" aria-live="polite">
        <span
          className={`save-dot ${state?.status === 'error' || failure ? 'error' : action || ['checking', 'downloading', 'installing'].includes(state?.status || '') ? 'loading' : 'saved'}`}
        />
        <div>
          <strong>
            {!supported
              ? t('Automatic updates are not enabled', '自动更新尚未启用')
              : failure === 'read' && !state
                ? t('Update status unavailable', '更新状态暂不可用')
                : copy.title}
          </strong>
          <p>
            {!supported
              ? t(
                  'This version does not have automatic updates enabled.',
                  '当前版本尚未启用自动更新。',
                )
              : copy.detail}
          </p>
        </div>
      </div>
      {state?.status === 'downloading' && (
        <div className="desktop-update-progress">
          <progress
            max={100}
            value={progress}
            aria-label={t('Update download progress', '更新下载进度')}
          />
          {progress !== undefined && <span>{progress}%</span>}
        </div>
      )}
      <div className="desktop-update-actions">
        {(state?.status === 'downloaded' || installing) &&
          !!getDesktopBridge()?.installUpdate && (
            <button
              type="button"
              className="primary"
              disabled={!!action || installing}
              onClick={() => void install()}
            >
              {installing
                ? t('Preparing to restart…', '正在准备重启…')
                : t('Restart and update', '重启并升级')}
            </button>
          )}
        {canCheck && (
          <button
            type="button"
            disabled={!!action}
            onClick={() => void updates.check()}
          >
            {action === 'check'
              ? t('Checking…', '正在检查…')
              : t('Check for updates', '检查更新')}
          </button>
        )}
        {failure === 'read' && (
          <button
            type="button"
            disabled={!!action}
            onClick={() => void updates.refresh()}
          >
            {t('Try again', '重试')}
          </button>
        )}
      </div>
      {(failure || installFailure) && (
        <p className="desktop-update-error" role="alert">
          {installFailure ||
            (failure === 'install'
              ? t(
                  'Restart did not begin. Please try again.',
                  '重启升级未能开始，请重试。',
                )
              : failure === 'read'
                ? t(
                    'The update status could not be read. Please try again.',
                    '无法读取更新状态，请重试。',
                  )
                : t(
                    'The update check did not finish. Please try again later.',
                    '检查更新未能完成，请稍后重试。',
                  ))}
        </p>
      )}
    </section>
  );
}

/** Place once in the workspace shell. Background checks and downloads stay quiet. */
export function DesktopUpdateNotice() {
  const { t } = useI18n();
  const updates = useDesktopUpdates();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = desktopUpdateNoticeKey(updates.state);
  if (!updates.desktop || !key || key === dismissed) return null;
  const installing =
    updates.action === 'install' || updates.state?.status === 'installing';
  const installFailed = updates.state?.status === 'error';
  const error =
    desktopUpdateInstallFailure(updates.state, t) ||
    (updates.failure === 'install'
      ? t(
          'Restart did not begin. Please try again.',
          '重启升级未能开始，请重试。',
        )
      : '');
  return (
    <aside
      className="desktop-update-notice"
      aria-live="polite"
      aria-label={t('Lumior update', 'Lumior 更新')}
    >
      <strong>
        {installing
          ? t('Preparing to restart…', '正在准备重启…')
          : installFailed
            ? t('Update did not finish', '更新未能完成')
            : t('Update ready', '更新已准备好')}
      </strong>
      <p>
        {installing
          ? t(
              'Saving your work before restarting Lumior.',
              '正在保存当前内容，然后重启 Lumior。',
            )
          : installFailed
            ? t(
                'You can continue working. Check for updates again when you are ready.',
                '可以继续工作，稍后再检查更新。',
              )
            : t(
                'Restart to use the new version, or keep working and install when you next quit Lumior.',
                '重启即可使用新版本，也可以继续工作，在下次退出 Lumior 时安装。',
              )}
      </p>
      {error && (
        <p className="desktop-update-error" role="alert">
          {error}
        </p>
      )}
      <div className="desktop-update-actions">
        {installFailed && !!getDesktopBridge()?.checkForUpdates ? (
          <button
            type="button"
            disabled={!!updates.action}
            onClick={() => void updates.check()}
          >
            {t('Check for updates', '检查更新')}
          </button>
        ) : (
          !!getDesktopBridge()?.installUpdate && (
            <button
              type="button"
              className="primary"
              disabled={!!updates.action || installing}
              onClick={() => void updates.install()}
            >
              {installing
                ? t('Preparing to restart…', '正在准备重启…')
                : t('Restart and update', '重启并升级')}
            </button>
          )
        )}
        <button
          type="button"
          disabled={installing}
          onClick={() => setDismissed(key)}
        >
          {t('Later', '稍后')}
        </button>
      </div>
    </aside>
  );
}
