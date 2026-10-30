import type { Card, Point } from './canvas-model';
import {
  activeDatabaseView,
  databaseRecords,
  databaseViews,
  type WorkspaceDatabase,
} from './database-model.ts';

export const isDatabaseCard = (card: Pick<Card, 'kind'>) =>
  card.kind === 'database';

export function validDatabaseReference(
  value: unknown,
): value is NonNullable<Card['databaseRef']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const ref = value as Card['databaseRef'];
  return (
    typeof ref?.databaseId === 'string' &&
    !!ref.databaseId.trim() &&
    (ref.viewId === undefined ||
      (typeof ref.viewId === 'string' && !!ref.viewId.trim()))
  );
}

// Cards carry only identity and geometry. Records stay in WorkspaceDatabase.
export function createDatabaseCard(
  database: WorkspaceDatabase,
  point: Point,
  viewId?: string,
  idFactory: () => string = () => crypto.randomUUID(),
): Card {
  const view =
    databaseViews(database).find((item) => item.id === viewId) ||
    activeDatabaseView(database);
  return {
    id: idFactory(),
    kind: 'database',
    title: database.title,
    body: '',
    ...point,
    width: 480,
    height: 320,
    databaseRef: { databaseId: database.id, viewId: view.id },
  };
}

// Project the chosen view without changing the database's own selected view.
export function projectDatabaseView(
  database: WorkspaceDatabase,
  viewId?: string,
  language = 'en',
): WorkspaceDatabase {
  const views = databaseViews(database, language);
  const view =
    views.find((item) => item.id === viewId) ||
    activeDatabaseView(database, language);
  const { id, name: _name, ...config } = view;
  return { ...database, views, activeViewId: id, view: config };
}

export function resolveDatabaseCard(
  card: Card,
  databases: readonly WorkspaceDatabase[],
  language = 'en',
) {
  if (!isDatabaseCard(card) || !validDatabaseReference(card.databaseRef))
    return null;
  const source = databases.find(
    (item) => item.id === card.databaseRef!.databaseId,
  );
  if (!source) return null;
  const viewMissing =
    !!card.databaseRef.viewId &&
    !databaseViews(source, language).some(
      (view) => view.id === card.databaseRef!.viewId,
    );
  const database = projectDatabaseView(
    source,
    card.databaseRef.viewId,
    language,
  );
  const view = activeDatabaseView(database, language);
  return { database, view, viewMissing, records: databaseRecords(database) };
}
