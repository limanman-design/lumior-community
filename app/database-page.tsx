'use client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useImperativeHandle,
  type Ref,
  type ReactNode,
} from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { PanelRight, Database, MoreHorizontal } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DatabaseRecordViews } from './database-record-views';
import { MaterialIcon } from './material-icon';
import { DataTable } from './vendor/ocean-dataview/data-table';
import { useI18n } from './i18n';
import {
  convertDatabaseProperty,
  removeDatabaseProperty,
  databaseRecords,
  databaseSorts,
  databaseBoardGroups,
  activeDatabaseView,
  selectDatabaseView,
  updateActiveDatabaseView,
  updateDatabaseView,
  removeDatabaseView,
  type DatabaseView,
  moveDatabaseRecord,
  newDatabaseRecord,
  patchDatabaseRecord,
  type DatabaseProperty,
  type DatabaseRecord,
  type WorkspaceDatabase,
} from './database-model';
import type { SaveStatus } from './local-repository';
import {
  DatabasePropertyEditor,
  propertyIcons,
} from './database-property-editor';
import { PropertyValue, type DatabaseUpload } from './database-value-editor';
import { DatabaseRecordDrawer } from './database-record-drawer';
import {
  DatabaseEditContext,
  DatabaseEditValidationError,
  useDatabaseEditCommit,
} from './database-edit-context';
import { createDatabaseEditSession } from './database-edit-session';
import {
  DatabaseViewTabs,
  DatabaseViewSettings,
  type ViewSettingsSection,
} from './database-view-settings';
import { useDisplayProperties } from './vendor/ocean-dataview/use-display-properties';
import { databaseFilterCount } from './database-query';
import { useDatabaseQueryToolbar } from './database-query-toolbar';
import { GroupSection } from './vendor/ocean-dataview/group-section';
import { Accordion } from '@/components/ui/accordion';
import './database.css';
import './database-record-drawer.css';
import './database-query-toolbar.css';

// Commit text at the edit boundary, keeping sorting and unrelated cells stable
// while typing. Escape cancels; Enter commits; Tab keeps native table navigation.
function EditValue({
  value,
  label,
  placeholder,
  type = 'text',
  className = '',
  focusOnMount = false,
  required = false,
  onEnd,
  onCommit,
}: {
  value: string;
  label: string;
  placeholder?: string;
  type?: 'text' | 'number' | 'date';
  className?: string;
  focusOnMount?: boolean;
  required?: boolean;
  onEnd?: () => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [previousValue, setPreviousValue] = useState(value);
  if (value !== previousValue) {
    setPreviousValue(value);
    setDraft(value);
  }
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(value),
    saved = useRef(value);
  useEffect(() => {
    pending.current = saved.current = value;
  }, [value]);
  const commit = () => {
    const next = input.current?.value ?? pending.current;
    if (cancelled.current || next === saved.current) return;
    if (
      (input.current && !input.current.validity.valid) ||
      (required && !next.trim())
    )
      throw new DatabaseEditValidationError();
    saved.current = next;
    onCommit(next);
  };
  useDatabaseEditCommit(commit, draft !== value);
  useEffect(() => {
    if (focusOnMount) {
      input.current?.focus();
      input.current?.select();
    }
  }, [focusOnMount]);
  return (
    <input
      ref={input}
      className={className}
      type={type}
      step={type === 'number' ? 'any' : undefined}
      min={type === 'date' ? '0001-01-01' : undefined}
      max={type === 'date' ? '9999-12-31' : undefined}
      value={draft}
      aria-label={label}
      placeholder={placeholder}
      maxLength={type === 'text' ? 2000 : undefined}
      onChange={(event) => {
        pending.current = event.target.value;
        setDraft(event.target.value);
      }}
      onInput={(event) => {
        pending.current = event.currentTarget.value;
        setDraft(event.currentTarget.value);
      }}
      onFocus={() => {
        cancelled.current = false;
      }}
      onBlur={() => {
        try {
          commit();
        } catch (error) {
          if (!(error instanceof DatabaseEditValidationError)) throw error;
          pending.current = value;
          setDraft(value);
        }
        onEnd?.();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          cancelled.current = true;
          pending.current = value;
          setDraft(value);
          event.currentTarget.blur();
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function DatabaseEmpty({ onNew }: { onNew: () => void }) {
  const { t } = useI18n();
  return (
    <main className="database-page database-empty">
      <Database size={36} strokeWidth={1.3} />
      <h1>{t('A place for your plans.', '让计划井然有序。')}</h1>
      <p>
        {t(
          'Organize tasks, schedules, and everyday work in your own databases.',
          '用独立的多维表，整理任务、计划与日常事务。',
        )}
      </p>
      <button type="button" className="database-primary" onClick={onNew}>
        <MaterialIcon name="add" size={16} />
        {t('Create a database', '创建多维表')}
      </button>
    </main>
  );
}

export type DatabasePageCloseGuard = {
  requestClose: (escape?: boolean) => boolean;
};

export default function DatabasePage({
  database: sourceDatabase,
  onUpdate,
  saveStatus,
  autoRename = false,
  onRenameEnd,
  onUpload,
  onAddToBoard,
  initialViewId,
  isolateViewSelection = false,
  closeGuardRef,
}: {
  database: WorkspaceDatabase;
  onUpdate: (
    id: string,
    change: (database: WorkspaceDatabase) => WorkspaceDatabase,
  ) => void;
  saveStatus: SaveStatus;
  onUpload: DatabaseUpload;
  autoRename?: boolean;
  onRenameEnd: () => void;
  onAddToBoard?: (databaseId: string, viewId: string) => void;
  initialViewId?: string;
  isolateViewSelection?: boolean;
  closeGuardRef?: Ref<DatabasePageCloseGuard>;
}) {
  const { t, language } = useI18n();
  const [selectedViewId, setSelectedViewId] = useState(
    () => initialViewId ?? activeDatabaseView(sourceDatabase, language).id,
  );
  const database = isolateViewSelection
    ? selectDatabaseView(sourceDatabase, selectedViewId, language)
    : sourceDatabase;
  const activeView = activeDatabaseView(database, language);
  const [settings, setSettings] = useState<ViewSettingsSection | null>(null);
  const [renameView, setRenameView] = useState<DatabaseView | null>(null);
  const [deleteView, setDeleteView] = useState<DatabaseView | null>(null);
  const [query, setQuery] = useState('');
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);
  const [editSession] = useState(createDatabaseEditSession);
  const [editError, setEditError] = useState('');
  const recordTrigger = useRef<HTMLElement | null>(null);
  const flushEdits = useCallback(() => {
    try {
      editSession.flush();
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
      setEditError('');
      return true;
    } catch (error) {
      const errors = error instanceof AggregateError ? error.errors : [error];
      if (!errors.every((item) => item instanceof DatabaseEditValidationError))
        throw error;
      setEditError(
        t(
          'Complete or cancel the invalid field before continuing.',
          '请先修正当前字段，或按 Esc 取消该次编辑。',
        ),
      );
      return false;
    }
  }, [editSession, t]);
  const showRecord = useCallback(
    (id: string) => {
      const trigger = document.activeElement;
      if (!flushEdits()) return;
      if (
        trigger instanceof HTMLElement &&
        !trigger.closest('.database-record-drawer')
      )
        recordTrigger.current = trigger;
      setOpenRecordId(id);
    },
    [flushEdits, setOpenRecordId],
  );
  const closeRecord = useCallback(() => {
    if (!flushEdits()) return;
    setOpenRecordId(null);
    if (recordTrigger.current?.isConnected)
      recordTrigger.current.focus({ preventScroll: true });
  }, [flushEdits, setOpenRecordId]);
  const openRecord = database.records.find(
    (record) => record.id === openRecordId,
  );
  const pendingRecordFocus = useRef<string | null>(null);
  const [propertyEditor, setPropertyEditor] = useState<DatabaseProperty | null>(
    null,
  );
  const [deletion, setDeletion] = useState<{
    type: 'record' | 'property';
    id: string;
    title: string;
  } | null>(null);
  const root = useRef<HTMLElement>(null);
  const settingsTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        propertyEditor ||
        deletion ||
        settings
      )
        return;
      const target = event.target;
      if (
        !(target instanceof HTMLElement) ||
        !root.current?.contains(target) ||
        target.closest('[data-slot="popover-content"], [role="menu"]')
      )
        return;
      if (openRecordId) {
        event.preventDefault();
        closeRecord();
      }
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [openRecordId, propertyEditor, deletion, settings, closeRecord]);
  const update = useCallback(
    (change: (current: WorkspaceDatabase) => WorkspaceDatabase) =>
      onUpdate(database.id, (current) => {
        if (!isolateViewSelection) return change(current);
        const originalViewId = activeDatabaseView(current, language).id;
        const projected = selectDatabaseView(current, activeView.id, language);
        return selectDatabaseView(change(projected), originalViewId, language);
      }),
    [database.id, activeView.id, isolateViewSelection, language, onUpdate],
  );
  const queryToolbar = useDatabaseQueryToolbar({
    database,
    view: activeView,
    patch: (values) =>
      update((current) =>
        updateDatabaseView(current, activeView.id, values, language),
      ),
    beforeOpen: flushEdits,
  });
  const updateRecord = useCallback(
    (id: string, patch: Pick<Partial<DatabaseRecord>, 'title' | 'values'>) =>
      update((current) => patchDatabaseRecord(current, id, patch)),
    [update],
  );
  const sort = useCallback(
    (propertyId: string, direction: 'asc' | 'desc' | null) =>
      update((current) =>
        updateActiveDatabaseView(
          current,
          {
            sorts: direction
              ? databaseSorts(current.view).some(
                  (sort) => sort.propertyId === propertyId,
                )
                ? databaseSorts(current.view).map((sort) =>
                    sort.propertyId === propertyId
                      ? { propertyId, direction }
                      : sort,
                  )
                : [...databaseSorts(current.view), { propertyId, direction }]
              : databaseSorts(current.view).filter(
                  (sort) => sort.propertyId !== propertyId,
                ),
          },
          language,
        ),
      ),
    [update, language],
  );
  const addRecord = (groupId?: string) => {
    if (!flushEdits()) return;
    const record = newDatabaseRecord(database);
    const { property } = databaseBoardGroups(database, []);
    if (groupId !== undefined && property) record.values[property.id] = groupId;
    setQuery('');
    if (
      database.view.type === 'table' &&
      !databaseFilterCount(database.view.filter)
    )
      pendingRecordFocus.current = record.id;
    else setOpenRecordId(record.id);
    update((current) => ({
      ...current,
      records: [...current.records, record],
      updatedAt: record.createdAt,
    }));
  };
  const duplicateRecord = useCallback(
    (source: DatabaseRecord) => {
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      update((current) => {
        const latest = current.records.find(
          (record) => record.id === source.id,
        );
        if (!latest) return current;
        return {
          ...current,
          records: [
            ...current.records,
            { ...structuredClone(latest), id, createdAt: now, updatedAt: now },
          ],
          updatedAt: now,
        };
      });
      return id;
    },
    [update],
  );
  useEffect(() => {
    const newRecordId = pendingRecordFocus.current;
    if (!newRecordId) return;
    const input = root.current?.querySelector<HTMLInputElement>(
      `[data-record="${newRecordId}"] input`,
    );
    input?.focus();
    input?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    pendingRecordFocus.current = null;
  }, [database.records]);

  const header = useCallback(
    (
      id: string,
      name: string,
      icon: ReactNode,
      property?: DatabaseProperty,
    ) => (
      <DropdownMenu>
        <DropdownMenuTrigger
          className="database-column-label"
          aria-label={t('Options for {name}', '{name} 的字段选项', { name })}
        >
          {icon}
          <span>{name}</span>
          {databaseSorts(database.view).some(
            (sort) => sort.propertyId === id,
          ) &&
            (databaseSorts(database.view).find((sort) => sort.propertyId === id)
              ?.direction === 'asc' ? (
              <MaterialIcon name="straight" size={16} />
            ) : (
              <span className="database-sort-direction" data-direction="desc">
                <MaterialIcon name="straight" size={16} />
              </span>
            ))}
        </DropdownMenuTrigger>
        <DropdownMenuContent className="lumior-menu" align="start">
          <DropdownMenuItem onClick={() => sort(id, 'asc')}>
            {t('Sort ascending', '升序排列')}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => sort(id, 'desc')}>
            {t('Sort descending', '降序排列')}
          </DropdownMenuItem>
          {databaseSorts(database.view).some(
            (sort) => sort.propertyId === id,
          ) && (
            <DropdownMenuItem onClick={() => sort(id, null)}>
              {t('Remove this sort', '移除此字段排序')}
            </DropdownMenuItem>
          )}
          {property && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setPropertyEditor(property)}>
                {t('Edit property', '编辑字段')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  setDeletion({ type: 'property', id, title: name })
                }
              >
                {t('Delete property', '删除字段')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    ),
    [database.view, t, sort, setPropertyEditor, setDeletion],
  );

  const visibleProperties = useDisplayProperties(
    database.properties,
    activeView.visiblePropertyIds,
  );
  const columns = useMemo<ColumnDef<DatabaseRecord>[]>(
    () => [
      {
        id: 'title',
        accessorKey: 'title',
        header: () =>
          header(
            'title',
            t('Name', '名称'),
            <MaterialIcon name="title" size={16} />,
          ),
        meta: { propertySize: 320 },
        cell: ({ row }) => (
          <div className="database-title-cell" data-record={row.original.id}>
            <EditValue
              value={row.original.title}
              label={t('Record name', '记录名称')}
              placeholder={t('Untitled', '未命名')}
              onCommit={(title) => updateRecord(row.original.id, { title })}
            />
            <button
              type="button"
              className="database-open-record"
              aria-label={t('Open record: {title}', '打开记录：{title}', {
                title: row.original.title || t('Untitled', '未命名'),
              })}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => showRecord(row.original.id)}
            >
              <PanelRight size={13} />
              <span>{t('Open', '打开')}</span>
            </button>
          </div>
        ),
      },
      ...visibleProperties.map((property) => {
        const Icon = propertyIcons[property.type];
        return {
          id: property.id,
          accessorFn: (record: DatabaseRecord) => record.values[property.id],
          header: () =>
            header(
              property.id,
              property.name,
              <Icon
                size={
                  property.type === 'date' ||
                  property.type === 'createdAt' ||
                  property.type === 'updatedAt'
                    ? 20
                    : 16
                }
              />,
              property,
            ),
          meta: {
            propertySize:
              property.type === 'text'
                ? 280
                : property.type === 'files'
                  ? 240
                  : 190,
          },
          cell: ({ row }: { row: { original: DatabaseRecord } }) => (
            <PropertyValue
              property={property}
              record={row.original}
              onEditProperty={() => setPropertyEditor(property)}
              onUpload={(files) =>
                onUpload(database.id, row.original.id, property.id, files)
              }
              onCommit={(value) =>
                updateRecord(row.original.id, {
                  values: { [property.id]: value },
                })
              }
            />
          ),
        };
      }),
      {
        id: '_actions',
        header: () => (
          <button
            type="button"
            className="database-column-add"
            aria-label={t('Add property', '添加字段')}
            title={t('Add property', '添加字段')}
            onClick={() =>
              setPropertyEditor({
                id: crypto.randomUUID(),
                name: '',
                type: 'text',
              })
            }
          >
            <MaterialIcon name="add" size={16} />
          </button>
        ),
        meta: { propertySize: 44 },
        cell: ({ row }) => (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="database-row-menu"
              aria-label={t('Record options: {title}', '记录选项：{title}', {
                title: row.original.title || t('Untitled', '未命名'),
              })}
            >
              <MoreHorizontal size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="lumior-menu" align="end">
              <DropdownMenuItem onClick={() => duplicateRecord(row.original)}>
                {t('Duplicate record', '复制记录')}
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  setDeletion({
                    type: 'record',
                    id: row.original.id,
                    title: row.original.title || t('Untitled', '未命名'),
                  })
                }
              >
                {t('Delete record', '删除记录')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [
      database.id,
      visibleProperties,
      header,
      t,
      duplicateRecord,
      updateRecord,
      onUpload,
      showRecord,
      setPropertyEditor,
      setDeletion,
    ],
  );
  const [calendarDay, setCalendarDay] = useState(() =>
    new Date().toDateString(),
  );
  useEffect(() => {
    const refresh = () => setCalendarDay(new Date().toDateString());
    const timer = window.setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  const records = useMemo(
    () => databaseRecords(database, query, new Date(calendarDay)),
    [database, query, calendarDay],
  );

  const renderRecords = (
    items: DatabaseRecord[],
    sticky = true,
    groupId?: string,
  ) =>
    database.view.type === 'table' ? (
      <DataTable
        data={items}
        columns={columns}
        getRowId={(record) => record.id}
        className="database-table"
        header={{ enabled: true, sticky }}
        wrapAllProperties={false}
        rowSelection={openRecordId ? { [openRecordId]: true } : {}}
      />
    ) : (
      <DatabaseRecordViews
        database={{ ...database, view: activeView }}
        records={items}
        onOpen={showRecord}
        selectedId={openRecordId}
        onNew={(id) => addRecord(id ?? groupId)}
        onMove={(id, group) =>
          update((current) => moveDatabaseRecord(current, id, group))
        }
      />
    );
  const closeSettings = () => {
    setSettings(null);
    settingsTrigger.current?.focus({ preventScroll: true });
  };
  useImperativeHandle(closeGuardRef, () => ({
    requestClose(escape = false) {
      if (escape) {
        if (propertyEditor || deletion || renameView || deleteView)
          return false;
        if (openRecordId) {
          closeRecord();
          return false;
        }
        if (settings !== null) {
          if (flushEdits()) closeSettings();
          return false;
        }
      }
      return flushEdits();
    },
  }));

  const page = (
    <main
      ref={root}
      className="database-page"
      data-record-open={!!openRecord || undefined}
      aria-label={t('Database: {title}', '多维表：{title}', {
        title: database.title,
      })}
    >
      <div className="database-workspace-view">
        <header className="database-page-header" title={database.title}>
          {database.title}
        </header>
        {saveStatus === 'error' && (
          <p className="database-save-error" role="alert">
            {t('Save failed · check Settings', '保存失败 · 请检查设置')}
          </p>
        )}
        {editError && !openRecord && (
          <p className="database-record-edit-error" role="alert">
            {editError}
          </p>
        )}
        <div className="database-document">
          <div className="database-heading">
            <MaterialIcon name="table_chart_view" />
            <EditValue
              className="database-name"
              label={t('Database title', '多维表标题')}
              value={database.title}
              focusOnMount={autoRename}
              required
              onEnd={onRenameEnd}
              onCommit={(title) => {
                if (title.trim())
                  update((current) => ({
                    ...current,
                    title: title.trim().slice(0, 200),
                    updatedAt: new Date().toISOString(),
                  }));
                onRenameEnd();
              }}
            />
          </div>
          <div className="database-toolbar">
            <DatabaseViewTabs
              database={database}
              update={update}
              onEdit={() => setSettings('main')}
              onRename={setRenameView}
              onDelete={setDeleteView}
              onSelect={
                isolateViewSelection
                  ? (id) => {
                      if (!flushEdits()) return false;
                      setSelectedViewId(id);
                      return true;
                    }
                  : undefined
              }
            />
            <div className="database-toolbar-actions">
              <label className="database-record-search">
                <MaterialIcon name="search_outlined" size={16} />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-label={t('Search records', '搜索记录')}
                  placeholder={t('Search', '搜索')}
                />
              </label>
              {queryToolbar.buttons}
              <button
                ref={settingsTrigger}
                type="button"
                className="database-tool-button"
                data-active={settings !== null}
                aria-label={t('View settings', '视图设置')}
                aria-expanded={settings !== null}
                aria-haspopup="dialog"
                title={t('View settings', '视图设置')}
                onClick={() => setSettings(settings === null ? 'main' : null)}
              >
                <MaterialIcon name="tune" />
              </button>
              <button className="database-primary" onClick={() => addRecord()}>
                <MaterialIcon name="add" size={16} />
                {t('New', '新建')}
              </button>
            </div>
          </div>
          {queryToolbar.bar}
          <section
            id="database-view-content"
            role="tabpanel"
            aria-labelledby={`database-view-${activeView.id}`}
          >
            {database.view.type !== 'board' && activeView.groupBy ? (
              <Accordion
                key={`${activeView.id}:${database.view.groupBy}`}
                multiple
                defaultValue={databaseBoardGroups(database, records).groups.map(
                  (group) => group.key,
                )}
              >
                {databaseBoardGroups(database, records).groups.map((group) => (
                  <GroupSection
                    key={group.key}
                    group={group}
                    label={
                      <span
                        className="database-value-status"
                        data-color={group.color}
                      >
                        {group.name || t('No group', '未分组')}
                      </span>
                    }
                  >
                    {renderRecords(group.items, false, group.key)}
                  </GroupSection>
                ))}
              </Accordion>
            ) : (
              renderRecords(records)
            )}
            {!records.length &&
              (activeView.type === 'table' || activeView.type === 'list') && (
                <div className="database-no-records">
                  {query
                    ? t('No matching records.', '没有匹配的记录。')
                    : t(
                        'Your database is ready. Add your first record.',
                        '多维表已准备好，添加第一条记录吧。',
                      )}
                </div>
              )}
            {(activeView.type === 'table' || activeView.type === 'list') && (
              <button
                type="button"
                className="database-add-row"
                onClick={() => addRecord()}
              >
                <MaterialIcon name="add" size={16} />
                {t('New record', '新建记录')}
              </button>
            )}
          </section>
        </div>
      </div>
      {settings !== null && !propertyEditor && (
        <DatabaseViewSettings
          anchor={settingsTrigger}
          database={database}
          update={update}
          section={settings}
          onSection={(section) => {
            if (section === 'sort' || section === 'filter') {
              setSettings(null);
              if (section === 'sort') queryToolbar.openSort();
              else queryToolbar.openFilter();
            } else setSettings(section);
          }}
          onClose={closeSettings}
          onAddToBoard={
            onAddToBoard
              ? () => {
                  if (flushEdits()) {
                    setSettings(null);
                    onAddToBoard(database.id, activeView.id);
                  }
                }
              : undefined
          }
          onEditProperty={(id) =>
            setPropertyEditor(
              database.properties.find((property) => property.id === id) ||
                null,
            )
          }
          onAddProperty={() =>
            setPropertyEditor({
              id: crypto.randomUUID(),
              name: '',
              type: 'text',
            })
          }
        />
      )}
      <Dialog
        open={!!renameView}
        onOpenChange={(open) => {
          if (!open) setRenameView(null);
        }}
      >
        <DialogContent className="database-dialog database-rename-view-dialog">
          <DialogTitle>{t('Rename view', '重命名视图')}</DialogTitle>
          <DialogDescription>
            {t('Choose a name for this view.', '为当前视图设置名称。')}
          </DialogDescription>
          {renameView && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('name');
                const name = typeof value === 'string' ? value.trim() : '';
                if (name) {
                  update((current) =>
                    updateDatabaseView(
                      current,
                      renameView.id,
                      { name },
                      language,
                    ),
                  );
                  setRenameView(null);
                }
              }}
            >
              <input
                name="name"
                aria-label={t('View name', '视图名称')}
                defaultValue={renameView.name}
                required
                maxLength={80}
                onFocus={(event) => event.currentTarget.select()}
              />
              <div className="database-dialog-actions">
                <button type="button" onClick={() => setRenameView(null)}>
                  {t('Cancel', '取消')}
                </button>
                <button className="database-primary" type="submit">
                  {t('Save', '保存')}
                </button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleteView}
        onOpenChange={(open) => {
          if (!open) setDeleteView(null);
        }}
      >
        <DialogContent className="database-dialog">
          <DialogTitle>
            {t('Delete “{name}”?', '删除“{name}”？', {
              name: deleteView?.name || '',
            })}
          </DialogTitle>
          <DialogDescription>
            {t(
              'Only this view and its settings will be deleted. All records and properties will remain.',
              '仅删除此视图及其设置，所有记录和字段都会保留。',
            )}
          </DialogDescription>
          <div className="database-dialog-actions">
            <button onClick={() => setDeleteView(null)}>
              {t('Cancel', '取消')}
            </button>
            <button
              className="database-danger"
              onClick={() => {
                if (deleteView)
                  update((current) =>
                    removeDatabaseView(current, deleteView.id, language),
                  );
                setDeleteView(null);
              }}
            >
              {t('Delete view', '删除视图')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      {openRecord && (
        <DatabaseRecordDrawer
          key={openRecord.id}
          database={database}
          record={openRecord}
          saveStatus={saveStatus}
          editError={editError}
          onClose={closeRecord}
          onPatch={(patch) => updateRecord(openRecord.id, patch)}
          onDuplicate={() => {
            if (flushEdits()) setOpenRecordId(duplicateRecord(openRecord));
          }}
          onDelete={() => {
            if (flushEdits())
              setDeletion({
                type: 'record',
                id: openRecord.id,
                title: openRecord.title || t('Untitled', '未命名'),
              });
          }}
          onEditProperty={(property) => {
            if (flushEdits()) {
              setSettings(null);
              setPropertyEditor(property);
            }
          }}
          onUpload={onUpload}
        />
      )}
      {propertyEditor && (
        <DatabasePropertyEditor
          key={propertyEditor.id}
          database={database}
          property={propertyEditor}
          onClose={() => {
            setPropertyEditor(null);
            closeSettings();
          }}
          onBack={() => {
            setPropertyEditor(null);
            if (!openRecord) setSettings('properties');
          }}
          onSave={(property) => {
            update(
              (current) => convertDatabaseProperty(current, property).database,
            );
          }}
          onDelete={() => {
            setDeletion({
              type: 'property',
              id: propertyEditor.id,
              title: propertyEditor.name,
            });
            setPropertyEditor(null);
          }}
        />
      )}
      <Dialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open) setDeletion(null);
        }}
      >
        <DialogContent className="database-dialog">
          <DialogTitle>
            {t('Delete “{title}”?', '删除“{title}”？', {
              title: deletion?.title || '',
            })}
          </DialogTitle>
          <DialogDescription>
            {deletion?.type === 'property'
              ? t(
                  'This will remove the property and its values from all records in this database.',
                  '将删除此字段及当前多维表中该字段的所有值。',
                )
              : t(
                  'This record will be permanently removed from this database.',
                  '这条记录将从当前多维表中永久删除。',
                )}
          </DialogDescription>
          <div className="database-dialog-actions">
            <button onClick={() => setDeletion(null)}>
              {t('Cancel', '取消')}
            </button>
            <button
              className="database-danger"
              onClick={() => {
                if (!deletion) return;
                update((current) =>
                  deletion.type === 'record'
                    ? {
                        ...current,
                        updatedAt: new Date().toISOString(),
                        records: current.records.filter(
                          (record) => record.id !== deletion.id,
                        ),
                      }
                    : removeDatabaseProperty(current, deletion.id),
                );
                setDeletion(null);
              }}
            >
              {t('Delete', '删除')}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
  return (
    <DatabaseEditContext.Provider value={editSession}>
      {page}
    </DatabaseEditContext.Provider>
  );
}
