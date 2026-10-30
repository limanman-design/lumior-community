'use client';
import { useId, useState, type ReactNode } from 'react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useI18n } from './i18n';
import {
  databaseSorts,
  type DatabaseProperty,
  type DatabaseView,
  type WorkspaceDatabase,
} from './database-model';
import {
  databaseActiveFilterCount,
  databaseFilterCount,
} from './database-query';
import { MaterialIcon } from './material-icon';
import {
  DatabaseFilterRuleEditor,
  DatabaseFilterSettings,
  DatabaseQueryPropertyList,
  DatabaseSortSettings,
} from './database-query-settings';
import {
  appendDatabaseAdvancedFilter,
  appendDatabaseQuickFilter,
  databaseFilterChips,
  replaceDatabaseFilterNode,
  type DatabaseFilterChip,
} from './database-query-ui';
import { propertyIcons } from './database-property-editor';

type Panel = {
  anchor: string;
  kind:
    | 'sort-picker'
    | 'sort'
    | 'filter-picker'
    | 'filter-root'
    | 'filter-node';
};

export function useDatabaseQueryToolbar({
  database,
  view,
  patch,
  beforeOpen,
}: {
  database: WorkspaceDatabase;
  view: DatabaseView;
  patch: (values: Partial<DatabaseView>) => void;
  beforeOpen: () => boolean;
}) {
  const { t } = useI18n();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [conditionsCollapsed, setConditionsCollapsed] = useState(false);
  const conditionsId = useId();
  const [previousView, setPreviousView] = useState(view.id);
  if (previousView !== view.id) {
    setPreviousView(view.id);
    setPanel(null);
    setConditionsCollapsed(false);
  }
  const properties: DatabaseProperty[] = [
    { id: 'title', name: t('Name', '名称'), type: 'text' },
    ...database.properties,
  ];
  const sorts = databaseSorts(view);
  const chips = databaseFilterChips(view.filter);
  const advancedChips = chips.filter((chip) => chip.kind === 'group');
  const quickChips = chips.filter((chip) => chip.kind === 'rule');
  const filterCount = databaseActiveFilterCount(view.filter, properties);
  const show = (next: Panel) => {
    if (beforeOpen()) {
      setConditionsCollapsed(false);
      setPanel(next);
    }
  };
  const openSort = () =>
    show({ anchor: 'sort-icon', kind: sorts.length ? 'sort' : 'sort-picker' });
  const openFilter = () =>
    show({
      anchor: 'filter-icon',
      kind: chips.length ? 'filter-root' : 'filter-picker',
    });
  const addSort = (property: DatabaseProperty) => {
    setConditionsCollapsed(false);
    patch({ sorts: [...sorts, { propertyId: property.id, direction: 'asc' }] });
    setPanel({ anchor: 'sort-chip', kind: 'sort' });
  };
  const addFilter = (property: DatabaseProperty) => {
    setConditionsCollapsed(false);
    const filter = appendDatabaseQuickFilter(view.filter, property);
    if (!filter) {
      setPanel({ anchor: 'filter-icon', kind: 'filter-root' });
      return;
    }
    patch({ filter });
    const node = filter.rules.at(-1)!;
    setPanel({ anchor: node.id, kind: 'filter-node' });
  };
  const addAdvanced = () => {
    setConditionsCollapsed(false);
    if (advancedChips.length) {
      setPanel({ anchor: advancedChips[0].node.id, kind: 'filter-node' });
      return;
    }
    const result = appendDatabaseAdvancedFilter(view.filter);
    if (!result) {
      setPanel({ anchor: 'filter-icon', kind: 'filter-root' });
      return;
    }
    patch({ filter: result.filter });
    setPanel({ anchor: result.groupId, kind: 'filter-node' });
  };
  const filterPicker = (
    <DatabaseQueryPropertyList
      properties={properties}
      label={t('Filter by…', '选择筛选字段')}
      onSelect={addFilter}
    >
      <div className="database-query-menu-footer">
        <button
          type="button"
          className="database-setting-row"
          onClick={addAdvanced}
        >
          <MaterialIcon name="add" size={16} />
          {advancedChips.length
            ? t('Edit advanced filter', '编辑高级筛选')
            : t('Add advanced filter', '添加高级筛选')}
        </button>
      </div>
    </DatabaseQueryPropertyList>
  );
  const popup = (
    anchor: string,
    initial: Panel['kind'],
    trigger: ReactNode,
    className: string,
    label: string,
    content: ReactNode,
    kind?: 'sort' | 'filter-rule' | 'filter-group',
    active = true,
  ) => {
    const conditionToggle =
      (anchor === 'sort-icon' && sorts.length > 0) ||
      (anchor === 'filter-icon' && filterCount > 0);
    return (
      <Popover
        key={anchor}
        open={panel?.anchor === anchor}
        onOpenChange={(open) => {
          if (open && conditionToggle) {
            if (beforeOpen()) {
              setPanel(null);
              setConditionsCollapsed((current) => !current);
            }
          } else if (open) show({ anchor, kind: initial });
          else
            setPanel((current) =>
              current?.anchor === anchor ? null : current,
            );
        }}
      >
        <PopoverTrigger
          className={className}
          aria-label={label}
          title={label}
          data-kind={kind}
          data-query-control={
            anchor === 'sort-icon' || anchor === 'filter-icon'
          }
          data-popup-open={panel?.anchor === anchor}
          aria-controls={conditionToggle ? conditionsId : undefined}
          aria-expanded={
            conditionToggle ? !conditionsCollapsed : panel?.anchor === anchor
          }
          data-active={
            anchor === 'sort-icon'
              ? sorts.length > 0
              : anchor === 'filter-icon'
                ? filterCount > 0
                : active
          }
        >
          {trigger}
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={label}
          className={`database-query-popover ${panel?.kind?.endsWith('picker') ? 'database-query-property-picker' : anchor === 'sort-icon' || anchor === 'sort-chip' ? 'database-query-sort-popover' : kind === 'filter-rule' ? 'database-query-quick-popover' : 'database-query-filter-popover'}`}
        >
          {content}
        </PopoverContent>
      </Popover>
    );
  };
  const sortContent =
    panel?.kind === 'sort-picker' ? (
      <DatabaseQueryPropertyList
        properties={properties.filter(
          (property) => !sorts.some((sort) => sort.propertyId === property.id),
        )}
        label={t('Sort by…', '选择排序字段')}
        onSelect={addSort}
      />
    ) : (
      <DatabaseSortSettings database={database} view={view} patch={patch} />
    );
  const rootFilterContent =
    panel?.kind === 'filter-picker' ? (
      filterPicker
    ) : (
      <DatabaseFilterSettings
        database={database}
        view={view}
        patch={(values) => {
          patch(values);
          if (!values.filter) setPanel(null);
        }}
      />
    );
  const buttons = (
    <>
      {popup(
        'filter-icon',
        chips.length ? 'filter-root' : 'filter-picker',
        <MaterialIcon name="filter_list" />,
        'database-tool-button',
        t('Filter records', '筛选记录'),
        rootFilterContent,
      )}
      {popup(
        'sort-icon',
        sorts.length ? 'sort' : 'sort-picker',
        <MaterialIcon name="sort" />,
        'database-tool-button',
        t('Sort records', '排序记录'),
        sortContent,
      )}
    </>
  );
  const firstSort = sorts[0];
  const advancedCount = advancedChips.reduce(
    (count, chip) => count + databaseFilterCount(chip.node),
    0,
  );
  const advancedLabel = t('{count} rules', '{count} 条规则', {
    count: advancedCount,
  });
  const groupEditor = (
    chip: Extract<DatabaseFilterChip, { kind: 'group' }>,
  ) => (
    <DatabaseFilterSettings
      database={database}
      view={{ ...view, filter: chip.node }}
      depthOffset={chip.depth}
      limitRoot={view.filter}
      patch={(values) =>
        patch({
          filter: replaceDatabaseFilterNode(
            view.filter,
            chip.node.id,
            values.filter,
          ),
        })
      }
    />
  );
  const bar =
    !conditionsCollapsed && (sorts.length || chips.length) ? (
      <div
        id={conditionsId}
        className="database-query-bar"
        aria-label={t('View conditions', '视图条件')}
      >
        {!!firstSort &&
          popup(
            'sort-chip',
            'sort',
            <>
              <span
                className="database-sort-direction"
                data-direction={firstSort.direction}
              >
                <MaterialIcon name="straight" size={16} />
              </span>
              <span>
                {properties.find(
                  (property) => property.id === firstSort.propertyId,
                )?.name ?? t('Sort', '排序')}
                {sorts.length > 1
                  ? t(' ({count} sorts)', ' 等 {count} 项', {
                      count: sorts.length,
                    })
                  : ''}
              </span>
              <MaterialIcon name="keyboard_arrow_down" size={16} />
            </>,
            'database-query-chip',
            t('Edit sorting', '编辑排序'),
            sortContent,
            'sort',
          )}
        {!!sorts.length && !!chips.length && (
          <span className="database-query-divider" />
        )}
        {advancedChips.length > 0 &&
          popup(
            advancedChips[0].node.id,
            'filter-node',
            <>
              <MaterialIcon name="filter_list" size={16} />
              <span>{advancedLabel}</span>
              <MaterialIcon name="keyboard_arrow_down" size={16} />
            </>,
            'database-query-chip',
            t('Edit filter: {name}', '编辑筛选：{name}', {
              name: advancedLabel,
            }),
            advancedChips.length === 1 ? (
              groupEditor(advancedChips[0])
            ) : (
              <div className="database-advanced-groups">
                {advancedChips.map((chip, index) => (
                  <section key={chip.node.id}>
                    <h3>
                      {t('Condition group {number}', '条件组 {number}', {
                        number: index + 1,
                      })}
                    </h3>
                    {groupEditor(chip)}
                  </section>
                ))}
              </div>
            ),
            'filter-group',
            advancedChips.some(
              (chip) => databaseActiveFilterCount(chip.node, properties) > 0,
            ),
          )}
        {quickChips.map((chip) => {
          const remove = () => {
            patch({
              filter: replaceDatabaseFilterNode(
                view.filter,
                chip.node.id,
                undefined,
              ),
            });
            setPanel(null);
          };
          const property = properties.find(
            (property) => property.id === chip.node.propertyId,
          );
          const Icon = property
            ? propertyIcons[property.type]
            : propertyIcons.text;
          const label = property?.name ?? t('Filter', '筛选');
          const content = (
            <DatabaseFilterRuleEditor
              node={chip.node}
              properties={properties}
              compact
              onChange={(node) =>
                patch({
                  filter: replaceDatabaseFilterNode(view.filter, node.id, node),
                })
              }
              onRemove={remove}
            />
          );
          return popup(
            chip.node.id,
            'filter-node',
            <>
              <Icon size={16} />
              <span>{label}</span>
              <MaterialIcon name="keyboard_arrow_down" size={16} />
            </>,
            'database-query-chip',
            t('Edit filter: {name}', '编辑筛选：{name}', { name: label }),
            content,
            'filter-rule',
            databaseActiveFilterCount(chip.node, properties) > 0,
          );
        })}
        {popup(
          'filter-add',
          'filter-picker',
          <>
            <MaterialIcon name="add" size={16} />
            <span>{t('Filter', '筛选')}</span>
          </>,
          'database-query-add-filter',
          t('Add filter', '添加筛选'),
          filterPicker,
        )}
      </div>
    ) : null;
  return { buttons, bar, openSort, openFilter };
}
