import {
  matchesDatabaseFilter,
  compareDatabaseRecords,
  pruneDatabaseFilter,
  validDatabaseFilter,
} from './database-query.ts';
// Database records are deliberately separate from knowledge cards and AI extraction.
export const databasePropertyTypes = [
  'text',
  'number',
  'select',
  'multiSelect',
  'status',
  'date',
  'checkbox',
  'createdAt',
  'updatedAt',
  'files',
] as const;
export type DatabasePropertyType = (typeof databasePropertyTypes)[number];
export const databaseColors = [
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type DatabaseColor = (typeof databaseColors)[number];
export type DatabaseOption = {
  id: string;
  name: string;
  color: DatabaseColor;
  group?: 'todo' | 'progress' | 'done';
};
export type DatabaseFile = {
  url: string;
  name: string;
  type: string;
  size: number;
};
export type DatabaseValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | DatabaseFile[];
export type DatabaseProperty = {
  id: string;
  name: string;
  type: DatabasePropertyType;
  options?: DatabaseOption[];
  checkboxLabel?: string;
  numberFormat?: 'number' | 'commas' | 'percent' | 'usd' | 'cny';
  dateFormat?: 'local' | 'iso';
  includeTime?: boolean;
  defaultValue?: DatabaseValue;
};
export type DatabaseRecord = {
  id: string;
  title: string;
  values: Record<string, DatabaseValue>;
  createdAt: string;
  updatedAt: string;
};
export type DatabaseSort = { propertyId: string; direction: 'asc' | 'desc' };
export type DatabaseFilterOperator =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'empty'
  | 'notEmpty'
  | 'relative';
export type DatabaseFilterRule = {
  id: string;
  propertyId: string;
  operator: DatabaseFilterOperator;
  value?: string | number | boolean | string[];
  endValue?: string | number;
};
export type DatabaseFilterGroup = {
  id: string;
  conjunction: 'and' | 'or';
  rules: (DatabaseFilterRule | DatabaseFilterGroup)[];
};
export type DatabaseViewType = 'table' | 'list' | 'gallery' | 'board';
export type DatabaseCardPreview =
  | { type: 'none' }
  | { type: 'media'; propertyId: string };
export type DatabaseViewConfig = {
  type: DatabaseViewType;
  sort?: DatabaseSort;
  sorts?: DatabaseSort[];
  filter?: DatabaseFilterGroup;
  groupBy?: string | null;
  visiblePropertyIds?: string[];
  cardPreview?: DatabaseCardPreview;
  fitMedia?: boolean;
};
export type DatabaseView = DatabaseViewConfig & { id: string; name: string };
export const databaseViewTypes: readonly DatabaseViewType[] = [
  'table',
  'list',
  'gallery',
  'board',
];
export type WorkspaceDatabase = {
  id: string;
  title: string;
  properties: DatabaseProperty[];
  records: DatabaseRecord[];
  createdAt: string;
  updatedAt: string;
  pinnedAt?: number;
  // The active snapshot remains compatible with existing workspaces and backups.
  view: DatabaseViewConfig;
  views?: DatabaseView[];
  activeViewId?: string;
};

export function databaseViewName(type: DatabaseViewType, language = 'en') {
  return (
    language.startsWith('zh')
      ? { table: '表格', board: '看板', list: '列表', gallery: '画廊' }
      : { table: 'Table', board: 'Board', list: 'List', gallery: 'Gallery' }
  )[type];
}

// Legacy IDs are deterministic: reading a workspace never changes its data.
export function databaseViews(
  database: WorkspaceDatabase,
  language = 'en',
): DatabaseView[] {
  if (database.views?.length)
    return database.views.map((view) =>
      view.id === database.activeViewId
        ? { id: view.id, name: view.name, ...database.view }
        : view,
    );
  const types: DatabaseViewType[] = ['table', 'board'];
  if (!types.includes(database.view.type)) types.push(database.view.type);
  return types.map((type) => ({
    ...database.view,
    type,
    // Before saved views, grouping applied only to boards.
    groupBy: type === 'board' ? database.view.groupBy : null,
    visiblePropertyIds:
      database.view.visiblePropertyIds ??
      (type === 'list'
        ? database.properties.slice(0, 3).map((property) => property.id)
        : undefined),
    id: `${database.id}-view-${type}`,
    name: databaseViewName(type, language),
  }));
}
export function activeDatabaseView(
  database: WorkspaceDatabase,
  language = 'en',
): DatabaseView {
  const views = databaseViews(database, language);
  return (
    views.find((view) => view.id === database.activeViewId) ||
    views.find((view) => view.type === database.view.type) ||
    views[0]
  );
}
function storeDatabaseViews(
  database: WorkspaceDatabase,
  views: DatabaseView[],
  activeId: string,
): WorkspaceDatabase {
  const active = views.find((view) => view.id === activeId) || views[0];
  const { id, name: _name, ...view } = active;
  return { ...database, views, activeViewId: id, view };
}
export function selectDatabaseView(
  database: WorkspaceDatabase,
  id: string,
  language = 'en',
): WorkspaceDatabase {
  const views = databaseViews(database, language);
  if (!views.some((view) => view.id === id)) return database;
  return storeDatabaseViews(database, views, id);
}
export function updateDatabaseView(
  database: WorkspaceDatabase,
  id: string,
  patch: Partial<Omit<DatabaseView, 'id'>>,
  language = 'en',
): WorkspaceDatabase {
  const views = databaseViews(database, language);
  if (
    !views.some((view) => view.id === id) ||
    (patch.name !== undefined && !patch.name.trim())
  )
    return database;
  const cleanPatch = {
    ...patch,
    ...(Object.hasOwn(patch, 'sorts')
      ? { sort: patch.sorts?.[0] }
      : Object.hasOwn(patch, 'sort')
        ? { sorts: patch.sort ? [patch.sort] : [] }
        : {}),
    ...(patch.name !== undefined
      ? { name: patch.name.trim().slice(0, 80) }
      : {}),
  };
  return storeDatabaseViews(
    database,
    views.map((view) => (view.id === id ? { ...view, ...cleanPatch } : view)),
    activeDatabaseView(database, language).id,
  );
}
export function updateActiveDatabaseView(
  database: WorkspaceDatabase,
  patch: Partial<DatabaseViewConfig>,
  language = 'en',
) {
  return updateDatabaseView(
    database,
    activeDatabaseView(database, language).id,
    patch,
    language,
  );
}
export function addDatabaseView(
  database: WorkspaceDatabase,
  type: DatabaseViewType,
  language = 'en',
  sourceId?: string,
  idFactory: () => string = () => crypto.randomUUID(),
): WorkspaceDatabase {
  const views = databaseViews(database, language);
  const source = views.find((view) => view.id === sourceId);
  const base = source
    ? `${source.name} ${language.startsWith('zh') ? '副本' : 'copy'}`
    : databaseViewName(type, language);
  let name = base,
    number = 2;
  while (views.some((view) => view.name === name)) name = `${base} ${number++}`;
  const view: DatabaseView = {
    ...(source
      ? structuredClone(source)
      : { type, groupBy: type === 'board' ? undefined : null }),
    id: idFactory(),
    name,
  };
  return storeDatabaseViews(database, [...views, view], view.id);
}
export function removeDatabaseView(
  database: WorkspaceDatabase,
  id: string,
  language = 'en',
): WorkspaceDatabase {
  const views = databaseViews(database, language);
  const index = views.findIndex((view) => view.id === id);
  if (views.length === 1 || index === -1) return database;
  const remaining = views.filter((view) => view.id !== id);
  const activeId = activeDatabaseView(database, language).id;
  return storeDatabaseViews(
    database,
    remaining,
    activeId === id ? remaining[Math.max(0, index - 1)].id : activeId,
  );
}
export const isChoiceProperty = (property: DatabaseProperty) =>
  ['select', 'multiSelect', 'status'].includes(property.type);
export const isSystemProperty = (property: DatabaseProperty) =>
  property.type === 'createdAt' || property.type === 'updatedAt';
export const isGroupProperty = (property: DatabaseProperty) =>
  property.type === 'select' || property.type === 'status';
const primitiveText = (value: unknown) =>
  typeof value === 'string' ||
  typeof value === 'number' ||
  typeof value === 'boolean'
    ? String(value)
    : '';
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
const empty = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && !value.length);
export function defaultStatusOptions(zh = false): DatabaseOption[] {
  return [
    {
      id: 'todo',
      name: zh ? '未开始' : 'Not started',
      color: 'gray',
      group: 'todo',
    },
    {
      id: 'progress',
      name: zh ? '进行中' : 'In progress',
      color: 'blue',
      group: 'progress',
    },
    { id: 'done', name: zh ? '已完成' : 'Done', color: 'green', group: 'done' },
  ];
}
export function createDatabase(
  title: string,
  language = 'en',
  now = new Date().toISOString(),
): WorkspaceDatabase {
  const zh = language.startsWith('zh');
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    properties: [
      {
        id: 'status',
        name: zh ? '状态' : 'Status',
        type: 'status',
        options: defaultStatusOptions(zh),
      },
      { id: 'date', name: zh ? '日期' : 'Date', type: 'date' },
    ],
    records: [],
    view: { type: 'table' },
  };
}
export function newDatabaseRecord(
  database: WorkspaceDatabase,
  now = new Date().toISOString(),
): DatabaseRecord {
  const values: Record<string, DatabaseValue> = {};
  for (const property of database.properties) {
    if (isSystemProperty(property)) continue;
    if (property.defaultValue !== undefined) {
      if (validDatabaseDefaultValue(property.defaultValue, property))
        values[property.id] = structuredClone(property.defaultValue);
    } else if (
      property.type === 'status' ||
      (property.id === 'status' && property.type === 'select')
    ) {
      const option =
        property.options?.find((option) => option.group === 'todo') ||
        property.options?.[0];
      if (option) values[property.id] = option.id;
    }
  }
  return {
    id: crypto.randomUUID(),
    title: '',
    values,
    createdAt: now,
    updatedAt: now,
  };
}
export function databaseValue(
  record: DatabaseRecord,
  property: DatabaseProperty,
): DatabaseValue | undefined {
  return property.type === 'createdAt'
    ? record.createdAt
    : property.type === 'updatedAt'
      ? record.updatedAt
      : record.values[property.id];
}
export function databaseValueText(
  record: DatabaseRecord,
  property: DatabaseProperty,
  locale?: string,
): string {
  const value = databaseValue(record, property);
  if (empty(value)) return '';
  if (isChoiceProperty(property)) {
    const ids = Array.isArray(value) ? value : [value];
    return (
      property.options
        ?.filter((option) => ids.includes(option.id as never))
        .map((option) => option.name)
        .join(', ') || ''
    );
  }
  if (property.type === 'files')
    return (value as DatabaseFile[]).map((file) => file.name).join(', ');
  if (property.type === 'number' && typeof value === 'number') {
    const format = property.numberFormat;
    if (!format || format === 'number') return primitiveText(value);
    return new Intl.NumberFormat(
      locale,
      format === 'percent'
        ? { style: 'percent', maximumFractionDigits: 4 }
        : format === 'usd' || format === 'cny'
          ? { style: 'currency', currency: format.toUpperCase() }
          : { maximumFractionDigits: 10 },
    ).format(value);
  }
  if (
    (property.type === 'date' || isSystemProperty(property)) &&
    typeof value === 'string'
  ) {
    const dateOnly = value.slice(0, 10);
    const date = new Date(value.length === 10 ? value + 'T00:00:00' : value);
    if (!Number.isFinite(date.getTime())) return value;
    const showTime = property.includeTime ?? isSystemProperty(property);
    if (property.dateFormat === 'iso')
      return isSystemProperty(property)
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}${showTime ? ' ' + date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false }) : ''}`
        : dateOnly +
            (showTime && value.length > 10 ? ' ' + value.slice(11, 16) : '');
    return showTime && value.length > 10
      ? date.toLocaleString(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : date.toLocaleDateString(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        });
  }
  if (property.type === 'checkbox')
    return value ? property.checkboxLabel || property.name : '';
  return primitiveText(value);
}
export function patchDatabaseRecord(
  database: WorkspaceDatabase,
  id: string,
  patch: Pick<Partial<DatabaseRecord>, 'title' | 'values'>,
  now = new Date().toISOString(),
): WorkspaceDatabase {
  if (
    patch.values &&
    Object.entries(patch.values).some(([id, value]) => {
      const property = database.properties.find(
        (property) => property.id === id,
      );
      return (
        !property ||
        isSystemProperty(property) ||
        !validDatabaseValue(value, property)
      );
    })
  )
    return database;
  let changed = false;
  const records = database.records.map((record) => {
    if (record.id !== id) return record;
    const values = patch.values
      ? { ...record.values, ...patch.values }
      : record.values;
    const title = patch.title ?? record.title;
    if (title === record.title && equal(values, record.values)) return record;
    changed = true;
    return { ...record, title, values, updatedAt: now };
  });
  return changed ? { ...database, records, updatedAt: now } : database;
}
export function duplicateDatabase(
  source: WorkspaceDatabase,
  title: string,
  now = new Date().toISOString(),
): WorkspaceDatabase {
  const copy = structuredClone(source);
  delete copy.pinnedAt;
  if (copy.views) {
    const activeId = copy.activeViewId;
    copy.views = databaseViews(copy).map((view) => {
      const id = crypto.randomUUID();
      if (view.id === activeId) copy.activeViewId = id;
      return { ...view, id };
    });
  }
  return {
    ...copy,
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    records: copy.records.map((record) => ({
      ...record,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    })),
  };
}
export function databaseSorts(view: DatabaseViewConfig): DatabaseSort[] {
  return view.sorts ?? (view.sort ? [view.sort] : []);
}
export function databaseRecords(
  database: WorkspaceDatabase,
  query = '',
  now = new Date(),
) {
  const needle = query.trim().toLocaleLowerCase();
  const records = database.records.filter(
    (record) =>
      matchesDatabaseFilter(
        record,
        database.properties,
        database.view.filter,
        now,
      ) &&
      (!needle ||
        [
          record.title,
          ...database.properties.map((property) =>
            databaseValueText(record, property),
          ),
        ].some((value) => value.toLocaleLowerCase().includes(needle))),
  );
  return records.sort((a, b) =>
    compareDatabaseRecords(
      a,
      b,
      database.properties,
      databaseSorts(database.view),
    ),
  );
}
export function switchDatabaseView(
  database: WorkspaceDatabase,
  type: DatabaseViewType,
): WorkspaceDatabase {
  return database.view.type === type
    ? database
    : { ...database, view: { ...database.view, type } };
}
export function databaseBoardGroups(
  database: WorkspaceDatabase,
  records = databaseRecords(database),
) {
  const property =
    database.view.groupBy === null
      ? undefined
      : database.properties.find(
          (property) =>
            isGroupProperty(property) &&
            (database.view.groupBy === undefined ||
              property.id === database.view.groupBy),
        );
  const options = property?.options ?? [];
  const groups = options.map((option) => ({
    key: option.id,
    name: option.name,
    color: option.color,
    items: records.filter(
      (record) => record.values[property!.id] === option.id,
    ),
    count: 0,
    sortValue: option.name,
  }));
  const ungrouped = records.filter(
    (record) =>
      !property ||
      !options.some((option) => option.id === record.values[property.id]),
  );
  return {
    property,
    groups: [
      ...groups,
      {
        key: '',
        name: '',
        color: 'gray' as const,
        items: ungrouped,
        count: 0,
        sortValue: '',
      },
    ].map((group) => ({ ...group, count: group.items.length })),
  };
}
export function moveDatabaseRecord(
  database: WorkspaceDatabase,
  recordId: string,
  groupId: string,
  now = new Date().toISOString(),
) {
  const { property } = databaseBoardGroups(database, []);
  if (
    !property ||
    (groupId !== '' &&
      !property.options?.some((option) => option.id === groupId))
  )
    return database;
  return patchDatabaseRecord(
    database,
    recordId,
    { values: { [property.id]: groupId } },
    now,
  );
}

// Preview conversions before applying them. Unsupported conversions retain all data.
export function convertDatabaseProperty(
  database: WorkspaceDatabase,
  property: DatabaseProperty,
  now = new Date().toISOString(),
): { database: WorkspaceDatabase; cleared: number; incompatible: number } {
  const previous = database.properties.find((item) => item.id === property.id);
  const next = structuredClone(property);
  let cleared = 0,
    incompatible = 0;
  if (isChoiceProperty(next)) next.options ??= [];
  else delete next.options;
  const convertValue = (
    oldValue: DatabaseValue | undefined,
    record: DatabaseRecord,
    countRecord: boolean,
  ) => {
    let value = oldValue;
    let incompatibleValue = false;
    const markIncompatible = () => {
      incompatibleValue = true;
      if (countRecord) incompatible++;
    };
    if (!previous) return { value, incompatible: false };
    if (isSystemProperty(next)) {
      if (
        previous.type !== next.type &&
        !isSystemProperty(previous) &&
        !empty(oldValue)
      )
        markIncompatible();
      value = undefined;
    } else if (empty(oldValue))
      value =
        previous.type === next.type || oldValue === undefined
          ? oldValue
          : next.type === 'multiSelect' || next.type === 'files'
            ? []
            : null;
    else if (isChoiceProperty(next) && isChoiceProperty(previous)) {
      const ids = (Array.isArray(oldValue) ? oldValue : [oldValue]) as string[];
      const kept = ids.filter((id) =>
        next.options!.some((option) => option.id === id),
      );
      if (kept.length < ids.length && countRecord) cleared++;
      if (next.type !== 'multiSelect' && kept.length > 1) markIncompatible();
      value = next.type === 'multiSelect' ? kept : kept[0] || '';
    } else if (previous.type !== next.type) {
      if (next.type === 'text' && previous.type !== 'files')
        value =
          previous.type === 'checkbox'
            ? primitiveText(oldValue)
            : databaseValueText(record, {
                ...previous,
                numberFormat: 'number',
              });
      else if (isChoiceProperty(next) && previous.type === 'text') {
        const name = primitiveText(oldValue);
        let option = next.options!.find((option) => option.name === name);
        if (!option) {
          option = {
            id: crypto.randomUUID(),
            name,
            color: 'gray',
            ...(next.type === 'status' ? { group: 'todo' as const } : {}),
          };
          next.options!.push(option);
        }
        value = next.type === 'multiSelect' ? [option.id] : option.id;
      } else if (
        next.type === 'number' &&
        previous.type === 'text' &&
        primitiveText(oldValue).trim() !== '' &&
        Number.isFinite(Number(oldValue))
      )
        value = Number(oldValue);
      else if (
        next.type === 'checkbox' &&
        previous.type === 'text' &&
        ['true', 'false'].includes(primitiveText(oldValue))
      )
        value = oldValue === 'true';
      else if (
        next.type === 'date' &&
        previous.type === 'text' &&
        validDatabaseValue(oldValue, next)
      )
        value = oldValue;
      else markIncompatible();
    }
    return { value, incompatible: incompatibleValue };
  };
  const records = database.records.map((record) => {
    if (!previous) return record;
    const { value } = convertValue(
      databaseValue(record, previous),
      record,
      true,
    );
    const values = { ...record.values };
    if (value === undefined) delete values[next.id];
    else values[next.id] = value;
    return equal(values, record.values)
      ? record
      : { ...record, values, updatedAt: now };
  });
  if (isSystemProperty(next)) delete next.defaultValue;
  else if (next.defaultValue !== undefined) {
    // A carried default follows the same conversion as cells, without changing
    // existing records or including the default in affected-record counts.
    if (
      previous?.defaultValue !== undefined &&
      equal(next.defaultValue, previous.defaultValue)
    ) {
      const record: DatabaseRecord = {
        id: '',
        title: '',
        values: { [next.id]: next.defaultValue },
        createdAt: now,
        updatedAt: now,
      };
      const converted = convertValue(next.defaultValue, record, false);
      next.defaultValue = converted.incompatible
        ? null
        : (converted.value ?? null);
    }
    // Explicit empty defaults stay explicit, so a removed status option cannot
    // accidentally re-enable the legacy first-todo default.
    if (!validDatabaseDefaultValue(next.defaultValue, next))
      next.defaultValue = null;
  }
  const properties = previous
    ? database.properties.map((item) => (item.id === next.id ? next : item))
    : [...database.properties, next];
  const cleanView = (config: DatabaseViewConfig): DatabaseViewConfig => ({
    ...config,
    cardPreview:
      config.cardPreview?.type === 'media' &&
      config.cardPreview.propertyId === next.id &&
      next.type !== 'files'
        ? { type: 'none' }
        : config.cardPreview,
    filter: pruneDatabaseFilter(
      config.filter,
      (rule) =>
        rule.propertyId !== next.id ||
        ((!previous || previous.type === next.type) &&
          (!isChoiceProperty(next) ||
            rule.value === undefined ||
            ['empty', 'notEmpty'].includes(rule.operator) ||
            (Array.isArray(rule.value)
              ? !rule.value.length ||
                rule.value.some((id) =>
                  next.options!.some((option) => option.id === id),
                )
              : next.options!.some((option) => option.id === rule.value)))),
      (rule) =>
        rule.propertyId === next.id &&
        isChoiceProperty(next) &&
        Array.isArray(rule.value)
          ? {
              ...rule,
              value: rule.value.filter((id) =>
                next.options!.some((option) => option.id === id),
              ),
            }
          : rule,
    ),
  });
  const view = cleanView(
    database.view.groupBy === next.id && !isGroupProperty(next)
      ? { ...database.view, groupBy: undefined }
      : database.view,
  );
  const views = database.views?.map((item) => ({
    ...item,
    ...cleanView(
      item.groupBy === next.id && !isGroupProperty(next)
        ? { ...item, groupBy: undefined }
        : item,
    ),
  }));
  const result = {
    ...database,
    properties,
    records,
    view,
    ...(views ? { views } : {}),
    updatedAt: now,
  };
  return { database: incompatible ? database : result, cleared, incompatible };
}
export function removeDatabaseProperty(
  database: WorkspaceDatabase,
  id: string,
  now = new Date().toISOString(),
): WorkspaceDatabase {
  return {
    ...database,
    updatedAt: now,
    properties: database.properties.filter((property) => property.id !== id),
    records: database.records.map((record) => {
      const { [id]: removed, ...values } = record.values;
      return removed === undefined
        ? record
        : { ...record, values, updatedAt: now };
    }),
    view: {
      ...database.view,
      cardPreview:
        database.view.cardPreview?.type === 'media' &&
        database.view.cardPreview.propertyId === id
          ? { type: 'none' }
          : database.view.cardPreview,
      sort: database.view.sorts
        ? database.view.sorts.find((sort) => sort.propertyId !== id)
        : database.view.sort?.propertyId === id
          ? undefined
          : database.view.sort,
      sorts: database.view.sorts?.filter((sort) => sort.propertyId !== id),
      filter: pruneDatabaseFilter(
        database.view.filter,
        (rule) => rule.propertyId !== id,
      ),
      groupBy: database.view.groupBy === id ? undefined : database.view.groupBy,
      visiblePropertyIds: database.view.visiblePropertyIds?.filter(
        (key) => key !== id,
      ),
    },
    ...(database.views
      ? {
          views: database.views.map((view) => ({
            ...view,
            cardPreview:
              view.cardPreview?.type === 'media' &&
              view.cardPreview.propertyId === id
                ? { type: 'none' }
                : view.cardPreview,
            sort: view.sorts
              ? view.sorts.find((sort) => sort.propertyId !== id)
              : view.sort?.propertyId === id
                ? undefined
                : view.sort,
            sorts: view.sorts?.filter((sort) => sort.propertyId !== id),
            filter: pruneDatabaseFilter(
              view.filter,
              (rule) => rule.propertyId !== id,
            ),
            groupBy: view.groupBy === id ? undefined : view.groupBy,
            visiblePropertyIds: view.visiblePropertyIds?.filter(
              (key) => key !== id,
            ),
          })),
        }
      : {}),
  };
}
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));
const identity = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  !['__proto__', 'constructor', 'prototype'].includes(value);
const uniqueIds = (items: { id: string }[]) =>
  new Set(items.map((item) => item.id)).size === items.length;
function validProperty(value: unknown): value is DatabaseProperty {
  if (
    !object(value) ||
    !identity(value.id) ||
    value.id === 'title' ||
    typeof value.name !== 'string' ||
    !databasePropertyTypes.includes(value.type as DatabasePropertyType)
  )
    return false;
  if (
    (value.checkboxLabel !== undefined &&
      typeof value.checkboxLabel !== 'string') ||
    (value.numberFormat !== undefined &&
      !['number', 'commas', 'percent', 'usd', 'cny'].includes(
        value.numberFormat as string,
      )) ||
    (value.dateFormat !== undefined &&
      !['local', 'iso'].includes(value.dateFormat as string)) ||
    (value.includeTime !== undefined && typeof value.includeTime !== 'boolean')
  )
    return false;
  const validOptions = !['select', 'multiSelect', 'status'].includes(
    value.type as string,
  )
    ? value.options === undefined
    : Array.isArray(value.options) &&
      value.options.every(
        (option) =>
          object(option) &&
          identity(option.id) &&
          typeof option.name === 'string' &&
          databaseColors.includes(option.color as DatabaseColor) &&
          (option.group === undefined ||
            ['todo', 'progress', 'done'].includes(option.group as string)),
      ) &&
      uniqueIds(value.options);
  return (
    validOptions &&
    (value.defaultValue === undefined ||
      validDatabaseDefaultValue(value.defaultValue, value as DatabaseProperty))
  );
}
export function validDatabaseValue(
  value: unknown,
  property: DatabaseProperty,
): boolean {
  if (value === null) return true;
  if (isSystemProperty(property)) return false; // Computed metadata cannot be overridden by cell values.
  if (property.type === 'number')
    return typeof value === 'number' && Number.isFinite(value);
  if (property.type === 'checkbox') return typeof value === 'boolean';
  if (property.type === 'multiSelect')
    return (
      Array.isArray(value) &&
      value.every(
        (id) =>
          typeof id === 'string' &&
          property.options?.some((option) => option.id === id),
      ) &&
      new Set(value).size === value.length
    );
  if (property.type === 'files')
    return (
      Array.isArray(value) &&
      value.every(
        (file) =>
          object(file) &&
          typeof file.url === 'string' &&
          /^(lumior-file:.+|blob:.+)$/.test(file.url) &&
          typeof file.name === 'string' &&
          !!file.name.trim() &&
          typeof file.type === 'string' &&
          typeof file.size === 'number' &&
          Number.isSafeInteger(file.size) &&
          file.size >= 0,
      )
    );
  if (typeof value !== 'string') return false;
  if (isChoiceProperty(property))
    return (
      value === '' || !!property.options?.some((option) => option.id === value)
    );
  if (property.type === 'date' && value !== '') {
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(value)) return false;
    const date = new Date(value.slice(0, 10) + 'T00:00:00Z');
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value.slice(0, 10) &&
      (value.length === 10 ||
        (Number(value.slice(11, 13)) < 24 && Number(value.slice(14, 16)) < 60))
    );
  }
  return true;
}
export function validDatabaseDefaultValue(
  value: unknown,
  property: DatabaseProperty,
): boolean {
  return !isSystemProperty(property) && validDatabaseValue(value, property);
}
export function validDatabases(value: unknown): value is WorkspaceDatabase[] {
  if (!Array.isArray(value)) return false;
  return (
    value.every((database) => {
      if (
        !object(database) ||
        !identity(database.id) ||
        typeof database.title !== 'string' ||
        !timestamp(database.createdAt) ||
        !timestamp(database.updatedAt) ||
        (database.pinnedAt !== undefined &&
          !(
            typeof database.pinnedAt === 'number' &&
            Number.isSafeInteger(database.pinnedAt) &&
            database.pinnedAt >= 0
          )) ||
        !Array.isArray(database.properties) ||
        !database.properties.every(validProperty) ||
        !uniqueIds(database.properties) ||
        !Array.isArray(database.records) ||
        !object(database.view) ||
        !databaseViewTypes.includes(database.view.type as DatabaseViewType)
      )
        return false;
      const properties = new Map(
        database.properties.map((property) => [property.id, property]),
      );
      const validView = (view: unknown) => {
        if (
          !object(view) ||
          !databaseViewTypes.includes(view.type as DatabaseViewType)
        )
          return false;
        const sort = view.sort,
          group = view.groupBy,
          visible = view.visiblePropertyIds;
        return (
          (view.fitMedia === undefined || typeof view.fitMedia === 'boolean') &&
          (view.cardPreview === undefined ||
            (object(view.cardPreview) &&
              (view.cardPreview.type === 'none' ||
                (view.cardPreview.type === 'media' &&
                  typeof view.cardPreview.propertyId === 'string' &&
                  properties.get(view.cardPreview.propertyId)?.type ===
                    'files')))) &&
          (view.sorts === undefined ||
            (Array.isArray(view.sorts) &&
              view.sorts.length <= properties.size + 1 &&
              view.sorts.every(
                (sort) =>
                  object(sort) &&
                  ['asc', 'desc'].includes(sort.direction as string) &&
                  (sort.propertyId === 'title' ||
                    properties.has(sort.propertyId as string)),
              ) &&
              new Set(view.sorts.map((sort) => sort.propertyId)).size ===
                view.sorts.length)) &&
          (view.filter === undefined ||
            validDatabaseFilter(
              view.filter,
              database.properties as DatabaseProperty[],
            )) &&
          (sort === undefined ||
            (object(sort) &&
              ['asc', 'desc'].includes(sort.direction as string) &&
              (sort.propertyId === 'title' ||
                properties.has(sort.propertyId as string)))) &&
          (group == null ||
            (typeof group === 'string' &&
              properties.has(group) &&
              isGroupProperty(properties.get(group)!))) &&
          (visible === undefined ||
            (Array.isArray(visible) &&
              visible.every(
                (id) => typeof id === 'string' && properties.has(id),
              ) &&
              new Set(visible).size === visible.length))
        );
      };
      if (!validView(database.view)) return false;
      if (
        database.views !== undefined &&
        (!Array.isArray(database.views) ||
          !database.views.length ||
          !database.views.every(
            (view) =>
              object(view) &&
              identity(view.id) &&
              typeof view.name === 'string' &&
              !!view.name.trim() &&
              view.name.length <= 80 &&
              validView(view),
          ) ||
          !uniqueIds(database.views) ||
          !database.views.some((view) => view.id === database.activeViewId))
      )
        return false;
      if (database.activeViewId !== undefined && database.views === undefined)
        return false;
      return (
        database.records.every(
          (record) =>
            object(record) &&
            identity(record.id) &&
            typeof record.title === 'string' &&
            timestamp(record.createdAt) &&
            timestamp(record.updatedAt) &&
            object(record.values) &&
            Object.entries(record.values).every(
              ([key, entry]) =>
                properties.has(key) &&
                validDatabaseValue(entry, properties.get(key)!),
            ),
        ) && uniqueIds(database.records)
      );
    }) && uniqueIds(value)
  );
}
