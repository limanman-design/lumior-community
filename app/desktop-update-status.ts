import type { DesktopUpdateState } from './desktop-bridge';

type Translate = (
  en: string,
  zh: string,
  params?: Record<string, string | number>,
) => string;

export function desktopUpdateProgress(
  state: DesktopUpdateState | null,
): number | undefined {
  if (
    state?.status !== 'downloading' ||
    typeof state.progress !== 'number' ||
    !Number.isFinite(state.progress)
  )
    return undefined;
  return Math.round(Math.min(100, Math.max(0, state.progress)));
}

export function desktopUpdateNoticeKey(
  state: DesktopUpdateState | null,
): string | null {
  if (
    !state ||
    (state.status !== 'downloaded' &&
      state.status !== 'installing' &&
      !(
        state.status === 'error' &&
        state.message === 'The update could not be installed. Try again later.'
      ))
  )
    return null;
  const failure = state.status === 'error' ? ':install-error' : '';
  return `${state.currentVersion}:${state.version || 'ready'}${failure}`;
}

export function desktopUpdateInstallFailure(
  state: DesktopUpdateState | null,
  t: Translate,
): string {
  if (
    state?.message === 'Your work could not be saved. The app will stay open.'
  ) {
    return t(
      'Your work could not be saved. Lumior will stay open. Please try again.',
      '当前内容未能保存，Lumior 会保持打开，请重试。',
    );
  }
  if (
    state?.message === 'The update could not be installed. Try again later.'
  ) {
    return t(
      'The update could not be installed. Please try again later.',
      '更新暂时未能安装，请稍后重试。',
    );
  }
  return '';
}

export function desktopUpdateCopy(
  state: DesktopUpdateState | null,
  t: Translate,
): { title: string; detail: string } {
  const version = state?.version;
  switch (state?.status) {
    case 'development':
      return {
        title: t('Development preview', '开发预览'),
        detail: t(
          'The development preview shows changes as you work. Installed app updates are not downloaded here.',
          '开发预览会即时显示最新改动，无需下载安装更新。',
        ),
      };
    case 'disabled':
      return {
        title: t('Automatic updates are not enabled', '自动更新尚未启用'),
        detail: t(
          'This version does not have automatic updates enabled.',
          '当前版本尚未启用自动更新。',
        ),
      };
    case 'checking':
      return {
        title: t('Checking for updates…', '正在检查更新…'),
        detail: t(
          'You can continue working while Lumior checks for updates.',
          '检查期间可以继续工作。',
        ),
      };
    case 'available':
      return {
        title: version
          ? t('Lumior {version} is available', '发现 Lumior {version}', {
              version,
            })
          : t('An update is available', '发现新版本'),
        detail: t(
          'The update will download in the background.',
          '更新将在后台自动下载。',
        ),
      };
    case 'downloading':
      return {
        title: version
          ? t('Downloading Lumior {version}', '正在下载 Lumior {version}', {
              version,
            })
          : t('Downloading the update', '正在下载更新'),
        detail: t(
          'The update is downloading in the background. You can continue working.',
          '更新正在后台下载，可以继续工作。',
        ),
      };
    case 'downloaded':
      return {
        title: t('Update ready', '更新已准备好'),
        detail: version
          ? t(
              'Lumior {version} has been downloaded. Restart to use it.',
              'Lumior {version} 已下载，重启即可使用。',
              { version },
            )
          : t(
              'The update has been downloaded. Restart to use it.',
              '更新已下载，重启即可使用。',
            ),
      };
    case 'installing':
      return {
        title: t('Preparing to restart…', '正在准备重启…'),
        detail: t(
          'Saving your work before restarting Lumior.',
          '正在保存当前内容，然后重启 Lumior。',
        ),
      };
    case 'up-to-date':
      return {
        title: t('You are up to date', '已是最新版本'),
        detail: t(
          'Lumior will keep checking for new versions in the background.',
          'Lumior 会继续在后台检查新版本。',
        ),
      };
    case 'error':
      return {
        title: t('Updates are temporarily unavailable', '更新暂时不可用'),
        detail: t(
          'The update did not finish. Please try again later.',
          '更新未能完成，请稍后重试。',
        ),
      };
    case 'idle':
      return {
        title: t('Automatic updates are enabled', '自动更新已启用'),
        detail: t(
          'Lumior checks for new versions in the background.',
          'Lumior 会在后台自动检查新版本。',
        ),
      };
    default:
      return {
        title: t('Reading update status…', '正在读取更新状态…'),
        detail: t(
          'Checking which version is installed.',
          '正在确认当前应用版本。',
        ),
      };
  }
}
