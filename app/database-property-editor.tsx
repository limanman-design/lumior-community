'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- Option sections are pointer drop targets; named buttons provide all editing and keyboard moves. */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronRight,
  Clock,
  Flag,
  GripVertical,
  Hash,
  ListChecks,
  Palette,
  Paperclip,
  Plus,
  Settings2,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { useI18n } from './i18n';
import { databasePropertyIcons } from './database-icons';
import {
  convertDatabaseProperty,
  databaseColors,
  databasePropertyTypes,
  defaultStatusOptions,
  isChoiceProperty,
  isSystemProperty,
  validDatabaseDefaultValue,
  type DatabaseFile,
  type DatabaseOption,
  type DatabaseProperty,
  type DatabasePropertyType,
  type WorkspaceDatabase,
} from './database-model';

export const propertyIcons = databasePropertyIcons;
export function usePropertyLabels() {
  const { t } = useI18n();
  return {
    text: t('Text', '文本'),
    number: t('Number', '数字'),
    select: t('Select', '单选'),
    multiSelect: t('Multi-select', '多选'),
    status: t('Status', '状态'),
    date: t('Date', '日期'),
    checkbox: t('Checkbox', '复选框'),
    createdAt: t('Created time', '创建时间'),
    updatedAt: t('Last edited time', '上次编辑时间'),
    files: t('Files & media', '文件和媒体'),
  };
}
type EditorPage =
  | 'main'
  | 'type'
  | 'option'
  | 'color'
  | 'group'
  | 'default'
  | 'numberFormat'
  | 'dateFormat'
  | 'checkboxLabel';
const statusGroups = ['todo', 'progress', 'done'] as const;
type StatusGroup = (typeof statusGroups)[number];

function SettingRow({
  icon,
  children,
  value,
  onClick,
  selected,
  disabled = false,
  danger = false,
}: {
  icon?: ReactNode;
  children: ReactNode;
  value?: ReactNode;
  onClick: () => void;
  selected?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className="database-setting-row"
      data-danger={danger || undefined}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
    >
      {icon}
      <span>{children}</span>
      {value !== undefined && <small>{value}</small>}
      {selected === undefined ? (
        <ChevronRight size={14} />
      ) : (
        selected && <Check size={15} />
      )}
    </button>
  );
}

export function DatabasePropertyEditor({
  database,
  property,
  onSave,
  onClose,
  onBack,
  onDelete,
}: {
  database: WorkspaceDatabase;
  property: DatabaseProperty;
  onSave: (property: DatabaseProperty) => void;
  onClose: () => void;
  onBack: () => void;
  onDelete: () => void;
}) {
  const { t, language } = useI18n();
  const labels = usePropertyLabels();
  const [draft, setDraft] = useState(() => structuredClone(property));
  const [page, setPage] = useState<EditorPage>('main');
  const typeDrafts = useRef<
    Partial<Record<DatabasePropertyType, DatabaseProperty>>
  >({ [property.type]: structuredClone(property) });
  const [optionId, setOptionId] = useState<string | null>(null);
  const [newOption, setNewOption] = useState<{
    group?: StatusGroup;
    name: string;
    error: string;
  } | null>(null);
  const newOptionInput = useRef<HTMLInputElement>(null);
  const optionAddTrigger = useRef<HTMLButtonElement | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropGroup, setDropGroup] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const panel = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const existing = database.properties.some((item) => item.id === property.id);
  const options = draft.options || [];
  const option = options.find((item) => item.id === optionId);
  const preview = convertDatabaseProperty(database, draft);
  const duplicates =
    new Set(options.map((item) => item.name.trim().toLocaleLowerCase()))
      .size !== options.length;
  const valid =
    !!draft.name.trim() &&
    options.every((item) => !!item.name.trim()) &&
    !duplicates &&
    !preview.incompatible &&
    (draft.defaultValue === undefined ||
      validDatabaseDefaultValue(draft.defaultValue, draft));
  const Icon = propertyIcons[draft.type];
  const groupName = (group: StatusGroup) =>
    group === 'todo'
      ? t('To-do', '待办')
      : group === 'progress'
        ? t('In progress', '进行中')
        : t('Complete', '已完成');
  const colorNames = {
    gray: t('Gray', '灰色'),
    brown: t('Brown', '棕色'),
    orange: t('Orange', '橙色'),
    yellow: t('Yellow', '黄色'),
    green: t('Green', '绿色'),
    blue: t('Blue', '蓝色'),
    purple: t('Purple', '紫色'),
    pink: t('Pink', '粉色'),
    red: t('Red', '红色'),
  };
  const effectiveDefault =
    draft.defaultValue !== undefined
      ? draft.defaultValue
      : draft.type === 'status' ||
          (draft.id === 'status' && draft.type === 'select')
        ? ((options.find((item) => item.group === 'todo') || options[0])?.id ??
          null)
        : null;
  const defaultIds = (
    Array.isArray(effectiveDefault)
      ? effectiveDefault
      : effectiveDefault
        ? [effectiveDefault]
        : []
  ) as string[];
  const badge = (item: DatabaseOption) => (
    <span className="database-value-status" data-color={item.color}>
      {draft.type === 'status' && <i />}
      {item.name || t('Untitled', '未命名')}
    </span>
  );
  const defaultSummary = isChoiceProperty(draft)
    ? options
        .filter((item) => defaultIds.includes(item.id))
        .map((item) => item.name)
        .join(', ')
    : draft.type === 'checkbox'
      ? effectiveDefault === true
        ? t('Checked', '已勾选')
        : t('Unchecked', '未勾选')
      : draft.type === 'files'
        ? Array.isArray(effectiveDefault) && effectiveDefault.length
          ? t('{count} files', '{count} 个文件', {
              count: effectiveDefault.length,
            })
          : ''
        : typeof effectiveDefault === 'string' ||
            typeof effectiveDefault === 'number'
          ? String(effectiveDefault)
          : '';
  const patch = (change: Partial<DatabaseProperty>) => {
    setDraft((previous) => ({ ...previous, ...change }));
    setConfirmClear(false);
    setSubmitted(false);
  };
  const changeOption = (id: string, change: Partial<DatabaseOption>) =>
    patch({
      options: options.map((item) =>
        item.id === id ? { ...item, ...change } : item,
      ),
    });
  const removeOption = (id: string) => {
    patch({
      options: options.filter((item) => item.id !== id),
      ...(defaultIds.includes(id)
        ? {
            defaultValue:
              draft.type === 'multiSelect'
                ? defaultIds.filter((value) => value !== id)
                : '',
          }
        : {}),
    });
    setPage('main');
  };
  const changeType = (type: DatabasePropertyType) => {
    setNewOption(null);
    if (type === draft.type) {
      setPage('main');
      return;
    }
    typeDrafts.current[draft.type] = structuredClone(draft);
    const retained = typeDrafts.current[type];
    const next: DatabaseProperty = retained
      ? { ...structuredClone(retained), name: draft.name }
      : { ...draft, type };
    if (isChoiceProperty(next)) {
      if (!retained)
        next.options = isChoiceProperty(draft)
          ? options.map((item) => ({
              ...item,
              ...(type === 'status' ? { group: item.group || 'todo' } : {}),
            }))
          : type === 'status'
            ? defaultStatusOptions(language === 'zh')
            : [];
    } else delete next.options;
    // Records always retain their saved type until this editing session is saved.
    const conversion = convertDatabaseProperty(database, next);
    let result = conversion.incompatible
      ? next
      : conversion.database.properties.find((item) => item.id === next.id)!;
    if (!retained) {
      // The draft default can differ from the saved default; convert it separately.
      result = { ...result, defaultValue: draft.defaultValue };
      const defaultConversion = convertDatabaseProperty(
        { ...database, properties: [draft], records: [] },
        result,
      );
      result = defaultConversion.database.properties[0];
    }
    setDraft(result);
    setConfirmClear(false);
    setSubmitted(false);
    setPage('main');
  };
  const addOption = (value: string) => {
    if (!newOption) return;
    const name = value.trim();
    if (
      !name ||
      options.some(
        (item) =>
          item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
      )
    ) {
      setNewOption({
        ...newOption,
        error: !name
          ? t('Enter an option name.', '请输入选项名称。')
          : t('An option with this name already exists.', '已存在同名选项。'),
      });
      return;
    }
    const group = newOption.group;
    const item: DatabaseOption = {
      id: crypto.randomUUID(),
      name,
      color:
        group === 'progress' ? 'blue' : group === 'done' ? 'green' : 'gray',
      ...(group ? { group } : {}),
    };
    patch({ options: [...options, item] });
    setNewOption({ ...newOption, name: '', error: '' });
    setAnnouncement(t('Added option {name}', '已添加选项 {name}', { name }));
  };
  const moveOption = (id: string, group?: StatusGroup, beforeId?: string) => {
    const moving = options.find((item) => item.id === id);
    if (!moving || beforeId === id) return;
    const reordered = options.filter((item) => item.id !== id);
    const next = { ...moving, ...(group ? { group } : {}) };
    let index = beforeId
      ? reordered.findIndex((item) => item.id === beforeId)
      : -1;
    if (index < 0 && group) {
      const last = reordered.findLastIndex(
        (item) => (item.group || 'todo') === group,
      );
      index = last < 0 ? reordered.length : last + 1;
    }
    reordered.splice(index < 0 ? reordered.length : index, 0, next);
    patch({ options: reordered });
    setAnnouncement(
      group
        ? t('Moved {name} to {group}', '已将 {name} 移至{group}', {
            name: moving.name,
            group: groupName(group),
          })
        : t('Option order updated', '已更新选项顺序'),
    );
    setDraggedId(null);
    setDropGroup(null);
  };
  const save = (finish: () => void) => {
    if (newOption?.name.trim()) {
      setNewOption({
        ...newOption,
        error: t(
          'Press Enter to add this option, or Esc to cancel it.',
          '按回车添加此选项，或按 Esc 取消输入。',
        ),
      });
      setPage('main');
      newOptionInput.current?.focus();
      return;
    }
    setSubmitted(true);
    if (!valid) {
      setPage('main');
      return;
    }
    if (preview.cleared && !confirmClear) {
      setConfirmClear(true);
      setPage('main');
      return;
    }
    onSave({
      ...draft,
      name: draft.name.trim(),
      ...(isChoiceProperty(draft)
        ? {
            options: options.map((item) => ({
              ...item,
              name: item.name.trim(),
            })),
          }
        : {}),
    });
    finish();
  };
  const back = () => {
    if (page === 'main') save(onBack);
    else setPage(page === 'color' || page === 'group' ? 'option' : 'main');
  };
  useEffect(() => {
    const target = body.current?.querySelector<HTMLInputElement>(
      'input[data-editor-focus], textarea[data-editor-focus]',
    );
    if (target) {
      target.focus();
      if (page === 'option') target.select();
    } else panel.current?.focus();
    body.current?.scrollTo({ top: 0 });
  }, [page]);
  const newOptionGroup = newOption ? newOption.group || 'all' : null;
  useEffect(() => {
    if (page === 'main' && newOptionGroup) newOptionInput.current?.focus();
  }, [page, newOptionGroup]);
  const files = new Map<string, DatabaseFile>();
  for (const record of database.records)
    for (const field of database.properties.filter(
      (item) => item.type === 'files',
    )) {
      const value = record.values[field.id];
      if (Array.isArray(value))
        for (const file of value as DatabaseFile[]) files.set(file.url, file);
    }
  if (draft.type === 'files' && Array.isArray(draft.defaultValue))
    for (const file of draft.defaultValue as DatabaseFile[])
      files.set(file.url, file);
  const titles: Record<EditorPage, string> = {
    main: existing
      ? t('Edit property', '编辑字段')
      : t('New property', '新建字段'),
    type: t('Property type', '字段类型'),
    option: t('Edit option', '编辑选项'),
    color: t('Color', '颜色'),
    group: t('Group', '分组'),
    default: t('Default value', '默认值'),
    numberFormat: t('Number format', '数字格式'),
    dateFormat: t('Date format', '日期格式'),
    checkboxLabel: t('Checkbox label', '复选框文字'),
  };
  const renderOption = (item: DatabaseOption, group?: StatusGroup) => (
    <div
      key={item.id}
      className="database-property-option"
      data-dragging={draggedId === item.id || undefined}
      onDragOver={(event) => {
        if (draggedId) {
          event.preventDefault();
          event.stopPropagation();
          setDropGroup(group || 'all');
        }
      }}
      onDrop={(event) => {
        if (draggedId) {
          event.preventDefault();
          event.stopPropagation();
          moveOption(draggedId, group, item.id);
        }
      }}
    >
      <button
        type="button"
        className="database-option-grip"
        draggable
        aria-label={t(
          'Drag {name}; use Alt and arrow keys to reorder',
          '拖动 {name}；也可用 Alt 和方向键调整顺序',
          { name: item.name },
        )}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', item.id);
          setDraggedId(item.id);
        }}
        onDragEnd={() => {
          setDraggedId(null);
          setDropGroup(null);
        }}
        onKeyDown={(event) => {
          if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key))
            return;
          event.preventDefault();
          const visibleOptions =
            draft.type === 'status'
              ? statusGroups.flatMap((group) =>
                  options.filter(
                    (option) => (option.group || 'todo') === group,
                  ),
                )
              : options;
          const index = visibleOptions.indexOf(item),
            nextIndex = index + (event.key === 'ArrowUp' ? -1 : 1);
          if (nextIndex < 0 || nextIndex >= visibleOptions.length) return;
          const other = visibleOptions[nextIndex];
          moveOption(
            item.id,
            draft.type === 'status' ? other.group || 'todo' : undefined,
            event.key === 'ArrowUp'
              ? other.id
              : visibleOptions[nextIndex + 1]?.id,
          );
        }}
      >
        <GripVertical size={15} />
      </button>
      <div className="database-property-option-content">
        {badge(item)}
        {defaultIds.includes(item.id) && <small>{t('Default', '默认')}</small>}
        <button
          type="button"
          className="database-property-option-open"
          aria-label={t('Edit option: {name}', '编辑选项：{name}', {
            name: item.name,
          })}
          onClick={() => {
            setOptionId(item.id);
            setPage('option');
          }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
  return (
    <dialog
      open
      ref={panel}
      tabIndex={-1}
      aria-modal="false"
      aria-label={titles[page]}
      className="database-view-settings database-property-panel"
      onKeyDown={(event) => {
        if (
          event.nativeEvent.isComposing ||
          event.key !== 'Escape' ||
          event.defaultPrevented
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        if (page === 'main') onClose();
        else back();
      }}
    >
      <header>
        <button type="button" onClick={back} aria-label={t('Back', '返回')}>
          <ArrowLeft size={16} />
        </button>
        <h2>{titles[page]}</h2>
        <button
          type="button"
          onClick={() => {
            if (!existing && !draft.name.trim()) onClose();
            else save(onClose);
          }}
          aria-label={t('Close property settings', '关闭字段设置')}
        >
          <X size={15} />
        </button>
      </header>
      <div
        className="database-view-settings-body database-property-body"
        ref={body}
        key={page}
      >
        {page === 'main' && (
          <>
            <label className="database-property-name">
              <Icon size={17} />
              <input
                data-editor-focus={!existing || undefined}
                aria-label={t('Property name', '字段名称')}
                maxLength={80}
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
            <SettingRow
              icon={<Settings2 size={16} />}
              value={labels[draft.type]}
              onClick={() => setPage('type')}
            >
              {t('Type', '类型')}
            </SettingRow>
            {isChoiceProperty(draft) && (
              <div
                className="database-property-options"
                aria-label={t('Options', '选项')}
              >
                {(draft.type === 'status' ? statusGroups : [null]).map(
                  (group) => (
                    <section
                      key={group || 'all'}
                      className="database-property-option-group"
                      data-drop-target={
                        dropGroup === (group || 'all') || undefined
                      }
                      aria-label={
                        group ? groupName(group) : t('Options', '选项')
                      }
                      onDragOver={(event) => {
                        if (draggedId) {
                          event.preventDefault();
                          setDropGroup(group || 'all');
                        }
                      }}
                      onDragLeave={(event) => {
                        if (
                          !event.currentTarget.contains(
                            event.relatedTarget as Node,
                          )
                        )
                          setDropGroup(null);
                      }}
                      onDrop={(event) => {
                        if (draggedId) {
                          event.preventDefault();
                          moveOption(draggedId, group || undefined);
                        }
                      }}
                    >
                      <div className="database-property-group-heading">
                        <h3>
                          {group ? groupName(group) : t('Options', '选项')}
                        </h3>
                        <button
                          type="button"
                          aria-label={
                            group
                              ? t(
                                  'Add option to {group}',
                                  '向{group}添加选项',
                                  { group: groupName(group) },
                                )
                              : t('Add an option', '添加选项')
                          }
                          aria-expanded={newOptionGroup === (group || 'all')}
                          onClick={(event) => {
                            optionAddTrigger.current = event.currentTarget;
                            setNewOption({
                              group: group || undefined,
                              name: newOption?.name || '',
                              error: '',
                            });
                            newOptionInput.current?.focus();
                          }}
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                      {newOption && newOptionGroup === (group || 'all') && (
                        <div className="database-property-option-create">
                          <input
                            ref={newOptionInput}
                            aria-label={t('New option name', '新选项名称')}
                            aria-invalid={!!newOption.error || undefined}
                            placeholder={t(
                              'Option name · Enter to add',
                              '输入选项名称，回车添加',
                            )}
                            value={newOption.name}
                            maxLength={80}
                            onChange={(event) =>
                              setNewOption({
                                ...newOption,
                                name: event.target.value,
                                error: '',
                              })
                            }
                            onKeyDown={(event) => {
                              if (
                                event.nativeEvent.isComposing ||
                                // oxlint-disable-next-line typescript/no-deprecated -- Safari can clear isComposing before the IME confirmation key; 229 prevents adding an unfinished name.
                                event.nativeEvent.keyCode === 229
                              )
                                return;
                              if (event.key === 'Enter') {
                                event.preventDefault();
                                event.stopPropagation();
                                addOption(event.currentTarget.value);
                              } else if (event.key === 'Escape') {
                                event.preventDefault();
                                event.stopPropagation();
                                setNewOption(null);
                                optionAddTrigger.current?.focus();
                              }
                            }}
                          />
                          {newOption.error && (
                            <p className="database-field-error" role="alert">
                              {newOption.error}
                            </p>
                          )}
                        </div>
                      )}
                      {options
                        .filter(
                          (item) => !group || (item.group || 'todo') === group,
                        )
                        .map((item) => renderOption(item, group || undefined))}
                      {!options.some(
                        (item) => !group || (item.group || 'todo') === group,
                      ) && (
                        <p className="database-property-drop-hint">
                          {t(
                            'Drop an option here or add one',
                            '拖入选项或点击添加',
                          )}
                        </p>
                      )}
                    </section>
                  ),
                )}
                <output className="sr-only">{announcement}</output>
              </div>
            )}
            {draft.type === 'number' && (
              <SettingRow
                icon={<Hash size={16} />}
                value={
                  {
                    number: t('Number', '数字'),
                    commas: t('Thousands separator', '千位分隔'),
                    percent: t('Percent', '百分比'),
                    cny: t('Chinese yuan', '人民币 ¥'),
                    usd: t('US dollar', '美元 $'),
                  }[draft.numberFormat || 'number']
                }
                onClick={() => setPage('numberFormat')}
              >
                {t('Number format', '数字格式')}
              </SettingRow>
            )}
            {(draft.type === 'date' || isSystemProperty(draft)) && (
              <>
                <SettingRow
                  icon={<CalendarDays size={16} />}
                  value={
                    draft.dateFormat === 'iso'
                      ? 'YYYY-MM-DD'
                      : t('Local', '本地格式')
                  }
                  onClick={() => setPage('dateFormat')}
                >
                  {t('Date format', '日期格式')}
                </SettingRow>
                <button
                  type="button"
                  className="database-setting-row"
                  role="switch"
                  aria-checked={draft.includeTime ?? isSystemProperty(draft)}
                  onClick={() =>
                    patch({
                      includeTime: !(
                        draft.includeTime ?? isSystemProperty(draft)
                      ),
                    })
                  }
                >
                  <Clock size={16} />
                  <span>{t('Include time', '显示时间')}</span>
                  <span
                    className="database-property-switch"
                    data-checked={draft.includeTime ?? isSystemProperty(draft)}
                  />
                </button>
              </>
            )}
            {draft.type === 'checkbox' && (
              <SettingRow
                icon={<Type size={16} />}
                value={draft.checkboxLabel || t('None', '无')}
                onClick={() => setPage('checkboxLabel')}
              >
                {t('Checkbox label', '复选框文字')}
              </SettingRow>
            )}
            <div className="database-setting-divider" />
            {isSystemProperty(draft) ? (
              <p className="database-settings-caption">
                {t(
                  'Lumior fills this timestamp automatically for each record.',
                  '此时间由 Lumior 自动填写。',
                )}
              </p>
            ) : (
              <SettingRow
                icon={<Flag size={16} />}
                value={defaultSummary || t('None', '无')}
                onClick={() => setPage('default')}
              >
                {t('Default value', '默认值')}
              </SettingRow>
            )}
            {existing && (
              <SettingRow icon={<Trash2 size={16} />} danger onClick={onDelete}>
                {t('Delete property', '删除字段')}
              </SettingRow>
            )}
            {submitted && !draft.name.trim() && (
              <p className="database-field-error" role="alert">
                {t('Enter a property name.', '请输入字段名称。')}
              </p>
            )}
            {duplicates && (
              <p className="database-field-error" role="alert">
                {t('Option names must be unique.', '选项名称不能重复。')}
              </p>
            )}
            {options.some((item) => !item.name.trim()) && (
              <p className="database-field-error" role="alert">
                {t('Enter a name for every option.', '请为每个选项填写名称。')}
              </p>
            )}
            {!!preview.incompatible && (
              <p className="database-field-error" role="alert">
                {t(
                  '{count} records cannot be converted without losing content. Choose another type or clear those values first.',
                  '{count} 条记录无法无损转换。请选择其他类型，或先处理这些记录的值。',
                  { count: preview.incompatible },
                )}
              </p>
            )}
            {!!preview.cleared && (
              <p className="database-field-error" role="alert">
                {t(
                  'Removing these options clears their selections in {count} records.',
                  '移除这些选项将清空 {count} 条记录中对应的选择。',
                  { count: preview.cleared },
                )}
              </p>
            )}
            <div className="database-property-actions">
              <button type="button" onClick={onClose}>
                {t('Cancel', '取消')}
              </button>
              <button
                type="button"
                className="database-primary"
                disabled={!valid}
                onClick={() => save(onBack)}
              >
                {confirmClear
                  ? t('Confirm and save', '确认清空并保存')
                  : t('Save', '保存')}
              </button>
            </div>
          </>
        )}
        {page === 'type' &&
          databasePropertyTypes.map((type) => {
            const TypeIcon = propertyIcons[type];
            return (
              <SettingRow
                key={type}
                icon={<TypeIcon size={16} />}
                selected={draft.type === type}
                onClick={() => changeType(type)}
              >
                {labels[type]}
              </SettingRow>
            );
          })}
        {page === 'option' && option && (
          <>
            <input
              className="database-property-input"
              data-editor-focus
              aria-label={t('Option name', '选项名称')}
              value={option.name}
              maxLength={80}
              onChange={(event) =>
                changeOption(option.id, { name: event.target.value })
              }
            />
            <SettingRow
              icon={<Trash2 size={16} />}
              danger
              onClick={() => removeOption(option.id)}
            >
              {t('Delete option', '删除选项')}
            </SettingRow>
            <SettingRow
              icon={<Flag size={16} />}
              selected={defaultIds.includes(option.id)}
              onClick={() =>
                patch({
                  defaultValue:
                    draft.type === 'multiSelect'
                      ? defaultIds.includes(option.id)
                        ? defaultIds.filter((id) => id !== option.id)
                        : [...defaultIds, option.id]
                      : option.id,
                })
              }
            >
              {defaultIds.includes(option.id)
                ? t('Default', '默认')
                : t('Set as default', '设为默认')}
            </SettingRow>
            {draft.type === 'status' && (
              <SettingRow
                icon={<ListChecks size={16} />}
                value={groupName(option.group || 'todo')}
                onClick={() => setPage('group')}
              >
                {t('Group', '分组')}
              </SettingRow>
            )}
            <div className="database-setting-divider" />
            <SettingRow
              icon={<Palette size={16} />}
              value={
                <span
                  className="database-option-color"
                  data-color={option.color}
                >
                  <i />
                </span>
              }
              onClick={() => setPage('color')}
            >
              {t('Color', '颜色')}
            </SettingRow>
          </>
        )}
        {page === 'group' &&
          option &&
          statusGroups.map((group) => (
            <SettingRow
              key={group}
              icon={<ListChecks size={16} />}
              selected={(option.group || 'todo') === group}
              onClick={() => {
                changeOption(option.id, { group });
                setPage('option');
              }}
            >
              {groupName(group)}
            </SettingRow>
          ))}
        {page === 'color' &&
          option &&
          databaseColors.map((color) => (
            <SettingRow
              key={color}
              icon={
                <span className="database-option-color" data-color={color}>
                  <i />
                </span>
              }
              selected={option.color === color}
              onClick={() => {
                changeOption(option.id, { color });
                setPage('option');
              }}
            >
              {colorNames[color]}
            </SettingRow>
          ))}
        {page === 'numberFormat' &&
          (
            [
              ['number', t('Number', '数字')],
              ['commas', t('Thousands separator', '千位分隔')],
              ['percent', t('Percent (0.25 → 25%)', '百分比（0.25 → 25%）')],
              ['cny', t('Chinese yuan', '人民币 ¥')],
              ['usd', t('US dollar', '美元 $')],
            ] as const
          ).map(([format, label]) => (
            <SettingRow
              key={format}
              selected={(draft.numberFormat || 'number') === format}
              onClick={() => {
                patch({ numberFormat: format });
                setPage('main');
              }}
            >
              {label}
            </SettingRow>
          ))}
        {page === 'dateFormat' &&
          (['local', 'iso'] as const).map((format) => (
            <SettingRow
              key={format}
              selected={(draft.dateFormat || 'local') === format}
              onClick={() => {
                patch({ dateFormat: format });
                setPage('main');
              }}
            >
              {format === 'iso'
                ? 'YYYY-MM-DD'
                : t('Local format', '本地日期格式')}
            </SettingRow>
          ))}
        {page === 'checkboxLabel' && (
          <label className="database-property-input-label">
            {t('Text beside checkbox', '复选框旁的文字')}
            <input
              data-editor-focus
              className="database-property-input"
              value={draft.checkboxLabel || ''}
              maxLength={80}
              onChange={(event) => patch({ checkboxLabel: event.target.value })}
            />
          </label>
        )}
        {page === 'default' && (
          <>
            <p className="database-settings-caption">
              {t(
                'Only new records use this value. Existing records keep their values.',
                '仅新增行使用此默认值，已有记录保持原值。',
              )}
            </p>
            <SettingRow
              selected={
                effectiveDefault == null ||
                effectiveDefault === '' ||
                (Array.isArray(effectiveDefault) && !effectiveDefault.length)
              }
              onClick={() => patch({ defaultValue: null })}
            >
              {t('No default', '不设置默认值')}
            </SettingRow>
            <div className="database-setting-divider" />
            {isChoiceProperty(draft) &&
              options.map((item) => (
                <SettingRow
                  key={item.id}
                  selected={defaultIds.includes(item.id)}
                  onClick={() =>
                    patch({
                      defaultValue:
                        draft.type === 'multiSelect'
                          ? defaultIds.includes(item.id)
                            ? defaultIds.filter((id) => id !== item.id)
                            : [...defaultIds, item.id]
                          : item.id,
                    })
                  }
                >
                  {badge(item)}
                </SettingRow>
              ))}
            {draft.type === 'text' && (
              <label className="database-property-input-label">
                {t('Default text', '默认文本')}
                <textarea
                  className="database-property-input"
                  data-editor-focus
                  maxLength={2000}
                  rows={5}
                  value={
                    typeof effectiveDefault === 'string' ? effectiveDefault : ''
                  }
                  onChange={(event) =>
                    patch({ defaultValue: event.target.value })
                  }
                />
              </label>
            )}
            {draft.type === 'number' && (
              <label className="database-property-input-label">
                {t('Default number', '默认数字')}
                <input
                  className="database-property-input"
                  data-editor-focus
                  type="number"
                  step="any"
                  value={
                    typeof effectiveDefault === 'number' ? effectiveDefault : ''
                  }
                  onChange={(event) =>
                    patch({
                      defaultValue:
                        event.target.value === '' ||
                        !Number.isFinite(event.target.valueAsNumber)
                          ? null
                          : event.target.valueAsNumber,
                    })
                  }
                />
              </label>
            )}
            {draft.type === 'date' && (
              <label className="database-property-input-label">
                {t('Default date', '默认日期')}
                <input
                  className="database-property-input"
                  data-editor-focus
                  type={draft.includeTime ? 'datetime-local' : 'date'}
                  min="0001-01-01"
                  max={draft.includeTime ? '9999-12-31T23:59' : '9999-12-31'}
                  value={
                    typeof effectiveDefault === 'string'
                      ? draft.includeTime
                        ? effectiveDefault.length === 10
                          ? `${effectiveDefault}T00:00`
                          : effectiveDefault
                        : effectiveDefault.slice(0, 10)
                      : ''
                  }
                  onChange={(event) =>
                    patch({ defaultValue: event.target.value || null })
                  }
                />
              </label>
            )}
            {draft.type === 'checkbox' && (
              <>
                {[true, false].map((value) => (
                  <SettingRow
                    key={String(value)}
                    icon={<CheckSquare size={16} />}
                    selected={effectiveDefault === value}
                    onClick={() => patch({ defaultValue: value })}
                  >
                    {value ? t('Checked', '已勾选') : t('Unchecked', '未勾选')}
                  </SettingRow>
                ))}
              </>
            )}
            {draft.type === 'files' && (
              <>
                <p className="database-settings-caption">
                  {t(
                    'Choose files already attached in this database.',
                    '选择此多维表中已有的附件。',
                  )}
                </p>
                {[...files.values()].map((file) => {
                  const selected =
                    Array.isArray(effectiveDefault) &&
                    (effectiveDefault as DatabaseFile[]).some(
                      (item) => item.url === file.url,
                    );
                  return (
                    <SettingRow
                      key={file.url}
                      icon={<Paperclip size={16} />}
                      selected={selected}
                      onClick={() => {
                        const current = Array.isArray(effectiveDefault)
                          ? (effectiveDefault as DatabaseFile[])
                          : [];
                        patch({
                          defaultValue: selected
                            ? current.filter((item) => item.url !== file.url)
                            : [...current, file],
                        });
                      }}
                    >
                      {file.name}
                    </SettingRow>
                  );
                })}
                {!files.size && (
                  <p className="database-settings-caption">
                    {t(
                      'Attach a file to a record first to use it as a default.',
                      '先在记录中添加附件，即可将它设为默认值。',
                    )}
                  </p>
                )}
              </>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
