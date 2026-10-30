'use client';
import { createContext, useContext, useLayoutEffect, useRef } from 'react';
import type { DatabaseEditSession } from './database-edit-session';

export class DatabaseEditValidationError extends Error {}

export const DatabaseEditContext = createContext<DatabaseEditSession | null>(
  null,
);
export const DatabaseDraftContext = createContext<
  ((token: object, editing: boolean) => void) | null
>(null);

/** Portalled field editors share the same commit boundary as their record. */
export function useDatabaseEditCommit(commit: () => void, editing = false) {
  const session = useContext(DatabaseEditContext);
  const reportDraft = useContext(DatabaseDraftContext);
  const token = useRef({});
  const latest = useRef(commit);
  useLayoutEffect(() => {
    latest.current = commit;
  });
  useLayoutEffect(() => {
    const currentToken = token.current;
    reportDraft?.(currentToken, editing);
    return () => reportDraft?.(currentToken, false);
  }, [editing, reportDraft]);
  useLayoutEffect(() => {
    if (!session) return;
    const unregister = session.register(() => latest.current());
    return () => {
      // A workspace-tab change can unmount an editor without firing blur.
      // Invalid drafts cannot enter the stored, typed field value.
      try {
        latest.current();
      } catch (error) {
        if (!(error instanceof DatabaseEditValidationError)) throw error;
      } finally {
        unregister();
      }
    };
  }, [session]);
}
