import type {
  DatabaseFilterGroup,
  DatabaseFilterRule,
  DatabaseFilterOperator,
  DatabaseProperty,
  DatabaseRecord,
  DatabaseSort,
} from './database-model';

const primitive = (
  value: unknown,
): string | number | boolean | null | undefined =>
  value == null || ['string', 'number', 'boolean'].includes(typeof value)
    ? (value as string | number | boolean | null | undefined)
    : '';
const blank = (value: unknown) =>
  value == null || value === '' || (Array.isArray(value) && value.length === 0);
const dateType = (type: string) =>
  ['date', 'createdAt', 'updatedAt'].includes(type);
const choiceType = (type: string) =>
  ['select', 'multiSelect', 'status'].includes(type);
const rawValue = (record: DatabaseRecord, property: DatabaseProperty) =>
  property.type === 'createdAt'
    ? record.createdAt
    : property.type === 'updatedAt'
      ? record.updatedAt
      : record.values[property.id];
const textValue = (record: DatabaseRecord, property?: DatabaseProperty) => {
  if (!property) return record.title;
  const value = rawValue(record, property);
  if (blank(value)) return '';
  if (choiceType(property.type))
    return (
      property.options
        ?.filter((option) =>
          (Array.isArray(value) ? value : [value]).includes(option.id as never),
        )
        .map((option) => option.name)
        .join(', ') || ''
    );
  if (property.type === 'files' && Array.isArray(value))
    return value
      .map((file) => (typeof file === 'object' ? file.name : ''))
      .join(', ');
  return String(primitive(value));
};
export const databaseRelativeDates = [
  'today',
  'thisWeek',
  'thisMonth',
  'past7Days',
  'next7Days',
] as const;
export function databaseFilterOperators(
  property?: DatabaseProperty,
): DatabaseFilterOperator[] {
  const type = property?.type || 'text';
  const presence: DatabaseFilterOperator[] = ['empty', 'notEmpty'];
  if (type === 'checkbox' || choiceType(type))
    return ['eq', 'neq', ...presence];
  if (type === 'number')
    return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', ...presence];
  if (dateType(type))
    return [
      'eq',
      'neq',
      'lt',
      'lte',
      'gt',
      'gte',
      'between',
      'relative',
      ...presence,
    ];
  if (type === 'files') return ['contains', 'notContains', ...presence];
  return [
    'contains',
    'notContains',
    'eq',
    'neq',
    'startsWith',
    'endsWith',
    ...presence,
  ];
}
export function pruneDatabaseFilter(
  group: DatabaseFilterGroup | undefined,
  keep: (rule: DatabaseFilterRule) => boolean,
  map: (rule: DatabaseFilterRule) => DatabaseFilterRule = (rule) => rule,
): DatabaseFilterGroup | undefined {
  if (!group) return undefined;
  return {
    ...group,
    rules: group.rules.flatMap<DatabaseFilterRule | DatabaseFilterGroup>(
      (rule) => {
        if (!('rules' in rule)) return keep(rule) ? [map(rule)] : [];
        const child = pruneDatabaseFilter(rule, keep, map)!;
        return child.rules.length ? [child] : [];
      },
    ),
  };
}
export function databaseFilterCount(group?: DatabaseFilterGroup): number {
  return (
    group?.rules.reduce(
      (count, rule) =>
        count + ('rules' in rule ? databaseFilterCount(rule) : 1),
      0,
    ) || 0
  );
}
export function databaseFilterNodeCount(group: DatabaseFilterGroup): number {
  return (
    1 +
    group.rules.reduce(
      (count, node) =>
        count + ('rules' in node ? databaseFilterNodeCount(node) : 1),
      0,
    )
  );
}
// Calendar dates use the user's local calendar, including system timestamps.
function calendarDay(value: string, system = false) {
  if (!system) return value.slice(0, 10);
  const date = new Date(value);
  return localDay(date);
}
const localDay = (date: Date) =>
  `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function relativeRange(preset: string, now: Date): [string, string] {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end = new Date(start);
  if (preset === 'thisWeek') {
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
  }
  if (preset === 'thisMonth') {
    start.setDate(1);
    end.setMonth(end.getMonth() + 1, 0);
  }
  if (preset === 'past7Days') start.setDate(start.getDate() - 6);
  if (preset === 'next7Days') end.setDate(end.getDate() + 6);
  return [localDay(start), localDay(end)];
}
/** Unfinished rules remain editable, but do not affect the records or active UI. */
export function isDatabaseFilterRuleActive(
  node: DatabaseFilterRule,
  properties: DatabaseProperty[],
): boolean {
  if (
    node.propertyId !== 'title' &&
    !properties.some((property) => property.id === node.propertyId)
  )
    return false;
  return (
    node.operator === 'empty' ||
    node.operator === 'notEmpty' ||
    (node.value !== undefined &&
      node.value !== '' &&
      (!Array.isArray(node.value) || node.value.length > 0) &&
      (node.operator !== 'between' ||
        (node.endValue !== undefined && node.endValue !== '')))
  );
}

export function databaseActiveFilterCount(
  node: DatabaseFilterRule | DatabaseFilterGroup | undefined,
  properties: DatabaseProperty[],
): number {
  if (!node) return 0;
  return 'rules' in node
    ? node.rules.reduce(
        (count, child) => count + databaseActiveFilterCount(child, properties),
        0,
      )
    : Number(isDatabaseFilterRuleActive(node, properties));
}

export function matchesDatabaseFilter(
  record: DatabaseRecord,
  properties: DatabaseProperty[],
  filter?: DatabaseFilterGroup,
  now = new Date(),
): boolean {
  const evaluate = (
    node: DatabaseFilterRule | DatabaseFilterGroup,
  ): boolean | undefined => {
    if ('rules' in node) {
      const results = node.rules
        .map(evaluate)
        .filter((value): value is boolean => value !== undefined);
      return !results.length
        ? undefined
        : node.conjunction === 'and'
          ? results.every(Boolean)
          : results.some(Boolean);
    }
    if (!isDatabaseFilterRuleActive(node, properties)) return undefined;
    const property = properties.find(
      (property) => property.id === node.propertyId,
    );
    const type = property?.type || 'text',
      value = property ? rawValue(record, property) : record.title;
    if (node.operator === 'empty') return blank(value);
    if (node.operator === 'notEmpty') return !blank(value);
    if (choiceType(type)) {
      const selected = Array.isArray(node.value) ? node.value : [node.value];
      const match = (Array.isArray(value) ? value : [value]).some((entry) =>
        selected.includes(entry as string),
      );
      return node.operator === 'neq' ? !match : match;
    }
    if (type === 'checkbox')
      return node.operator === 'neq'
        ? Boolean(value) !== node.value
        : Boolean(value) === node.value;
    if (blank(value))
      return node.operator === 'neq' || node.operator === 'notContains';
    let left: string | number =
      type === 'number'
        ? Number(value)
        : textValue(record, property).toLocaleLowerCase();
    let right: string | number =
      type === 'number'
        ? Number(node.value)
        : String(node.value).toLocaleLowerCase();
    let end: string | number =
      type === 'number' ? Number(node.endValue) : String(node.endValue);
    if (dateType(type)) {
      left = calendarDay(String(primitive(value)), type !== 'date');
      right = String(node.value);
      end = String(node.endValue);
      if (node.operator === 'relative') {
        const [start, finish] = relativeRange(String(node.value), now);
        return left >= start && left <= finish;
      }
    }
    switch (node.operator) {
      case 'eq':
        return left === right;
      case 'neq':
        return left !== right;
      case 'contains':
        return String(left).includes(String(right));
      case 'notContains':
        return !String(left).includes(String(right));
      case 'startsWith':
        return String(left).startsWith(String(right));
      case 'endsWith':
        return String(left).endsWith(String(right));
      case 'gt':
        return left > right;
      case 'gte':
        return left >= right;
      case 'lt':
        return left < right;
      case 'lte':
        return left <= right;
      case 'between':
        return left >= right && left <= end;
      default:
        return undefined;
    }
  };
  return !filter || evaluate(filter) !== false;
}
export function compareDatabaseRecords(
  a: DatabaseRecord,
  b: DatabaseRecord,
  properties: DatabaseProperty[],
  sorts: DatabaseSort[],
) {
  for (const sort of sorts) {
    const property = properties.find(
      (property) => property.id === sort.propertyId,
    );
    if (!property && sort.propertyId !== 'title') continue;
    const value = (record: DatabaseRecord) =>
      property &&
      ['number', 'checkbox', 'date', 'createdAt', 'updatedAt'].includes(
        property.type,
      )
        ? primitive(rawValue(record, property))
        : textValue(record, property);
    let left = value(a),
      right = value(b);
    // Empty values stay last in both directions; ties fall through to the next rule.
    const missing = Number(blank(left)) - Number(blank(right));
    if (missing) return missing;
    if (blank(left) && blank(right)) continue;
    if (property && ['createdAt', 'updatedAt'].includes(property.type)) {
      left = Date.parse(String(left));
      right = Date.parse(String(right));
    }
    const result =
      typeof left === 'number' && typeof right === 'number'
        ? left - right
        : String(left).localeCompare(String(right), undefined, {
            numeric: true,
          });
    if (result) return sort.direction === 'asc' ? result : -result;
  }
  return 0;
}
export function validDatabaseFilter(
  value: unknown,
  properties: DatabaseProperty[],
): value is DatabaseFilterGroup {
  const ids = new Set<string>();
  let count = 0;
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  const date = (value: unknown) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  const validate = (node: unknown, depth: number): boolean => {
    if (
      !object(node) ||
      ++count > 100 ||
      depth > 3 ||
      typeof node.id !== 'string' ||
      !node.id ||
      ids.has(node.id)
    )
      return false;
    ids.add(node.id);
    if ('rules' in node)
      return (
        ['and', 'or'].includes(node.conjunction as string) &&
        Array.isArray(node.rules) &&
        node.rules.every((rule) => validate(rule, depth + 1))
      );
    const property = properties.find(
      (property) => property.id === node.propertyId,
    );
    if (
      (node.propertyId !== 'title' && !property) ||
      !databaseFilterOperators(property).includes(
        node.operator as DatabaseFilterOperator,
      )
    )
      return false;
    if (['empty', 'notEmpty'].includes(node.operator as string))
      return node.value === undefined && node.endValue === undefined;
    if (node.value === undefined || node.value === '')
      return (
        node.endValue === undefined ||
        node.endValue === '' ||
        (property?.type === 'number'
          ? typeof node.endValue === 'number' && Number.isFinite(node.endValue)
          : date(node.endValue))
      );
    const type = property?.type || 'text';
    if (node.operator === 'relative')
      return (
        databaseRelativeDates.includes(
          node.value as (typeof databaseRelativeDates)[number],
        ) && node.endValue === undefined
      );
    const validValue = (entry: unknown) =>
      type === 'number'
        ? typeof entry === 'number' && Number.isFinite(entry)
        : type === 'checkbox'
          ? typeof entry === 'boolean'
          : dateType(type)
            ? date(entry)
            : choiceType(type)
              ? typeof entry === 'string' &&
                !!property?.options?.some((option) => option.id === entry)
              : typeof entry === 'string';
    return (
      (choiceType(type) && Array.isArray(node.value)
        ? new Set(node.value).size === node.value.length &&
          node.value.every(validValue)
        : validValue(node.value)) &&
      (node.operator === 'between'
        ? node.endValue === undefined ||
          node.endValue === '' ||
          validValue(node.endValue)
        : node.endValue === undefined)
    );
  };
  return object(value) && 'rules' in value && validate(value, 0);
}
