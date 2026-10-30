'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { ChevronRight, MoreHorizontal, Pencil } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from './i18n';
import { useDatabaseEditCommit } from './database-edit-context';
import { PropertyValue, type DatabaseUpload } from './database-value-editor';
import { propertyIcons } from './database-property-editor';
import type {
  DatabaseProperty,
  DatabaseRecord,
  WorkspaceDatabase,
} from './database-model';
import type { SaveStatus } from './local-repository';
import './database-record-drawer.css';

/** Read first, edit explicitly. The record-keyed owner keeps drafts isolated. */
function RecordText({
  value,
  label,
  title = false,
  onCommit,
}: {
  value: string;
  label: string;
  title?: boolean;
  onCommit: (value: string) => void;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [measurement, setMeasurement] = useState(value);
  const input = useRef<HTMLTextAreaElement>(null);
  const draft = useRef(value),
    saved = useRef(value),
    cancelled = useRef(false);
  const commit = () => {
    if (!editing || cancelled.current) return;
    const next = input.current?.value ?? draft.current;
    if (next !== saved.current) {
      saved.current = next;
      onCommit(next);
    }
  };
  useDatabaseEditCommit(commit, editing);
  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus({ preventScroll: true });
      const length = input.current?.value.length || 0;
      input.current?.setSelectionRange(length, length);
    }
  }, [editing]);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto';
    input.current.style.height = `${input.current.scrollHeight}px`;
  }, [editing, measurement]);
  const edit = () => {
    draft.current = saved.current = value;
    cancelled.current = false;
    setMeasurement(value);
    setEditing(true);
  };
  if (editing)
    return (
      <textarea
        ref={input}
        className={
          title ? 'database-record-title' : 'database-record-long-text-input'
        }
        aria-label={label}
        defaultValue={value}
        maxLength={title ? 2000 : undefined}
        rows={title ? 1 : 3}
        onChange={(event) => {
          draft.current = event.currentTarget.value;
          setMeasurement(draft.current);
        }}
        onBlur={() => {
          commit();
          setEditing(false);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            cancelled.current = true;
            setEditing(false);
          } else if (
            event.key === 'Enter' &&
            (title || event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    );
  if (title)
    return (
      <button
        type="button"
        className="database-record-heading"
        onClick={edit}
        aria-label={t('Edit record name', '编辑记录名称')}
      >
        {value || t('Untitled', '未命名')}
      </button>
    );
  return (
    <>
      <button
        type="button"
        className="database-record-edit-text"
        onClick={edit}
        aria-label={t('Edit {name}', '编辑{name}', { name: label })}
      >
        <Pencil size={13} />
        {t('Edit', '编辑')}
      </button>
      <div
        className={`database-record-long-text-content${value ? '' : ' database-record-value-empty'}`}
      >
        {value || t('Empty', '空')}
      </div>
    </>
  );
}

export function DatabaseRecordDrawer({
  database,
  record,
  saveStatus,
  editError,
  onClose,
  onPatch,
  onDuplicate,
  onDelete,
  onEditProperty,
  onUpload,
}: {
  database: WorkspaceDatabase;
  record: DatabaseRecord;
  saveStatus: SaveStatus;
  editError: string;
  onClose: () => void;
  onPatch: (patch: Pick<Partial<DatabaseRecord>, 'title' | 'values'>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEditProperty: (property: DatabaseProperty) => void;
  onUpload: DatabaseUpload;
}) {
  const { t, locale } = useI18n();
  const panel = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    panel.current?.focus({ preventScroll: true });
  }, []);
  return (
    <dialog
      open
      ref={panel}
      className="database-record-drawer"
      aria-modal="false"
      aria-label={t('Record details', '记录详情')}
      tabIndex={-1}
    >
      <header className="database-record-drawer-header">
        <button
          type="button"
          className="database-record-back"
          aria-label={t('Close record details', '关闭记录详情')}
          title={t('Close record details', '关闭记录详情')}
          onClick={onClose}
        >
          <ChevronRight size={19} />
          <span>{t('Back', '返回')}</span>
        </button>
        <span className="database-record-drawer-context" title={database.title}>
          {database.title}
        </span>
        <div className="database-record-drawer-actions">
          <DropdownMenu>
            <DropdownMenuTrigger aria-label={t('Record actions', '记录操作')}>
              <MoreHorizontal size={17} />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="lumior-menu" align="end">
              <DropdownMenuItem onClick={onDuplicate}>
                {t('Duplicate record', '复制记录')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                {t('Delete record', '删除记录')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      {(editError || saveStatus === 'error') && (
        <p className="database-record-edit-error" role="alert">
          {editError ||
            t('Save failed · check Settings', '保存失败 · 请检查设置')}
        </p>
      )}
      <div className="database-record-drawer-body">
        <h2 aria-label={record.title || t('Untitled', '未命名')}>
          <RecordText
            value={record.title}
            label={t('Record name', '记录名称')}
            title
            onCommit={(title) => onPatch({ title })}
          />
        </h2>
        <div className="database-record-properties">
          {database.properties
            .filter((property) => property.type !== 'text')
            .map((property) => {
              const Icon = propertyIcons[property.type];
              return (
                <div
                  className="database-record-property"
                  key={`${record.id}:${property.id}`}
                >
                  <span>
                    <Icon size={14} />
                    {property.name}
                  </span>
                  <PropertyValue
                    record={record}
                    property={property}
                    onEditProperty={() => onEditProperty(property)}
                    onUpload={(files) =>
                      onUpload(database.id, record.id, property.id, files)
                    }
                    onCommit={(value) =>
                      onPatch({ values: { [property.id]: value } })
                    }
                  />
                </div>
              );
            })}
        </div>
        {database.properties
          .filter((property) => property.type === 'text')
          .map((property) => (
            <section
              className="database-record-long-text"
              key={`${record.id}:${property.id}`}
              aria-label={property.name}
            >
              <header>
                <span>{property.name}</span>
              </header>
              <RecordText
                value={
                  typeof record.values[property.id] === 'string'
                    ? (record.values[property.id] as string)
                    : ''
                }
                label={property.name}
                onCommit={(value) =>
                  onPatch({ values: { [property.id]: value } })
                }
              />
            </section>
          ))}
        <div className="database-record-times">
          <span>
            {t('Created', '创建时间')}
            <time dateTime={record.createdAt}>
              {new Date(record.createdAt).toLocaleString(locale)}
            </time>
          </span>
          <span>
            {t('Updated', '更新时间')}
            <time dateTime={record.updatedAt}>
              {new Date(record.updatedAt).toLocaleString(locale)}
            </time>
          </span>
        </div>
      </div>
    </dialog>
  );
}
