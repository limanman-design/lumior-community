import type {
  DatabaseFilterGroup,
  DatabaseFilterRule,
  DatabaseProperty,
} from './database-model.ts';
import {
  databaseFilterCount,
  databaseFilterNodeCount,
  databaseFilterOperators,
} from './database-query.ts';

type DatabaseFilterNode = DatabaseFilterRule | DatabaseFilterGroup;

export type DatabaseFilterChip =
  | { kind: 'rule'; node: DatabaseFilterRule; depth: 0; root: false }
  | {
      kind: 'group';
      node: DatabaseFilterGroup;
      depth: 0 | 1;
      root: boolean;
    };

/** Keep OR roots together: displaying their children as separate chips implies AND. */
export function databaseFilterChips(
  filter?: DatabaseFilterGroup,
): DatabaseFilterChip[] {
  if (!filter?.rules.length) return [];
  if (filter.conjunction === 'or')
    return [{ kind: 'group', node: filter, depth: 0, root: true }];
  return filter.rules.map((node) =>
    'rules' in node
      ? { kind: 'group', node, depth: 1, root: false }
      : { kind: 'rule', node, depth: 0, root: false },
  );
}

function newGroup(rules: DatabaseFilterNode[] = []): DatabaseFilterGroup {
  return { id: crypto.randomUUID(), conjunction: 'and', rules };
}

function newRule(property: DatabaseProperty): DatabaseFilterRule {
  return {
    id: crypto.randomUUID(),
    propertyId: property.id,
    operator: databaseFilterOperators(property)[0],
    ...(property.type === 'checkbox' ? { value: true } : {}),
  };
}

function withinFilterLimits(filter: DatabaseFilterGroup): boolean {
  const ids = new Set<string>();
  const validDepthAndIds = (
    node: DatabaseFilterNode,
    depth: number,
  ): boolean => {
    if (!node.id || ids.has(node.id)) return false;
    ids.add(node.id);
    return !('rules' in node)
      ? true
      : depth <= 2 &&
          node.rules.every((child) => validDepthAndIds(child, depth + 1));
  };
  return (
    databaseFilterCount(filter) <= 40 &&
    databaseFilterNodeCount(filter) <= 99 &&
    validDepthAndIds(filter, 0)
  );
}

function appendNode(
  filter: DatabaseFilterGroup | undefined,
  node: DatabaseFilterNode,
): DatabaseFilterGroup | null {
  const next = !filter
    ? newGroup([node])
    : filter.conjunction === 'and'
      ? { ...filter, rules: [...filter.rules, node] }
      : newGroup([filter, node]);
  return withinFilterLimits(next) ? next : null;
}

/** Returns null if adding a rule would exceed the rule, node, or group-depth limit. */
export function appendDatabaseQuickFilter(
  filter: DatabaseFilterGroup | undefined,
  property: DatabaseProperty,
): DatabaseFilterGroup | null {
  return appendNode(filter, newRule(property));
}

/**
 * Adds an editable AND group with an unfinished title condition. Returns null if
 * the limits would be exceeded; callers can open the existing advanced editor.
 */
export function appendDatabaseAdvancedFilter(
  filter?: DatabaseFilterGroup,
): { filter: DatabaseFilterGroup; groupId: string } | null {
  const group = newGroup([
    newRule({ id: 'title', name: 'Name', type: 'text' }),
  ]);
  const next = appendNode(filter, group);
  return next ? { filter: next, groupId: group.id } : null;
}

/**
 * Replaces or removes one node without flattening groups or changing unrelated
 * IDs. Deleting the final child removes its now-empty ancestors and returns
 * undefined for an empty root. An unknown ID, invalid root replacement, or a
 * replacement exceeding UI limits leaves the original filter unchanged.
 * Explicitly replacing a child with an empty group keeps that group editable.
 */
export function replaceDatabaseFilterNode(
  filter: DatabaseFilterGroup | undefined,
  nodeId: string,
  next: DatabaseFilterNode | undefined,
): DatabaseFilterGroup | undefined {
  if (!filter) return undefined;
  if (filter.id === nodeId) {
    if (!next) return undefined;
    if (!('rules' in next) || !withinFilterLimits(next)) return filter;
    return next.rules.length ? next : undefined;
  }
  let found = false;
  const replace = (group: DatabaseFilterGroup): DatabaseFilterGroup => {
    let changed = false;
    const rules = group.rules.flatMap<DatabaseFilterNode>((node) => {
      if (node.id === nodeId) {
        found = true;
        changed = true;
        return next ? [next] : [];
      }
      if (!('rules' in node)) return [node];
      const child = replace(node);
      if (child === node) return [node];
      changed = true;
      return !next && !child.rules.length ? [] : [child];
    });
    return changed ? { ...group, rules } : group;
  };
  const result = replace(filter);
  if (!found || !withinFilterLimits(result)) return filter;
  return result.rules.length ? result : undefined;
}
