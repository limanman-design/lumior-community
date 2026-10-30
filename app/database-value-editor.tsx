'use client';
/* oxlint-disable next/no-img-element -- User attachments are local blob URLs, never sent to an image service. */
/* oxlint-disable jsx-a11y/media-has-caption -- Local attachment previews have no supplied caption tracks; their names and download links remain accessible. */
import { useLayoutEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  Download,
  File as FileIcon,
  Paperclip,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { zhCN, enUS } from 'react-day-picker/locale';
import { useI18n } from './i18n';
import {
  databaseValue,
  databaseValueText,
  isChoiceProperty,
  isSystemProperty,
  type DatabaseFile,
  type DatabaseProperty,
  type DatabaseRecord,
  type DatabaseValue,
} from './database-model';
import { formatBytes } from './storage-management';
import {
  DatabaseEditValidationError,
  useDatabaseEditCommit,
} from './database-edit-context';

export type DatabaseUpload = (
  databaseId: string,
  recordId: string,
  propertyId: string,
  files: File[],
) => Promise<void>;
export function DatabaseValueDisplay({
  record,
  property,
}: {
  record: DatabaseRecord;
  property: DatabaseProperty;
}) {
  const { t, locale } = useI18n();
  const value = databaseValue(record, property);
  if (property.type === 'checkbox')
    return (
      <span className="database-value">
        <span className="database-check" data-checked={value === true}>
          {value === true && <Check size={11} />}
        </span>
        {property.checkboxLabel ?? property.name}
      </span>
    );
  if (value == null || value === '' || (Array.isArray(value) && !value.length))
    return <span className="database-value-empty">{t('Empty', '空')}</span>;
  if (isChoiceProperty(property)) {
    const ids = (Array.isArray(value) ? value : [value]) as string[];
    return (
      <span className="database-choice-values">
        {property.options
          ?.filter((option) => ids.includes(option.id))
          .map((option) => (
            <span
              className="database-value-status"
              data-color={option.color}
              key={option.id}
            >
              {property.type === 'status' && <i />}
              {option.name}
            </span>
          ))}
      </span>
    );
  }
  if (property.type === 'files')
    return (
      <span className="database-file-values">
        {(value as DatabaseFile[]).map((file) => (
          <span key={file.url} className="database-file-chip">
            {/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type) ? (
              <img src={file.url} alt="" />
            ) : (
              <Paperclip size={13} />
            )}
            <span>{file.name}</span>
          </span>
        ))}
      </span>
    );
  return (
    <span className="database-value">
      {property.type === 'date' && <CalendarDays size={13} />}
      <span>{databaseValueText(record, property, locale)}</span>
    </span>
  );
}
function TextArea({
  value,
  label,
  onDraft,
  onBlur,
  onCancel,
  onDone,
}: {
  value: string;
  label: string;
  onDraft: (value: string) => void;
  onBlur: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const initialValue = useRef(value);
  const [measurement, setMeasurement] = useState(value);
  useLayoutEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(
      initialValue.current.length,
      initialValue.current.length,
    );
  }, []);
  return (
    <div className="database-textarea-wrap">
      <div className="database-textarea-measure" aria-hidden="true">
        {measurement + '\u200b'}
      </div>
      <textarea
        ref={ref}
        className="database-textarea"
        defaultValue={value}
        aria-label={label}
        placeholder=""
        onChange={(event) => {
          onDraft(event.target.value);
          setMeasurement(event.target.value);
        }}
        onBlur={onBlur}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onDone();
          }
        }}
      />
    </div>
  );
}
function TextValue({
  value,
  label,
  onCommit,
}: {
  value: string;
  label: string;
  onCommit: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchorHeight, setAnchorHeight] = useState(38);
  const draft = useRef(value),
    cancelled = useRef(false),
    saved = useRef(value);
  const commit = () => {
    if (!cancelled.current && draft.current !== saved.current) {
      saved.current = draft.current;
      onCommit(draft.current);
    }
  };
  useDatabaseEditCommit(commit, open);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setAnchorHeight(trigger.current?.offsetHeight || 38);
          draft.current = value;
          saved.current = value;
          cancelled.current = false;
        } else commit();
        setOpen(next);
      }}
    >
      <PopoverTrigger
        ref={trigger}
        className="database-cell-trigger database-text-cell"
        aria-label={label}
      >
        <span>{value || <span className="database-value-empty">—</span>}</span>
      </PopoverTrigger>
      <PopoverContent
        className="database-cell-popover database-text-popover"
        align="start"
        sideOffset={-anchorHeight}
        aria-label={label}
      >
        <TextArea
          value={value}
          label={label}
          onDraft={(value) => {
            draft.current = value;
          }}
          onBlur={commit}
          onCancel={() => {
            cancelled.current = true;
            setOpen(false);
          }}
          onDone={() => {
            commit();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
const focusNumberInput = (input: HTMLInputElement | null) => {
  input?.focus();
};
function NumberValue({
  record,
  property,
  label,
  onCommit,
}: {
  record: DatabaseRecord;
  property: DatabaseProperty;
  label: string;
  onCommit: (value: DatabaseValue) => void;
}) {
  const { locale, t } = useI18n();
  const [editing, setEditing] = useState(false),
    [error, setError] = useState(false);
  const value = record.values[property.id];
  const cancelled = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(typeof value === 'number' ? String(value) : '');
  const saved = useRef(typeof value === 'number' ? String(value) : '');
  const commit = () => {
    if (!editing || cancelled.current) return true;
    if (input.current && !input.current.validity.valid) {
      setError(true);
      return false;
    }
    const next = input.current?.value ?? pending.current;
    if (next !== saved.current) {
      saved.current = next;
      onCommit(next === '' ? null : Number(next));
    }
    setError(false);
    return true;
  };
  useDatabaseEditCommit(() => {
    if (!commit()) throw new DatabaseEditValidationError();
  }, editing);
  return editing ? (
    <input
      ref={(element) => {
        input.current = element;
        focusNumberInput(element);
      }}
      className="database-number-input"
      type="number"
      step="any"
      aria-label={label}
      defaultValue={typeof value === 'number' ? String(value) : ''}
      aria-invalid={error || undefined}
      onChange={(event) => {
        pending.current = event.currentTarget.value;
      }}
      onFocus={() => {
        cancelled.current = false;
      }}
      onBlur={() => {
        if (commit()) setEditing(false);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          cancelled.current = true;
          event.currentTarget.blur();
        }
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
    />
  ) : (
    <button
      type="button"
      className="database-cell-trigger"
      aria-label={label}
      onClick={() => {
        pending.current = saved.current =
          typeof value === 'number' ? String(value) : '';
        cancelled.current = false;
        setEditing(true);
      }}
      title={error ? t('Enter a valid number', '请输入有效数字') : undefined}
    >
      {databaseValueText(record, property, locale) || (
        <span className="database-value-empty">—</span>
      )}
    </button>
  );
}
function ChoiceValue({
  record,
  property,
  label,
  onCommit,
  onEditProperty,
}: {
  record: DatabaseRecord;
  property: DatabaseProperty;
  label: string;
  onCommit: (value: DatabaseValue) => void;
  onEditProperty: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState('');
  const value = record.values[property.id];
  const selected = (
    Array.isArray(value) ? value : value ? [value] : []
  ) as string[];
  const multi = property.type === 'multiSelect';
  const options = (property.options || []).filter((option) =>
    option.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const choose = (id: string) => {
    onCommit(
      multi
        ? selected.includes(id)
          ? selected.filter((value) => value !== id)
          : [...selected, id]
        : id,
    );
    if (!multi) setOpen(false);
  };
  const groups =
    property.type === 'status'
      ? (['todo', 'progress', 'done'] as const)
      : [null];
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setQuery('');
      }}
    >
      <PopoverTrigger className="database-cell-trigger" aria-label={label}>
        <DatabaseValueDisplay record={record} property={property} />
      </PopoverTrigger>
      <PopoverContent
        className="database-cell-popover database-choice-popover"
        align="start"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          const input = event.target instanceof HTMLInputElement;
          if (input && event.key === 'Enter' && options[0]) {
            event.preventDefault();
            choose(options[0].id);
          }
          if (
            !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
            (input && ['Home', 'End'].includes(event.key))
          )
            return;
          const choices = Array.from(
            event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '.database-choice-option',
            ),
          );
          if (!choices.length) return;
          event.preventDefault();
          const current = choices.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices.length - 1
                : (current +
                    (event.key === 'ArrowDown' ? 1 : choices.length - 1) +
                    choices.length) %
                  choices.length;
          choices[next].focus();
        }}
      >
        <label className="database-option-search">
          <Search size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('Search options…', '搜索选项…')}
            aria-label={t('Search options', '搜索选项')}
          />
        </label>
        <fieldset
          className="database-choice-list"
          aria-label={t('Options', '选项')}
        >
          {groups.map((group) => (
            <div key={group || 'all'}>
              {group && (
                <div className="database-choice-group">
                  {group === 'todo'
                    ? t('Not started', '未开始')
                    : group === 'progress'
                      ? t('In progress', '进行中')
                      : t('Complete', '已完成')}
                </div>
              )}
              {options
                .filter(
                  (option) => !group || (option.group || 'todo') === group,
                )
                .map((option) => (
                  <button
                    type="button"
                    className="database-choice-option"
                    key={option.id}
                    role={multi ? 'checkbox' : 'radio'}
                    aria-checked={selected.includes(option.id)}
                    onClick={() => choose(option.id)}
                  >
                    <span
                      className="database-value-status"
                      data-color={option.color}
                    >
                      {property.type === 'status' && <i />}
                      {option.name}
                    </span>
                    {selected.includes(option.id) && <Check size={14} />}
                  </button>
                ))}
            </div>
          ))}
          {!options.length && (
            <p className="database-field-help">
              {t('No matching options', '没有匹配的选项')}
            </p>
          )}
        </fieldset>
        <div className="database-choice-footer">
          <button
            type="button"
            onClick={() => {
              onCommit(multi ? [] : '');
              setOpen(false);
            }}
          >
            <X size={13} />
            {t('Clear', '清空')}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onEditProperty();
            }}
          >
            <Settings2 size={13} />
            {t('Edit options', '编辑选项')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
function DateValue({
  record,
  property,
  label,
  onCommit,
}: {
  record: DatabaseRecord;
  property: DatabaseProperty;
  label: string;
  onCommit: (value: DatabaseValue) => void;
}) {
  const { t, language } = useI18n();
  const cellValue = record.values[property.id];
  const value = typeof cellValue === 'string' ? cellValue : '';
  const [open, setOpen] = useState(false),
    [error, setError] = useState(false),
    [draft, setDraft] = useState(value);
  const [month, setMonth] = useState(
    value ? new Date(value.slice(0, 10) + 'T00:00:00') : new Date(),
  );
  const pending = useRef(value),
    cancelled = useRef(false);
  const saved = useRef(value),
    invalid = useRef(false);
  const commit = () => {
    if (
      !cancelled.current &&
      !invalid.current &&
      pending.current !== saved.current
    ) {
      saved.current = pending.current;
      onCommit(pending.current);
    }
  };
  useDatabaseEditCommit(() => {
    if (open && !cancelled.current && invalid.current)
      throw new DatabaseEditValidationError();
    if (open) commit();
  }, open);
  const change = (next: string) => {
    pending.current = next;
    setDraft(next);
    setError(false);
    invalid.current = false;
  };
  const selected = draft
    ? new Date(draft.slice(0, 10) + 'T00:00:00')
    : undefined;
  const inputDate = (input: HTMLInputElement) => {
    setError(!input.validity.valid);
    invalid.current = !input.validity.valid;
    if (!input.validity.valid) return;
    change(
      input.value && !property.includeTime && draft.length > 10
        ? input.value + draft.slice(10)
        : input.value,
    );
    if (input.value) setMonth(new Date(input.value.slice(0, 10) + 'T00:00:00'));
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next && invalid.current && !cancelled.current) {
          setError(true);
          return;
        }
        if (next) {
          saved.current = value;
          change(value);
          setMonth(
            value ? new Date(value.slice(0, 10) + 'T00:00:00') : new Date(),
          );
          cancelled.current = false;
        } else commit();
        setOpen(next);
      }}
    >
      <PopoverTrigger className="database-cell-trigger" aria-label={label}>
        <DatabaseValueDisplay record={record} property={property} />
      </PopoverTrigger>
      <PopoverContent
        className="database-cell-popover database-date-popover"
        align="start"
        aria-label={label}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.stopPropagation();
            cancelled.current = true;
            setOpen(false);
          }
        }}
      >
        <label>
          {t('Date', '日期')}
          <input
            type={property.includeTime ? 'datetime-local' : 'date'}
            min={property.includeTime ? '0001-01-01T00:00' : '0001-01-01'}
            max={property.includeTime ? '9999-12-31T23:59' : '9999-12-31'}
            value={
              property.includeTime
                ? draft.length === 10
                  ? draft + 'T00:00'
                  : draft
                : draft.slice(0, 10)
            }
            aria-label={label}
            onChange={(event) => inputDate(event.currentTarget)}
            onInput={(event) => inputDate(event.currentTarget)}
            onBlur={(event) => {
              if (
                !(event.relatedTarget instanceof Node) ||
                !event.currentTarget
                  .closest('.database-date-popover')
                  ?.contains(event.relatedTarget)
              )
                commit();
            }}
          />
        </label>
        <Calendar
          className="database-date-calendar"
          mode="single"
          locale={language === 'zh' ? zhCN : enUS}
          selected={selected}
          month={month}
          onMonthChange={setMonth}
          onSelect={(date) => {
            if (!date) return;
            const dateText = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            change(
              dateText +
                (pending.current.length > 10
                  ? pending.current.slice(10)
                  : property.includeTime
                    ? 'T00:00'
                    : ''),
            );
            commit();
          }}
        />
        {error && (
          <p role="alert" className="database-field-error">
            {t('Enter a valid date.', '请输入有效日期。')}
          </p>
        )}
        <div className="database-choice-footer">
          <button
            type="button"
            onClick={() => {
              change('');
              commit();
              setOpen(false);
            }}
          >
            {t('Clear', '清空')}
          </button>
          <button
            type="button"
            disabled={error}
            onClick={() => {
              commit();
              setOpen(false);
            }}
          >
            {t('Done', '完成')}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
function AttachmentName({
  file,
  onRename,
}: {
  file: DatabaseFile;
  onRename: (name: string) => void;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const draft = useRef(file.name),
    saved = useRef(file.name),
    cancelled = useRef(false);
  const commit = () => {
    if (cancelled.current) return;
    const name = (input.current?.value ?? draft.current).trim();
    if (name && name !== saved.current) {
      saved.current = name;
      onRename(name);
    }
  };
  useDatabaseEditCommit(commit);
  return (
    <input
      ref={input}
      defaultValue={file.name}
      maxLength={240}
      aria-label={t('File name: {name}', '文件名称：{name}', {
        name: file.name,
      })}
      onFocus={() => {
        cancelled.current = false;
      }}
      onChange={(event) => {
        draft.current = event.currentTarget.value;
      }}
      onBlur={() => {
        commit();
        if (input.current) input.current.value = saved.current;
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          cancelled.current = true;
          draft.current = saved.current;
          event.currentTarget.value = saved.current;
        }
        if (event.key === 'Escape' || event.key === 'Enter')
          event.currentTarget.blur();
      }}
    />
  );
}

const emptyFiles: DatabaseFile[] = [];

function FilesValue({
  record,
  property,
  label,
  onCommit,
  onUpload,
}: {
  record: DatabaseRecord;
  property: DatabaseProperty;
  label: string;
  onCommit: (value: DatabaseValue) => void;
  onUpload: (files: File[]) => Promise<void>;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const files = (record.values[property.id] || emptyFiles) as DatabaseFile[];
  const latestFiles = useRef(files);
  useLayoutEffect(() => {
    latestFiles.current = files;
  }, [files]);
  const commitFiles = (next: DatabaseFile[]) => {
    latestFiles.current = next;
    onCommit(next);
  };
  const picker = useRef<HTMLInputElement>(null);
  const upload = async (incoming: File[]) => {
    if (!incoming.length || busy) return;
    setBusy(true);
    setError('');
    try {
      await onUpload(incoming);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover>
      <PopoverTrigger className="database-cell-trigger" aria-label={label}>
        <DatabaseValueDisplay record={record} property={property} />
      </PopoverTrigger>
      <PopoverContent
        className="database-cell-popover database-files-popover"
        align="start"
        aria-label={label}
      >
        <div className="database-files-list">
          {files.map((file) => (
            <div className="database-attachment" key={file.url}>
              <div className="database-attachment-preview">
                {/^image\/(png|jpeg|gif|webp|avif)$/.test(file.type) ? (
                  <img src={file.url} alt={file.name} />
                ) : file.type.startsWith('audio/') ? (
                  <audio src={file.url} controls preload="none" />
                ) : file.type.startsWith('video/') ? (
                  <video src={file.url} controls preload="metadata" />
                ) : (
                  <FileIcon size={24} />
                )}
              </div>
              <div className="database-attachment-info">
                <AttachmentName
                  file={file}
                  onRename={(name) =>
                    commitFiles(
                      latestFiles.current.map((item) =>
                        item.url === file.url ? { ...item, name } : item,
                      ),
                    )
                  }
                />
                <span>{formatBytes(file.size)}</span>
              </div>
              <a
                href={file.url}
                download={file.name}
                className="database-attachment-action"
                aria-label={t('Download {name}', '下载 {name}', {
                  name: file.name,
                })}
              >
                <Download size={14} />
              </a>
              <button
                type="button"
                className="database-attachment-action"
                aria-label={t('Remove {name}', '移除 {name}', {
                  name: file.name,
                })}
                onClick={() =>
                  commitFiles(
                    latestFiles.current.filter((item) => item.url !== file.url),
                  )
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="database-file-drop"
          disabled={busy}
          onClick={() => picker.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void upload(Array.from(event.dataTransfer.files));
          }}
        >
          <Plus size={16} />
          {busy
            ? t('Uploading…', '正在上传…')
            : t('Upload or drop files', '上传或拖入文件')}
          <span>{t('Up to 50 MB per file', '每个文件最大 50 MB')}</span>
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            void upload(Array.from(event.target.files || []));
            event.target.value = '';
          }}
        />
        {error && (
          <p role="alert" className="database-field-error">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
export function PropertyValue({
  record,
  property,
  onCommit,
  onEditProperty,
  onUpload,
}: {
  record: DatabaseRecord;
  property: DatabaseProperty;
  onCommit: (value: DatabaseValue) => void;
  onEditProperty: () => void;
  onUpload: (files: File[]) => Promise<void>;
}) {
  const { t, locale } = useI18n();
  const value = databaseValue(record, property);
  const label = `${record.title || t('Untitled record', '未命名记录')} · ${property.name}`;
  if (isSystemProperty(property))
    return (
      <span
        className="database-system-value"
        title={t('Automatically maintained by Lumior', '由 Lumior 自动维护')}
      >
        {databaseValueText(record, property, locale)}
      </span>
    );
  if (property.type === 'text')
    return (
      <TextValue
        value={typeof value === 'string' ? value : ''}
        label={label}
        onCommit={onCommit}
      />
    );
  if (property.type === 'number')
    return (
      <NumberValue
        record={record}
        property={property}
        label={label}
        onCommit={onCommit}
      />
    );
  if (property.type === 'checkbox')
    return (
      <label className="database-checkbox-cell">
        <input
          type="checkbox"
          checked={value === true}
          aria-label={label}
          onChange={(event) => onCommit(event.target.checked)}
        />
        <span>{property.checkboxLabel || ''}</span>
      </label>
    );
  if (isChoiceProperty(property))
    return (
      <ChoiceValue
        record={record}
        property={property}
        label={label}
        onCommit={onCommit}
        onEditProperty={onEditProperty}
      />
    );
  if (property.type === 'date')
    return (
      <DateValue
        record={record}
        property={property}
        label={label}
        onCommit={onCommit}
      />
    );
  return (
    <FilesValue
      record={record}
      property={property}
      label={label}
      onCommit={onCommit}
      onUpload={onUpload}
    />
  );
}
