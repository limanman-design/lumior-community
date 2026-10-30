'use client';
import { useI18n } from './i18n';
import { translateSystemMessage } from './i18n-core';
/* oxlint-disable next/no-img-element -- Reuse the existing bundled workspace avatar. */
import { useEffect, useId, useRef, useState } from 'react';
import { DialogClose } from '@/components/ui/dialog';
import { MaterialIcon } from './material-icon';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { readWorkspaceBackup, type PreparedBackup } from './workspace-backup';
import { pickWorkspaceBackupDirectory, readWorkspaceDirectoryBackup, type BackupDirectoryHandle, type PreparedDirectoryBackup } from './workspace-directory-backup';
import type { SaveStatus } from './local-repository';
import { StoragePanel } from './storage-panel';
import type { StorageReport } from './storage-management';
import './data-settings.css';
import './settings-center.css';
import { useNoteSizePreferences } from './use-note-size-preferences';
import { NoteSizeSettings } from './note-size-settings';
import { SettingsSelect } from './settings-select';
import { WindowsCloseSettings } from './windows-window-controls';
import {
  desktopOpenAiSettingsEvent,
  useDesktopRuntime,
  useDesktopPlatform,
} from './desktop-bridge';
import { isAiProvider, type AiProvider } from '@/lib/ai-providers';
import { DesktopAiSettingsPanel } from './desktop-ai-settings';
import { DesktopUpdatesPanel } from './desktop-updates';
import { DesktopWallpaperPanel } from './desktop-wallpaper';
import { DesktopPetPanel } from './desktop-pet';

const settingsPages = [
  {
    value: 'overview',
    label: '工作区概览',
    en: 'Workspace overview',
    icon: 'dashboard',
    keywords:
      'workspace general profile overview language English Chinese note size height fit content window close minimize exit 窗口 关闭 最小化 退出 通用 个人资料 概览 语言 简体中文 英文 笔记 尺寸 高度 适应内容',
  },
  { value: 'pet', label: '桌宠与速记', en: 'Desktop pet', icon: 'apps', keywords: 'pet quick note desktop size customize 桌宠 速记 桌面 随手记 大小 自定义' },
  {
    value: 'wallpaper',
    label: '桌面背景',
    en: 'Desktop background',
    icon: 'orbit',
    keywords:
      'wallpaper desktop background galaxy sea coast dynamic 桌面 背景 壁纸 星海 星河 海岸 动态',
  },
  {
    value: 'backup',
    label: '数据与备份',
    en: 'Data and backups',
    icon: 'backup',
    keywords: 'data export import restore backup 导出 导入 还原 恢复 备份',
  },
  {
    value: 'storage',
    label: '存储管理',
    en: 'Storage management',
    icon: 'database',
    keywords:
      'storage files attachment duplicate cleanup 存储 空间 附件 文件 重复 清理',
  },
  {
    value: 'ai',
    label: 'AI 服务',
    en: 'AI service',
    icon: 'atlas',
    keywords: 'AI DeepSeek Kimi OpenAI API key model 模型 密钥 人工智能',
  },
  {
    value: 'updates',
    label: '应用更新',
    en: 'App updates',
    icon: 'apps',
    keywords:
      'app update version download restart upgrade 应用 更新 版本 下载 重启 升级',
  },
] as const;
export function DataSettings({
  open,
  onOpenChange,
  status,
  error,
  onExport,
  onRestore,
  onExportDirectory,
  onRestoreDirectory,
  onLoadStorage,
  onCleanStorage,
  onLocateFile,
  importing,
  boardCount,
  databaseCount = 0,
  cardCount,
  recycledCount,
}: {
  open: boolean;
  databaseCount?: number;
  onOpenChange: (open: boolean) => void;
  status: SaveStatus;
  error: string;
  onExport: (progress: (message: string) => void) => Promise<Blob>;
  onRestore: (backup: PreparedBackup) => Promise<void>;
  onExportDirectory?: (directory: BackupDirectoryHandle, progress: (message: string) => void) => Promise<void>;
  onRestoreDirectory?: (backup: PreparedDirectoryBackup) => Promise<void>;
  onLoadStorage: () => Promise<StorageReport>;
  onCleanStorage: (
    ids: string[],
  ) => Promise<{ count: number; bytes: number; kept: number }>;
  onLocateFile: (boardId: string, cardId: string) => void;
  importing: boolean;
  boardCount: number;
  cardCount: number;
  recycledCount: number;
}) {
  const { language, setLanguage, t, locale } = useI18n();
  const desktop = useDesktopRuntime();
  const platform = useDesktopPlatform();
  const { limits: noteLimits, setLimits: setNoteLimits } =
    useNoteSizePreferences();
  const languageId = useId();
  const [tab, setTab] = useState<
      'overview' | 'backup' | 'storage' | 'ai' | 'updates' | 'wallpaper' | 'pet'
    >('overview'),
    [storageBusy, setStorageBusy] = useState(false),
    [aiBusy, setAiBusy] = useState(false),
    [updateBusy, setUpdateBusy] = useState(false),
    [wallpaperBusy, setWallpaperBusy] = useState(false);
  const panelId = useId();
  const [search, setSearch] = useState('');
  const [initialAiProvider, setInitialAiProvider] = useState<AiProvider>();
  useEffect(() => {
    if (!desktop) return;
    const openAiSettings = (event: Event) => {
      const provider = (event as CustomEvent<{ provider?: unknown }>).detail
        ?.provider;
      setInitialAiProvider(isAiProvider(provider) ? provider : undefined);
      setSearch('');
      setTab('ai');
      onOpenChange(true);
    };
    window.addEventListener(desktopOpenAiSettingsEvent, openAiSettings);
    return () =>
      window.removeEventListener(desktopOpenAiSettingsEvent, openAiSettings);
  }, [desktop, onOpenChange]);
  const page = settingsPages.find((item) => item.value === tab)!;
  const visiblePages = settingsPages.filter(
    (item) =>
      (!['ai', 'updates', 'pet'].includes(item.value) || desktop) &&
      (item.value !== 'wallpaper' || platform === 'darwin') &&
      (item.label + ' ' + item.en + ' ' + item.keywords)
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  const [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(''),
    [failure, setFailure] = useState(''),
    [result, setResult] = useState<'exported' | 'exported-directory' | 'restored' | ''>(''),
    [prepared, setPrepared] = useState<PreparedBackup | PreparedDirectoryBackup | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setFailure('');
    setResult('');
    try {
      await action();
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : t(
              'The operation did not finish. Please try again.',
              '操作未完成，请重试。',
            ),
      );
    } finally {
      setBusy(false);
      setProgress('');
    }
  };
  const download = () =>
    run(async () => {
      const blob = await onExport(setProgress),
        url = URL.createObjectURL(blob),
        link = document.createElement('a');
      link.href = url;
      link.download = `Lumior-backup-${new Date().toISOString().slice(0, 10)}.lumior`;
      link.click();
      setResult('exported');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy && !storageBusy && !aiBusy && !updateBusy && !wallpaperBusy) {
          if (!value) setInitialAiProvider(undefined);
          onOpenChange(value);
          setPrepared(null);
          setFailure('');
        }
      }}
    >
      <DialogContent
        className="data-settings settings-center"
        showCloseButton={false}
      >
        <DialogDescription className="data-settings-description">
          {desktop
            ? t(
                'Lumior workspace, backups, storage, AI and app updates',
                'Lumior 工作区、备份、存储、AI 与应用更新',
              )
            : t(
                'Lumior workspace, backups and storage management',
                'Lumior 工作区、数据备份与存储管理',
              )}
        </DialogDescription>
        <DialogClose
          className="settings-close"
          aria-label={t('Close settings', '关闭设置')}
          disabled={
            busy || storageBusy || aiBusy || updateBusy || wallpaperBusy
          }
        >
          <MaterialIcon name="close" />
        </DialogClose>
        <div className="settings-layout">
          <aside
            className="settings-navigation"
            aria-label={t('Settings categories', '设置分类')}
          >
            <label className="settings-search">
              <MaterialIcon name="search" />
              <input
                aria-label={t('Search settings', '搜索设置')}
                placeholder={t('Search settings', '搜索设置')}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                disabled={
                  busy || storageBusy || aiBusy || updateBusy || wallpaperBusy
                }
              />
            </label>
            <p className="settings-group-label">{t('Workspace', '工作区')}</p>
            <div className="settings-navigation-items">
              {visiblePages.map((item) => (
                <button
                  key={item.value}
                  aria-pressed={tab === item.value}
                  aria-controls={panelId}
                  disabled={
                    busy || storageBusy || aiBusy || updateBusy || wallpaperBusy
                  }
                  onClick={() => {
                    setInitialAiProvider(undefined);
                    setTab(item.value);
                    setFailure('');
                    setResult('');
                  }}
                >
                  <MaterialIcon name={item.icon} />
                  <span>{t(item.en, item.label)}</span>
                </button>
              ))}
              {!visiblePages.length && (
                <p className="settings-no-results">
                  {t('No matching settings', '没有匹配的设置')}
                </p>
              )}
            </div>
            <div className="settings-navigation-foot">
              <strong>Lumior</strong>
              <span>{t('Local workspace', '本地工作区')}</span>
            </div>
          </aside>
          <main
            key={tab}
            className="settings-main"
            aria-label={t(page.en, page.label)}
          >
            <div className="settings-content">
              {tab !== 'pet' && <><DialogTitle>{t(page.en, page.label)}</DialogTitle>
              <p className="settings-page-intro">
                {tab === 'overview'
                  ? desktop
                    ? t(
                        'Your files, folders and whiteboards are stored locally in this app on this device.',
                        '你的文件、文件夹和画板，保存在当前设备的应用中。',
                      )
                    : t(
                        'Your files, folders and whiteboards are stored in the browser on this device.',
                        '你的文件、文件夹和画板，保存在当前设备的浏览器中。',
                      )
                  : tab === 'wallpaper'
                    ? t(
                        'Bring the Memory Sea to your Mac desktop.',
                        '把星海带到你的 Mac 桌面。',
                      )
                    : tab === 'backup'
                      ? t(
                          'Export your complete workspace, or restore files and folders from a backup.',
                          '导出完整工作区，或从备份恢复文件与文件夹。',
                        )
                      : tab === 'ai'
                        ? t(
                            'Connect DeepSeek, Kimi or OpenAI to use AI in the desktop app.',
                            '连接 DeepSeek、Kimi 或 OpenAI，在桌面应用中使用 AI。',
                          )
                        : tab === 'updates'
                          ? t(
                              'Keep Lumior up to date while your work stays saved on this device.',
                              '让 Lumior 保持最新，资料继续保存在当前设备。',
                            )
                          : t(
                              'Review local attachment storage and remove files you no longer use.',
                              '查看本地附件占用，整理不再使用的文件。',
                            )}
              </p></>}
              {tab === 'overview' ? (
                <div id={panelId} className="settings-overview">
                  <div className="settings-profile">
                    <img
                      src="/assets/icon5-imgSubtract.png"
                      width={72}
                      height={72}
                      alt={t('Workspace avatar', '工作区头像')}
                    />
                    <h3>Lumior</h3>
                    <span>{t('Local workspace', '本地工作区')}</span>
                  </div>
                  <section>
                    <h3>{t('Language', '语言')}</h3>
                    <div className="settings-language-row">
                      <div>
                        <label htmlFor={languageId}>
                          {t('Interface language', '界面语言')}
                        </label>
                        <p>
                          {t(
                            'Choose the language for menus and controls. Your content stays as written.',
                            '选择菜单与操作按钮的语言，保留内容原文。',
                          )}
                        </p>
                      </div>
                      <SettingsSelect
                        id={languageId}
                        label={t('Interface language', '界面语言')}
                        value={language}
                        disabled={busy || storageBusy}
                        onChange={(value) =>
                          setLanguage(value as 'en' | 'zh')
                        }
                        options={[
                          { value: 'en', label: 'English' },
                          { value: 'zh', label: '简体中文' },
                        ]}
                      />
                    </div>
                  </section>
                  {platform === 'win32' && <WindowsCloseSettings />}
                  <NoteSizeSettings
                    key={`${noteLimits.minHeight}-${noteLimits.maxHeight}`}
                    limits={noteLimits}
                    onSave={setNoteLimits}
                    disabled={busy || storageBusy}
                  />

                  <section>
                    <h3>{t('Workspace information', '工作区资料')}</h3>
                    <p>
                      {t(
                        'An overview of what is in this workspace.',
                        '这里显示当前工作区的内容概况。',
                      )}
                    </p>
                    <dl className="settings-detail-list">
                      <div>
                        <dt>{t('Whiteboards', '画板')}</dt>
                        <dd>
                          {t('{count}', '{count} 张', { count: boardCount })}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('Cards on whiteboards', '画板内卡片')}</dt>
                        <dd>
                          {t('{count}', '{count} 张', { count: cardCount })}
                        </dd>
                      </div>
                      <div>
                        <dt>{t('Databases', '多维表')}</dt>
                        <dd>{databaseCount}</dd>
                      </div>
                      <div>
                        <dt>{t('Trash', '回收站')}</dt>
                        <dd>
                          {t(
                            '{count} whiteboards · kept for 30 days',
                            '{count} 张画板 · 保留 30 天',
                            { count: recycledCount },
                          )}
                        </dd>
                      </div>
                    </dl>
                  </section>
                  <section>
                    <h3>{t('Local saving', '本地保存')}</h3>
                    <div className="data-settings-status">
                      <span className={`save-dot ${status}`} />
                      <div>
                        <strong>
                          {
                            {
                              loading: t('Loading', '正在读取'),
                              saving: t('Saving…', '正在保存…'),
                              saved: desktop
                                ? t('Saved in this app', '已保存到本机应用')
                                : t(
                                    'Saved in this browser',
                                    '已保存到本机浏览器',
                                  ),
                              error: t(
                                'There was a problem saving locally',
                                '本地保存遇到问题',
                              ),
                            }[status]
                          }
                        </strong>
                        <p>
                          {translateSystemMessage(error) ||
                            t(
                              'Folders, knowledge content, whiteboards, uploaded attachments and PDF annotations save automatically.',
                              '文件夹、知识内容、画板、上传附件和 PDF 批注自动保存。',
                            )}
                        </p>
                      </div>
                    </div>
                    <p className="settings-local-note">
                      {desktop
                        ? t(
                            'Your data is stored locally in this app. Cloud sync is not enabled. Export a full backup before moving devices or removing app data.',
                            '资料保存在本机应用，尚未启用云同步。迁移设备或删除应用数据前，请导出完整备份。',
                          )
                        : t(
                            'Your data is stored in this browser. Cloud sync is not enabled. Export a full backup before moving devices or clearing browser data.',
                            '资料保存在当前浏览器，尚未启用云同步。迁移设备或清除浏览器数据前，请导出完整备份。',
                          )}
                    </p>
                    <div className="settings-overview-actions">
                      <button onClick={() => setTab('backup')}>
                        {t('Manage backups', '管理备份')}
                      </button>
                      <button onClick={() => setTab('storage')}>
                        {t('Manage storage', '管理存储')}
                      </button>
                    </div>
                  </section>
                </div>
              ) : tab === 'backup' ? (
                <div className="data-settings-backup" id={panelId}>
                  <div className="data-settings-status">
                    <span className={`save-dot ${status}`} />
                    <div>
                      <strong>
                        {
                          {
                            loading: t('Loading', '正在读取'),
                            saving: t('Saving…', '正在保存…'),
                            saved: desktop
                              ? t('Saved in this app', '已保存到本机应用')
                              : t(
                                  'Saved in this browser',
                                  '已保存到本机浏览器',
                                ),
                            error: t(
                              'There was a problem saving locally',
                              '本地保存遇到问题',
                            ),
                          }[status]
                        }
                      </strong>
                      <p>
                        {translateSystemMessage(error) ||
                          t(
                            'Whiteboards, images, PDFs and PDF annotations save automatically.',
                            '画板、图片、PDF 和 PDF 批注自动保存。',
                          )}
                      </p>
                    </div>
                  </div>
                  <section>
                    <h3>{t('Full backup', '完整备份')}</h3>
                    <p>
                      {t(
                        'Back up folders, all knowledge content including standalone notes and summaries, whiteboards, databases, trash, attachments and PDF annotations in one file. Content references, saved AI conversations and interface preferences are included.',
                        '把文件夹、全部知识内容（含独立笔记与摘要）、画板、多维表、回收站、附件和 PDF 批注一并备份，保留内容引用关系、已保存的 AI 对话与界面偏好。',
                      )}
                    </p>
                    <button
                      disabled={busy || importing}
                      onClick={() => void download()}
                    >
                      {t('Export full backup', '导出完整备份')}
                    </button>
                    {onExportDirectory && <>
                      <button disabled={busy || importing} onClick={() => void run(async () => {
                        const directory = await pickWorkspaceBackupDirectory('readwrite');
                        await onExportDirectory(directory, setProgress);
                        setResult('exported-directory');
                      })}>{t('Back up to a folder', '备份到文件夹')}</button>
                      <p>{t('For large libraries, save a complete backup folder. Keep the entire folder together when moving it to another device.', '大型资料库可保存为完整备份文件夹；转移到其他设备时，请保留整个文件夹。')}</p>
                    </>}
                  </section>
                  <section>
                    <h3>{t('Restore from backup', '从备份恢复')}</h3>
                    <p>
                      {t(
                        'Restore folders, knowledge content, whiteboards, databases and saved AI conversations as new items, preserving your current work, source links and shared card references. Any interface language and note-size preferences included in the backup will also be applied.',
                        '将文件夹、知识内容、画板、多维表及已保存的 AI 对话恢复为新内容，保留当前资料、来源关联与卡片同步关系。备份中包含的界面语言与笔记尺寸偏好也会应用到当前工作区。',
                      )}
                    </p>
                    <input
                      ref={input}
                      type="file"
                      accept=".lumior,.zip"
                      className="sr-only"
                      aria-label={t(
                        'Choose a Lumior backup',
                        '选择 Lumior 备份',
                      )}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file)
                          void run(async () => {
                            setPrepared(null);
                            setPrepared(
                              await readWorkspaceBackup(file, setProgress),
                            );
                          });
                      }}
                    />
                    <button
                      disabled={busy || importing}
                      onClick={() => input.current?.click()}
                    >
                      {t('Choose backup file', '选择备份文件')}
                    </button>
                    {onRestoreDirectory && <button disabled={busy || importing} onClick={() => void run(async () => {
                      const directory = await pickWorkspaceBackupDirectory('read');
                      setPrepared(null);
                      setPrepared(await readWorkspaceDirectoryBackup(directory, setProgress));
                    })}>{t('Choose backup folder', '选择备份文件夹')}</button>}
                    {prepared && (
                      <div className="backup-preview">
                        <strong>
                          {t(
                            '{boards} whiteboards · {files} attachments',
                            '{boards} 张画板 · {files} 个附件',
                            {
                              boards: prepared.snapshot.boards.length,
                              files: 'fileCount' in prepared ? prepared.fileCount : prepared.files.length,
                            },
                          )}
                        </strong>
                        <p>
                          {new Date(prepared.createdAt).toLocaleString(locale)}{' '}
                          ·{' '}
                          {t(
                            'Trash: {count} whiteboards',
                            '回收站 {count} 张画板',
                            { count: prepared.snapshot.deletedBoards.length },
                          )}
                        </p>
                        {!!prepared.snapshot.databases?.length && (
                          <p>
                            {t('{count} databases', '{count} 个多维表', {
                              count: prepared.snapshot.databases.length,
                            })}
                          </p>
                        )}
                        {prepared.snapshot.files && (
                          <p>
                            {t(
                              'Folders and standalone content are included, with their source links and whiteboard references.',
                              '包含文件夹、独立知识内容及其来源和画板引用关系。',
                            )}
                          </p>
                        )}
                        {prepared.portable && (
                          <p>
                            {t(
                              'AI conversations: {count}',
                              'AI 对话：{count} 个',
                              {
                                count: prepared.portable.aiHistories.reduce(
                                  (total, history) =>
                                    total + history.chats.length,
                                  0,
                                ),
                              },
                            )}
                          </p>
                        )}
                        {prepared.portable?.preferences.language && (
                          <p>
                            {t(
                              'Interface language after restore: {language}',
                              '恢复后的界面语言：{language}',
                              {
                                language:
                                  prepared.portable.preferences.language ===
                                  'zh'
                                    ? '简体中文'
                                    : 'English',
                              },
                            )}
                          </p>
                        )}
                        {prepared.portable?.preferences.noteFitLimits && (
                          <p>
                            {t(
                              'Note height limits after restore: {min}–{max} px',
                              '恢复后的笔记高度范围：{min}–{max} px',
                              {
                                min: prepared.portable.preferences.noteFitLimits
                                  .minHeight,
                                max: prepared.portable.preferences.noteFitLimits
                                  .maxHeight,
                              },
                            )}
                          </p>
                        )}
                        <button
                          className="primary"
                          disabled={busy || importing}
                          onClick={() =>
                            void run(async () => {
                              setProgress(
                                t(
                                  'Saving restored data…',
                                  '正在保存恢复后的资料…',
                                ),
                              );
                              if ('fileCount' in prepared) {
                                if (!onRestoreDirectory) throw new Error(t('Folder restore is unavailable.', '文件夹恢复暂不可用。'));
                                await onRestoreDirectory(prepared);
                              } else await onRestore(prepared);
                              setPrepared(null);
                              setResult('restored');
                            })
                          }
                        >
                          {t('Restore as new items', '恢复为新内容')}
                        </button>
                      </div>
                    )}
                  </section>
                  {progress && (
                    <output aria-live="polite">
                      {translateSystemMessage(progress)}
                    </output>
                  )}
                  {result && (
                    <output aria-live="polite">
                      {result === 'exported-directory'
                        ? t('The complete backup folder was saved in your selected location.', '完整备份文件夹已保存到所选位置。')
                        : result === 'exported'
                        ? desktop
                          ? t(
                              'Backup file created. Choose where to save it in the save window.',
                              '备份文件已生成，请在保存窗口选择存放位置。',
                            )
                          : t(
                              'Backup created. Find it in your downloads folder.',
                              '备份已生成，请在下载文件夹中查看。',
                            )
                        : t(
                            'Backup restored as new files, folders, whiteboards and databases.',
                            '备份已恢复为新的文件、文件夹、画板和多维表。',
                          )}
                    </output>
                  )}
                  {failure && (
                    <p role="alert" className="backup-error">
                      {translateSystemMessage(failure)}
                    </p>
                  )}
                  <p className="data-settings-footnote">
                    {desktop
                      ? t(
                          'Your data is stored locally in this app. Back up before removing app data or moving devices. Online links need internet access. Single-file backups support 512 MB of attachments; use a folder backup for larger libraries.',
                          '资料保存在本机应用。删除应用数据或迁移设备前，请备份。在线链接仍需联网；单文件备份支持最多 512 MB 附件，大型资料库请使用文件夹备份。',
                        )
                      : t(
                          'Your data is stored in this browser. Clearing browser data removes local resources, so back up regularly. Online links need internet access. Single-file backups support 512 MB of attachments; supported browsers can use folder backups for larger libraries.',
                          '目前资料保存在这个浏览器中。清除浏览器数据会删除本地资料，请定期备份。在线链接仍需联网；单文件备份支持最多 512 MB 附件，支持文件夹访问的浏览器可使用文件夹备份。',
                        )}
                  </p>
                </div>
              ) : tab === 'ai' && desktop ? (
                <div id={panelId}>
                  {open && (
                    <DesktopAiSettingsPanel
                      initialProvider={initialAiProvider}
                      onBusyChange={setAiBusy}
                    />
                  )}
                </div>
              ) : tab === 'pet' && desktop ? (
                <div id={panelId}>{open && <DesktopPetPanel onBusyChange={setWallpaperBusy} />}</div>
              ) : tab === 'wallpaper' && platform === 'darwin' ? (
                <div id={panelId}>
                  {open && (
                    <DesktopWallpaperPanel onBusyChange={setWallpaperBusy} />
                  )}
                </div>
              ) : tab === 'updates' && desktop ? (
                <div id={panelId}>
                  {open && <DesktopUpdatesPanel onBusyChange={setUpdateBusy} />}
                </div>
              ) : (
                <div id={panelId}>
                  {open && (
                    <StoragePanel
                      onLoad={onLoadStorage}
                      onClean={onCleanStorage}
                      onLocate={onLocateFile}
                      onBusyChange={setStorageBusy}
                      importing={importing}
                    />
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
