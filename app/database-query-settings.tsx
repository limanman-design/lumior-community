'use client';
/* oxlint-disable jsx-a11y/no-noninteractive-element-interactions -- Sort rows are drop targets; their named drag handles also support keyboard reordering. */
import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, GripVertical, Plus, Trash2, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { zhCN, enUS } from 'react-day-picker/locale';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useI18n } from './i18n';
import { propertyIcons } from './database-property-editor';
import {
  databaseSorts,
  type DatabaseFilterGroup,
  type DatabaseFilterRule,
  type DatabaseFilterOperator,
  type DatabaseProperty,
  type DatabaseSort,
  type DatabaseView,
  type WorkspaceDatabase,
} from './database-model';
import {
  databaseFilterCount,
  databaseFilterNodeCount,
  databaseFilterOperators,
  databaseRelativeDates,
} from './database-query';

type Patch = (values: Partial<DatabaseView>) => void;

export function reorderDatabaseSorts(
  sorts: DatabaseSort[],
  draggedPropertyId: string,
  targetPropertyId: string,
): DatabaseSort[] {
  const from = sorts.findIndex((sort) => sort.propertyId === draggedPropertyId);
  const to = sorts.findIndex((sort) => sort.propertyId === targetPropertyId);
  if (from < 0 || to < 0 || from === to) return sorts;
  const next = [...sorts];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

export function DatabaseQueryPropertyPicker({
  properties,
  onSelect,
  label,
  children,
  disabled,
  className = 'database-setting-row',
}: {
  properties: DatabaseProperty[];
  onSelect: (property: DatabaseProperty) => void;
  label: string;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={className}
        disabled={disabled || properties.length === 0}
        aria-label={label}
      >
        {children ?? (
          <>
            <Plus size={15} />
            {label}
          </>
        )}
      </PopoverTrigger>
      <PopoverContent
        className="database-query-property-picker"
        align="start"
        aria-label={label}
      >
        <DatabaseQueryPropertyList
          properties={properties}
          label={label}
          onSelect={(property) => {
            onSelect(property);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function DatabaseQueryPropertyList({
  properties,
  onSelect,
  label,
  children,
}: {
  properties: DatabaseProperty[];
  onSelect: (property: DatabaseProperty) => void;
  label?: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const matches = properties.filter((property) =>
    property.name
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className="database-query-property-list">
      <input
        type="search"
        aria-label={label ?? t('Search properties', '搜索字段')}
        placeholder={t('Search properties…', '搜索字段…')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onInput={(event) => setSearch(event.currentTarget.value)}
      />
      <div className="database-query-property-options">
        {matches.map((property) => {
          const Icon = propertyIcons[property.type];
          return (
            <button
              type="button"
              className="database-setting-row"
              key={property.id}
              onClick={() => {
                onSelect(property);
                setSearch('');
              }}
            >
              <Icon size={16} />
              <span>{property.name}</span>
            </button>
          );
        })}
        {!matches.length && (
          <p className="database-settings-caption">
            {t('No matching properties', '没有匹配的字段')}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}

export function DatabaseSortSettings({
  database,
  view,
  patch,
  onAddSort,
}: {
  database: WorkspaceDatabase;
  view: DatabaseView;
  patch: Patch;
  onAddSort?: () => void;
}) {
  const { t } = useI18n();
  const draggedPropertyId = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const properties: DatabaseProperty[] = [
    { id: 'title', name: t('Name', '名称'), type: 'text' },
    ...database.properties,
  ];
  const sorts = databaseSorts(view);
  const availableProperties = properties.filter(
    (property) => !sorts.some((sort) => sort.propertyId === property.id),
  );
  const move = (propertyId: string, targetId: string) => {
    const next = reorderDatabaseSorts(sorts, propertyId, targetId);
    if (next !== sorts) patch({ sorts: next });
  };
  return (
    <div className="database-query-settings database-query-editor">
      <div className="database-sort-rules">
        {sorts.map((sort, index) => (
          <div
            className="database-sort-row"
            key={sort.propertyId}
            data-drag-over={dragOver === sort.propertyId || undefined}
            onDragOver={(event) => {
              if (!draggedPropertyId.current) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
              setDragOver(sort.propertyId);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDragOver(null);
            }}
            onDrop={(event) => {
              if (!draggedPropertyId.current) return;
              event.preventDefault();
              move(draggedPropertyId.current, sort.propertyId);
              draggedPropertyId.current = null;
              setDragOver(null);
            }}
          >
            <button
              type="button"
              className="database-query-drag-handle"
              draggable
              aria-label={t(
                'Reorder sort {number}; drag or use the Up and Down arrow keys',
                '调整排序 {number} 的优先级；可拖动或使用上下方向键',
                { number: index + 1 },
              )}
              aria-keyshortcuts="ArrowUp ArrowDown"
              title={t(
                'Drag to reorder, or use the Up and Down arrow keys',
                '拖动调整优先级，也可使用上下方向键',
              )}
              onDragStart={(event) => {
                draggedPropertyId.current = sort.propertyId;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', sort.propertyId);
              }}
              onDragEnd={() => {
                draggedPropertyId.current = null;
                setDragOver(null);
              }}
              onKeyDown={(event) => {
                const direction =
                  event.key === 'ArrowUp'
                    ? -1
                    : event.key === 'ArrowDown'
                      ? 1
                      : 0;
                if (!direction) return;
                event.preventDefault();
                const target = sorts[index + direction];
                if (target) move(sort.propertyId, target.propertyId);
              }}
            >
              <GripVertical size={15} />
            </button>
            <select
              className="database-sort-property"
              aria-label={t('Sort property {number}', '排序字段 {number}', {
                number: index + 1,
              })}
              value={sort.propertyId}
              onChange={(event) =>
                patch({
                  sorts: sorts.map((item, i) =>
                    i === index
                      ? { ...item, propertyId: event.target.value }
                      : item,
                  ),
                })
              }
            >
              {properties
                .filter(
                  (property) =>
                    property.id === sort.propertyId ||
                    !sorts.some((item) => item.propertyId === property.id),
                )
                .map((property) => (
                  <option key={property.id} value={property.id}>
                    {property.name}
                  </option>
                ))}
            </select>
            <select
              className="database-sort-direction"
              aria-label={t('Sort direction {number}', '排序方向 {number}', {
                number: index + 1,
              })}
              value={sort.direction}
              onChange={(event) =>
                patch({
                  sorts: sorts.map((item, i) =>
                    i === index
                      ? {
                          ...item,
                          direction: event.target.value as 'asc' | 'desc',
                        }
                      : item,
                  ),
                })
              }
            >
              <option value="asc">{t('Ascending', '升序')}</option>
              <option value="desc">{t('Descending', '降序')}</option>
            </select>
            <button
              type="button"
              className="database-query-remove"
              aria-label={t('Remove sort rule', '移除排序规则')}
              onClick={() =>
                patch({ sorts: sorts.filter((_, i) => i !== index) })
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="database-query-actions">
        {onAddSort ? (
          <button
            type="button"
            className="database-setting-row"
            disabled={!availableProperties.length}
            onClick={onAddSort}
          >
            <Plus size={15} />
            {t('Add sort', '添加排序')}
          </button>
        ) : (
          <DatabaseQueryPropertyPicker
            properties={availableProperties}
            label={t('Add sort', '添加排序')}
            onSelect={(property) =>
              patch({
                sorts: [
                  ...sorts,
                  { propertyId: property.id, direction: 'asc' },
                ],
              })
            }
          />
        )}
        {!!sorts.length && (
          <button
            type="button"
            className="database-setting-row"
            onClick={() => patch({ sorts: [] })}
          >
            <Trash2 size={15} />
            {t('Clear sorting', '清除排序')}
          </button>
        )}
      </div>
    </div>
  );
}

const initialFilterValue = (
  property: DatabaseProperty,
  operator: DatabaseFilterOperator,
) =>
  ['empty', 'notEmpty'].includes(operator)
    ? undefined
    : operator === 'relative'
      ? 'today'
      : property.type === 'checkbox'
        ? true
        : undefined;

export function DatabaseFilterChoices({
  property,
  value,
  onChange,
}: {
  property: DatabaseProperty;
  value: DatabaseFilterRule['value'];
  onChange: (value: DatabaseFilterRule['value']) => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState('');
  const selected = Array.isArray(value)
    ? value
    : typeof value === 'string' && value
      ? [value]
      : [];
  const options = (property.options || []).filter((option) =>
    option.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <div className="database-filter-choices">
      <input
        type="search"
        aria-label={t('Search filter options', '搜索筛选选项')}
        placeholder={t('Search or select options…', '搜索或选择选项…')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <fieldset
        className="database-filter-option-list"
        aria-label={t('Filter options', '筛选选项')}
      >
        {options.map((option) => (
          <label className="database-filter-option" key={option.id}>
            <input
              type="checkbox"
              checked={selected.includes(option.id)}
              onChange={() => {
                const next = selected.includes(option.id)
                  ? selected.filter((id) => id !== option.id)
                  : [...selected, option.id];
                onChange(next.length > 1 ? next : next[0]);
              }}
            />
            <span className="database-value-status" data-color={option.color}>
              {property.type === 'status' && <i />}
              {option.name}
            </span>
          </label>
        ))}
        {!options.length && (
          <p className="database-query-property-empty">
            {t('No matching options', '没有匹配的选项')}
          </p>
        )}
      </fieldset>
    </div>
  );
}

const filterDate = (value: DatabaseFilterRule['value']) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00`)
    : undefined;
const filterDateText = (date?: Date) =>
  date
    ? `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    : undefined;

export function DatabaseFilterRuleEditor({
  node,
  properties,
  onChange,
  onRemove,
  prefix,
  compact = false,
}: {
  node: DatabaseFilterRule;
  properties: DatabaseProperty[];
  onChange: (rule: DatabaseFilterRule) => void;
  onRemove?: () => void;
  prefix?: ReactNode;
  compact?: boolean;
}) {
  const { t, language } = useI18n();
  const checkboxGroup = useId();
  const [calendarMonth, setCalendarMonth] = useState(
    () => filterDate(node.value) || new Date(),
  );
  const property =
    properties.find((property) => property.id === node.propertyId) ||
    properties[0];
  const isDate = ['date', 'createdAt', 'updatedAt'].includes(property.type);
  const isChoice = ['select', 'multiSelect', 'status'].includes(property.type);
  const labels: Record<DatabaseFilterOperator, string> = {
    eq: t('Is', '等于'),
    neq: t('Is not', '不等于'),
    contains: t('Contains', '包含'),
    notContains: t('Does not contain', '不包含'),
    startsWith: t('Starts with', '开头是'),
    endsWith: t('Ends with', '结尾是'),
    gt: isDate ? t('After', '晚于') : t('Greater than', '大于'),
    gte: isDate ? t('On or after', '不早于') : t('At least', '大于等于'),
    lt: isDate ? t('Before', '早于') : t('Less than', '小于'),
    lte: isDate ? t('On or before', '不晚于') : t('At most', '小于等于'),
    between: t('Between (inclusive)', '介于（含边界）'),
    empty: t('Is empty', '为空'),
    notEmpty: t('Is not empty', '不为空'),
    relative: t('Relative date', '相对日期'),
  };
  const presets = {
    today: t('Today', '今天'),
    thisWeek: t('This week (Mon–Sun)', '本周（周一至周日）'),
    thisMonth: t('This month', '本月'),
    past7Days: t('Past 7 days, including today', '过去 7 天（含今天）'),
    next7Days: t('Next 7 days, including today', '未来 7 天（含今天）'),
  };
  const change = (values: Partial<DatabaseFilterRule>) =>
    onChange({ ...node, ...values });
  const changeOperator = (operator: DatabaseFilterOperator) =>
    change({
      operator,
      value:
        isChoice &&
        ['eq', 'neq'].includes(node.operator) &&
        ['eq', 'neq'].includes(operator)
          ? node.value
          : initialFilterValue(property, operator),
      endValue: undefined,
    });
  const input = (end = false) => {
    const key = end ? 'endValue' : 'value';
    const label = end ? t('End value', '结束值') : t('Filter value', '筛选值');
    const value = node[key];
    if (node.operator === 'relative')
      return (
        <select
          aria-label={label}
          value={String(value ?? 'today')}
          onChange={(event) => change({ value: event.target.value })}
        >
          {databaseRelativeDates.map((preset) => (
            <option key={preset} value={preset}>
              {presets[preset]}
            </option>
          ))}
        </select>
      );
    if (isChoice)
      return (
        <select
          aria-label={label}
          multiple={Array.isArray(value)}
          value={Array.isArray(value) ? value : String(value ?? '')}
          onChange={(event) =>
            change({
              value: Array.isArray(value)
                ? Array.from(
                    event.target.selectedOptions,
                    (option) => option.value,
                  )
                : event.target.value || undefined,
            })
          }
        >
          {!Array.isArray(value) && (
            <option value="">{t('Choose an option…', '选择选项…')}</option>
          )}
          {property.options?.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      );
    if (property.type === 'checkbox')
      return (
        <select
          aria-label={label}
          value={value === false ? 'false' : 'true'}
          onChange={(event) => change({ value: event.target.value === 'true' })}
        >
          <option value="true">{t('Checked', '已勾选')}</option>
          <option value="false">{t('Unchecked', '未勾选')}</option>
        </select>
      );
    const type =
      property.type === 'number'
        ? 'number'
        : ['date', 'createdAt', 'updatedAt'].includes(property.type)
          ? 'date'
          : 'text';
    const update = (input: HTMLInputElement) => {
      if (!input.validity.valid) return;
      if (compact && type === 'date' && input.value)
        setCalendarMonth(filterDate(input.value)!);
      change({
        [key]:
          input.value === ''
            ? undefined
            : type === 'number'
              ? Number(input.value)
              : input.value,
      });
    };
    return (
      <input
        aria-label={label}
        type={type}
        step={type === 'number' ? 'any' : undefined}
        min={type === 'date' ? '0001-01-01' : undefined}
        max={type === 'date' ? '9999-12-31' : undefined}
        placeholder={t('Enter a value…', '输入条件值…')}
        value={
          typeof value === 'boolean' || Array.isArray(value)
            ? ''
            : (value ?? '')
        }
        onChange={(event) => update(event.currentTarget)}
        onInput={(event) => update(event.currentTarget)}
      />
    );
  };
  const warning = node.operator === 'between' &&
    node.value !== undefined &&
    !Array.isArray(node.value) &&
    node.endValue !== undefined &&
    node.value > node.endValue && (
      <output className="database-query-warning">
        {t('The start must not exceed the end.', '起始值不能大于结束值。')}
      </output>
    );
  if (compact) {
    const presence = ['empty', 'notEmpty'].includes(node.operator);
    const operatorLabel = (operator: DatabaseFilterOperator) =>
      isChoice && operator === 'eq'
        ? t('Is', '是')
        : isChoice && operator === 'neq'
          ? t('Is not', '不是')
          : operator === 'between'
            ? t('Between', '介于')
            : labels[operator];
    return (
      <div className="database-quick-filter">
        <header className="database-quick-filter-header">
          <span className="database-quick-filter-name" title={property.name}>
            {property.name}
          </span>
          <label className="database-quick-filter-operator">
            <span aria-hidden="true">{operatorLabel(node.operator)}</span>
            <ChevronDown size={12} aria-hidden="true" />
            <select
              aria-label={t('Filter operator', '筛选运算符')}
              value={node.operator}
              onChange={(event) =>
                changeOperator(event.target.value as DatabaseFilterOperator)
              }
            >
              {databaseFilterOperators(property).map((operator) => (
                <option key={operator} value={operator}>
                  {operatorLabel(operator)}
                </option>
              ))}
            </select>
          </label>
          {onRemove && (
            <button
              type="button"
              className="database-quick-filter-delete"
              aria-label={t('Delete filter', '删除筛选')}
              title={t('Delete filter', '删除筛选')}
              onClick={onRemove}
            >
              <Trash2 size={15} />
            </button>
          )}
        </header>
        {!presence && (
          <div className="database-quick-filter-values">
            {isChoice ? (
              <DatabaseFilterChoices
                key={property.id}
                property={property}
                value={node.value}
                onChange={(value) => change({ value })}
              />
            ) : property.type === 'checkbox' ? (
              <div role="radiogroup" aria-label={t('Filter value', '筛选值')}>
                {[true, false].map((value) => (
                  <label className="database-filter-option" key={String(value)}>
                    <input
                      type="radio"
                      name={checkboxGroup}
                      checked={(node.value ?? true) === value}
                      onChange={() => change({ value })}
                    />
                    <span>
                      {value
                        ? t('Checked', '已勾选')
                        : t('Unchecked', '未勾选')}
                    </span>
                  </label>
                ))}
              </div>
            ) : node.operator === 'relative' ? (
              <div role="radiogroup" aria-label={t('Filter value', '筛选值')}>
                {databaseRelativeDates.map((preset) => (
                  <label className="database-filter-option" key={preset}>
                    <input
                      type="radio"
                      name={checkboxGroup}
                      checked={(node.value ?? 'today') === preset}
                      onChange={() => change({ value: preset })}
                    />
                    <span>{presets[preset]}</span>
                  </label>
                ))}
              </div>
            ) : (
              <>
                <div className="database-quick-filter-inputs">
                  {input()}
                  {node.operator === 'between' && (
                    <>
                      <span aria-hidden="true">–</span>
                      {input(true)}
                    </>
                  )}
                </div>
                {isDate &&
                  (node.operator === 'between' ? (
                    <Calendar
                      className="database-date-calendar"
                      mode="range"
                      locale={language === 'zh' ? zhCN : enUS}
                      month={calendarMonth}
                      onMonthChange={setCalendarMonth}
                      selected={{
                        from: filterDate(node.value),
                        to: filterDate(node.endValue),
                      }}
                      onSelect={(range) =>
                        change({
                          value: filterDateText(range?.from),
                          endValue: filterDateText(range?.to),
                        })
                      }
                    />
                  ) : (
                    <Calendar
                      className="database-date-calendar"
                      mode="single"
                      locale={language === 'zh' ? zhCN : enUS}
                      month={calendarMonth}
                      onMonthChange={setCalendarMonth}
                      selected={filterDate(node.value)}
                      onSelect={(date) =>
                        change({ value: filterDateText(date) })
                      }
                    />
                  ))}
              </>
            )}
          </div>
        )}
        {warning}
      </div>
    );
  }
  return (
    <div className="database-filter-row">
      <div className="database-filter-prefix">{prefix}</div>
      <select
        className="database-filter-property"
        aria-label={t('Filter property', '筛选字段')}
        value={node.propertyId}
        onChange={(event) => {
          const property = properties.find(
            (property) => property.id === event.target.value,
          )!;
          const operator = databaseFilterOperators(property)[0];
          onChange({
            id: node.id,
            propertyId: property.id,
            operator,
            value: initialFilterValue(property, operator),
          });
        }}
      >
        {properties.map((property) => (
          <option key={property.id} value={property.id}>
            {property.name}
          </option>
        ))}
      </select>
      <select
        className="database-filter-operator"
        aria-label={t('Filter operator', '筛选运算符')}
        value={node.operator}
        onChange={(event) => {
          const operator = event.target.value as DatabaseFilterOperator;
          changeOperator(operator);
        }}
      >
        {databaseFilterOperators(property).map((operator) => (
          <option key={operator} value={operator}>
            {labels[operator]}
          </option>
        ))}
      </select>
      <div className="database-filter-values">
        {!['empty', 'notEmpty'].includes(node.operator) && input()}
        {node.operator === 'between' && (
          <>
            <span aria-hidden="true">–</span>
            {input(true)}
          </>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          className="database-query-remove"
          aria-label={t('Remove condition', '删除条件')}
          onClick={onRemove}
        >
          <X size={15} />
        </button>
      )}
      {warning}
    </div>
  );
}

export function DatabaseFilterSettings({
  database,
  view,
  patch,
  depthOffset = 0,
  limitRoot,
}: {
  database: WorkspaceDatabase;
  view: DatabaseView;
  patch: Patch;
  depthOffset?: number;
  limitRoot?: DatabaseFilterGroup;
}) {
  const { t } = useI18n();
  const emptyGroupId = useId();
  const root: DatabaseFilterGroup = view.filter ?? {
    id: emptyGroupId,
    conjunction: 'and',
    rules: [],
  };
  const properties: DatabaseProperty[] = [
    { id: 'title', name: t('Name', '名称'), type: 'text' },
    ...database.properties,
  ];
  const save = (group: DatabaseFilterGroup) => patch({ filter: group });
  const newRule = (property: DatabaseProperty): DatabaseFilterRule => {
    const operator = databaseFilterOperators(property)[0];
    return {
      id: crypto.randomUUID(),
      propertyId: property.id,
      operator,
      value: initialFilterValue(property, operator),
    };
  };
  const ruleCount = databaseFilterCount(limitRoot ?? root);
  const nodeCount = databaseFilterNodeCount(limitRoot ?? root);
  const renderGroup = (
    group: DatabaseFilterGroup,
    onChange: (next: DatabaseFilterGroup) => void,
    depth: number,
    parentPrefix?: ReactNode,
    onRemove?: () => void,
  ) => {
    const replace = (
      index: number,
      rule: DatabaseFilterRule | DatabaseFilterGroup,
    ) =>
      onChange({
        ...group,
        rules: group.rules.map((item, i) => (i === index ? rule : item)),
      });
    const remove = (index: number) =>
      onChange({
        ...group,
        rules: group.rules.filter((_, i) => i !== index),
      });
    const prefix = (index: number) =>
      index === 0 ? (
        t('Where', '当')
      ) : index === 1 ? (
        <select
          className="database-filter-conjunction"
          aria-label={t('Condition combination', '条件组合')}
          value={group.conjunction}
          onChange={(event) =>
            onChange({
              ...group,
              conjunction: event.target.value as 'and' | 'or',
            })
          }
        >
          <option value="and">{t('And', '与')}</option>
          <option value="or">{t('Or', '或')}</option>
        </select>
      ) : group.conjunction === 'and' ? (
        t('And', '与')
      ) : (
        t('Or', '或')
      );
    return (
      <div className="database-filter-group" data-depth={depth}>
        {depth > 0 && (
          <div className="database-filter-group-controls">
            <div className="database-filter-prefix">{parentPrefix}</div>
            <span>{t('Condition group', '条件组')}</span>
            <select
              aria-label={t('Group condition combination', '组内条件组合')}
              value={group.conjunction}
              onChange={(event) =>
                onChange({
                  ...group,
                  conjunction: event.target.value as 'and' | 'or',
                })
              }
            >
              <option value="and">{t('All (AND)', '全部满足（与）')}</option>
              <option value="or">{t('Any (OR)', '任一满足（或）')}</option>
            </select>
            {onRemove && (
              <button
                type="button"
                className="database-query-remove"
                aria-label={t('Remove condition group', '删除条件组')}
                onClick={onRemove}
              >
                <X size={15} />
              </button>
            )}
          </div>
        )}
        <div className="database-filter-rules">
          {group.rules.map((node, index) =>
            'rules' in node ? (
              <div className="database-filter-nested-node" key={node.id}>
                {renderGroup(
                  node,
                  (next) => replace(index, next),
                  depth + 1,
                  prefix(index),
                  () => remove(index),
                )}
              </div>
            ) : (
              <DatabaseFilterRuleEditor
                key={node.id}
                node={node}
                properties={properties}
                prefix={prefix(index)}
                onChange={(next) => replace(index, next)}
                onRemove={() => remove(index)}
              />
            ),
          )}
        </div>
        <div className="database-query-actions">
          <DatabaseQueryPropertyPicker
            properties={properties}
            label={t('Add condition', '添加条件')}
            disabled={ruleCount >= 40 || nodeCount >= 99}
            onSelect={(property) =>
              onChange({
                ...group,
                rules: [...group.rules, newRule(property)],
              })
            }
          />
          {depth < 2 && (
            <DatabaseQueryPropertyPicker
              properties={properties}
              label={t('Add condition group', '添加条件组')}
              disabled={ruleCount >= 40 || nodeCount > 97}
              onSelect={(property) =>
                onChange({
                  ...group,
                  rules: [
                    ...group.rules,
                    {
                      id: crypto.randomUUID(),
                      conjunction: group.conjunction === 'and' ? 'or' : 'and',
                      rules: [newRule(property)],
                    },
                  ],
                })
              }
            />
          )}
        </div>
      </div>
    );
  };
  return (
    <div className="database-query-settings database-query-editor">
      {renderGroup(root, save, depthOffset)}
      {!!root.rules.length && (
        <button
          type="button"
          className="database-setting-row database-query-clear"
          onClick={() => patch({ filter: undefined })}
        >
          <Trash2 size={15} />
          {t('Clear filters', '清除筛选')}
        </button>
      )}
    </div>
  );
}
