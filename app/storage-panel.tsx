'use client';
import { useI18n } from './i18n';
import { translate, translateSystemMessage } from './i18n-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { readStoredFile } from './local-repository';
import {
  duplicateFileGroups,
  formatBytes,
  type ManagedFile,
  type StorageReport,
} from './storage-management';
import './storage-panel.css';
import { SettingsSelect } from './settings-select';

type Props = {
  onLoad: () => Promise<StorageReport>;
  onClean: (
    ids: string[],
  ) => Promise<{ count: number; bytes: number; kept: number }>;
  onLocate: (boardId: string, cardId: string) => void;
  onBusyChange: (busy: boolean) => void;
  importing: boolean;
};
export function StoragePanel({
  onLoad,
  onClean,
  onLocate,
  onBusyChange,
  importing,
}: Props) {
  const { t, locale } = useI18n();
  const kinds = {
    image: t('Image', '图片'),
    pdf: 'PDF',
    video: t('Video', '视频'),
    audio: t('Audio', '音频'),
    other: t('Other', '其他'),
  };
  const usages = {
    active: t('Used in workspace', '工作区使用中'),
    recycle: t('Kept in trash', '回收站保留'),
    history: t('Kept for undo or annotations', '撤销或批注保留'),
    recent: t('New upload protected', '新上传保护'),
    unused: t('Can be cleaned up', '可清理'),
  };
  const [report, setReport] = useState<StorageReport | null>(null);
  const [loading, setLoading] = useState(true),
    [working, setWorking] = useState(false);
  const [failure, setFailure] = useState(''),
    [message, setMessage] = useState<
      | { type: 'checking'; done: number; total: number }
      | { type: 'duplicates'; count: number }
      | { type: 'cleaned'; count: number; bytes: number; kept: number }
      | null
    >(null);
  const [query, setQuery] = useState(''),
    [kind, setKind] = useState('all'),
    [usage, setUsage] = useState('all');
  const [confirmation, setConfirmation] = useState<ManagedFile[] | null>(null);
  const [duplicates, setDuplicates] = useState<string[][] | null>(null);
  const loadRef = useRef(onLoad),
    mounted = useRef(true);
  useEffect(() => {
    loadRef.current = onLoad;
  }, [onLoad]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const refresh = useCallback(async () => {
    setLoading(true);
    setFailure('');
    setConfirmation(null);
    setDuplicates(null);
    try {
      const next = await loadRef.current();
      if (mounted.current) setReport(next);
    } catch (error) {
      if (mounted.current)
        setFailure(
          error instanceof Error
            ? error.message
            : translate(
                'Storage information could not be read.',
                '无法读取存储信息。',
              ),
        );
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(() => {
      if (mounted.current) return refresh();
    });
  }, [refresh, importing]);
  const run = async (action: () => Promise<void>) => {
    setWorking(true);
    onBusyChange(true);
    setFailure('');
    setMessage(null);
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
      setWorking(false);
      onBusyChange(false);
    }
  };
  const download = (file: ManagedFile) =>
    run(async () => {
      const stored = await readStoredFile(file.id);
      if (!stored)
        throw new Error(
          t(
            'This attachment is unavailable. Refresh the file list.',
            '附件已不可用，请刷新文件列表。',
          ),
        );
      const url = URL.createObjectURL(stored.blob),
        link = document.createElement('a');
      link.href = url;
      link.download = stored.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  const checkDuplicates = () =>
    run(async () => {
      if (!report) return;
      const groups = await duplicateFileGroups(
        report.files,
        async (id) => (await readStoredFile(id))?.blob,
        (done, total) => setMessage({ type: 'checking', done, total }),
      );
      setDuplicates(groups);
      setMessage({ type: 'duplicates', count: groups.length });
    });
  const clean = () =>
    run(async () => {
      if (!confirmation) return;
      const result = await onClean(confirmation.map((file) => file.id));
      setConfirmation(null);
      await refresh();
      setMessage({ type: 'cleaned', ...result });
    });
  const files = (report?.files || [])
    .filter(
      (file) =>
        (kind === 'all' || file.kind === kind) &&
        (usage === 'all' || file.usage === usage) &&
        (!query.trim() ||
          (
            file.name +
            ' ' +
            file.locations.map((location) => location.boardTitle).join(' ')
          )
            .toLowerCase()
            .includes(query.trim().toLowerCase())),
    )
    .sort((a, b) => b.size - a.size || a.name.localeCompare(b.name, locale));
  const busy = working || loading;
  return (
    <div
      className="storage-panel"
      aria-label={t('Storage management', '存储管理')}
    >
      {report && (
        <>
          <div className="storage-metrics">
            <div>
              <span>{t('Uploaded attachment storage', '上传附件占用')}</span>
              <strong>{formatBytes(report.totalBytes)}</strong>
            </div>
            <div>
              <span>{t('Storage you can reclaim', '可清理占用')}</span>
              <strong className="storage-accent">
                {formatBytes(report.cleanableBytes)}
              </strong>
            </div>
            <div>
              <span>{t('Uploaded attachments', '上传附件数量')}</span>
              <strong>
                {report.files.length}
                <small> {t('files', '个')}</small>
              </strong>
            </div>
          </div>
          <p className="storage-estimate">
            {report.estimate?.usage !== undefined
              ? t(
                  'This site uses approximately {size}',
                  '整个站点约占 {size}',
                  { size: formatBytes(report.estimate.usage) },
                ) +
                (report.estimate.quota !== undefined
                  ? t(
                      ' · Browser storage limit {size}',
                      ' · 浏览器允许上限 {size}',
                      { size: formatBytes(report.estimate.quota) },
                    )
                  : '')
              : t(
                  'The browser did not provide a storage estimate.',
                  '浏览器未提供站点占用估算。',
                )}
            <br />
            {t(
              'Manage original uploaded and restored files here. Bundled assets, online links and browser caches are excluded from cleanup.',
              '这里管理上传和备份恢复的原文件；项目自带素材、在线链接和浏览器缓存不在清理范围内。',
            )}
          </p>
        </>
      )}
      <div className="storage-actions">
        <button disabled={busy} onClick={() => void refresh()}>
          {t('Refresh', '刷新')}
        </button>
        <button
          disabled={busy || !report?.files.length}
          onClick={() => void checkDuplicates()}
        >
          {t('Check for duplicates', '检查重复文件')}
        </button>
        <button
          className="storage-clean-button"
          disabled={
            busy ||
            importing ||
            !report?.cleanableCount ||
            !report.cleanupSupported
          }
          onClick={() => {
            setMessage(null);
            setConfirmation(
              report!.files.filter((file) => file.usage === 'unused'),
            );
          }}
        >
          {t('Clean up unused attachments', '清理未引用附件')}
          {report?.cleanableCount ? ` · ${report.cleanableCount}` : ''}
        </button>
      </div>
      {importing && (
        <p>
          {t(
            'Attachments are importing. Cleanup resumes when they finish.',
            '附件正在导入，完成前暂停清理。',
          )}
        </p>
      )}
      {report && !report.cleanupSupported && (
        <p>
          {t(
            'This browser does not support safe cleanup. You can still view and download files.',
            '当前浏览器不支持安全清理，仍可查看文件和下载原文件。',
          )}
        </p>
      )}
      <div className="storage-filters">
        <input
          aria-label={t('Search attachments', '搜索附件')}
          placeholder={t(
            'Search file names or whiteboards…',
            '搜索文件名或画板…',
          )}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SettingsSelect
          label={t('Attachment type', '附件类型')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: t('All types', '所有类型') },
            ...Object.entries(kinds).map(([value, label]) => ({ value, label })),
          ]}
        />
        <SettingsSelect
          label={t('Attachment usage', '附件使用状态')}
          value={usage}
          onChange={setUsage}
          options={[
            { value: 'all', label: t('All usage states', '所有状态') },
            ...Object.entries(usages).map(([value, label]) => ({ value, label })),
          ]}
        />
      </div>
      <div
        className="storage-files"
        aria-label={t('Local attachment list', '本地附件列表')}
        aria-busy={loading}
      >
        {loading ? (
          <p className="storage-empty">
            {t('Loading local attachments…', '正在读取本地附件…')}
          </p>
        ) : files.length ? (
          files.map((file) => {
            const duplicate =
              duplicates?.findIndex((group) => group.includes(file.id)) ?? -1;
            return (
              <div className="storage-file" key={file.id}>
                <span className={`storage-file-kind ${file.kind}`}>
                  {kinds[file.kind]}
                </span>
                <div className="storage-file-info">
                  <strong title={file.name}>{file.name}</strong>
                  <span>
                    {formatBytes(file.size)} ·{' '}
                    <span
                      className={
                        file.usage === 'unused' ? 'storage-accent' : ''
                      }
                    >
                      {usages[file.usage]}
                    </span>
                    {duplicate >= 0 && (
                      <span className="storage-duplicate">
                        {' '}
                        {t('· Same content #{group}', '· 相同内容 #{group}', {
                          group: duplicate + 1,
                        })}
                      </span>
                    )}
                  </span>
                  {!!file.locations.length && (
                    <div className="storage-locations">
                      {file.locations.map((location) =>
                        location.databaseId ? (
                          <span
                            key={location.databaseId + ':' + location.cardId}
                            title={location.cardTitle}
                          >
                            {location.boardTitle} · {location.cardTitle}
                          </span>
                        ) : location.deleted ? (
                          <span key={location.boardId + ':' + location.cardId}>
                            {location.boardTitle} · {t('Trash', '回收站')}
                          </span>
                        ) : (
                          <button
                            key={location.boardId + ':' + location.cardId}
                            disabled={busy}
                            title={location.cardTitle}
                            onClick={() =>
                              onLocate(location.boardId, location.cardId)
                            }
                          >
                            {location.boardTitle} ↗
                          </button>
                        ),
                      )}
                    </div>
                  )}
                </div>
                <button
                  className="storage-download"
                  aria-label={t('Download {name}', '下载 {name}', {
                    name: file.name,
                  })}
                  disabled={busy}
                  onClick={() => void download(file)}
                >
                  {t('Download', '下载')}
                </button>
              </div>
            );
          })
        ) : (
          <div className="storage-empty">
            {report?.files.length
              ? t('No matching attachments.', '没有匹配的附件。')
              : t(
                  'No uploaded attachments yet. Paste or drop images, or upload a PDF to see them here.',
                  '还没有上传的附件。粘贴或拖入图片、上传 PDF 后会出现在这里。',
                )}
          </div>
        )}
      </div>
      <p className="storage-protection">
        {t(
          'Attachments referenced by whiteboards, trash, undo/redo history or PDF annotations are kept. New uploads are protected for 1 hour during import.',
          '画板、回收站、撤销/重做记录与 PDF 批注引用的附件会保留。新增附件保护 1 小时，避免导入过程被清理。',
        )}
      </p>
      {confirmation && (
        <section
          className="storage-confirmation"
          aria-label={t('Confirm attachment cleanup', '确认附件清理')}
        >
          <h3>
            {t(
              'Clean up {count} unused attachments?',
              '清理 {count} 个未引用附件？',
              { count: confirmation.length },
            )}
          </h3>
          <p>
            {t(
              'These original files will be permanently deleted, reclaiming {size}. This cannot be undone. Download any files you want to keep first.',
              '将永久删除以下原文件，减少 {size} 附件占用，此操作无法撤销。需要留存的文件请先下载。',
              {
                size: formatBytes(
                  confirmation.reduce((sum, file) => sum + file.size, 0),
                ),
              },
            )}
          </p>
          <ul>
            {confirmation.map((file) => (
              <li key={file.id}>
                <span>{file.name}</span>
                <span>{formatBytes(file.size)}</span>
              </li>
            ))}
          </ul>
          <div>
            <button disabled={working} onClick={() => setConfirmation(null)}>
              {t('Cancel', '取消')}
            </button>
            <button
              className="storage-delete-confirm"
              disabled={busy || importing}
              onClick={() => void clean()}
            >
              {t('Confirm cleanup', '确认清理')}
            </button>
          </div>
        </section>
      )}
      {message && (
        <output aria-live="polite" className="storage-message">
          {message.type === 'checking'
            ? t(
                'Comparing file contents {current} / {total}…',
                '正在比较文件内容 {current} / {total}…',
                { current: message.done, total: message.total },
              )
            : message.type === 'duplicates'
              ? message.count
                ? t(
                    'Found {count} groups of identical attachments, marked in the list. Referenced files will be kept.',
                    '发现 {count} 组内容相同的附件，已在列表中标记。仍被引用的文件会保留。',
                    { count: message.count },
                  )
                : t(
                    'No identical attachments found.',
                    '没有发现内容相同的附件。',
                  )
              : t(
                  'Cleaned up {count} attachments, reclaiming {size}.',
                  '已清理 {count} 个附件，减少 {size} 附件占用。',
                  { count: message.count, size: formatBytes(message.bytes) },
                ) +
                (message.kept
                  ? t(
                      ' {count} files were kept because references or protection changed.',
                      ' {count} 个文件因引用或保护状态变化而保留。',
                      { count: message.kept },
                    )
                  : '')}
        </output>
      )}
      {failure && (
        <p role="alert" className="backup-error">
          {translateSystemMessage(failure)}
        </p>
      )}
    </div>
  );
}
