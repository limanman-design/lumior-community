export type DatabaseEditCommit = () => void;

export type DatabaseEditSession = {
  register: (commit: DatabaseEditCommit) => () => void;
  flush: () => void;
};

// Editors retain their own draft, cancellation and validation rules. The session
// finishes registered drafts before their record or containing view disappears.
export function createDatabaseEditSession(): DatabaseEditSession {
  const commits = new Set<DatabaseEditCommit>();
  let flushing = false;

  return {
    register(commit) {
      commits.add(commit);
      return () => {
        commits.delete(commit);
      };
    },
    flush() {
      // A commit can blur another editor or trigger another transition. The
      // outer pass already owns those drafts and must not invoke them twice.
      if (flushing) return;
      flushing = true;
      const errors: unknown[] = [];
      try {
        // Registrations created while committing belong to the next view.
        for (const commit of Array.from(commits)) {
          if (!commits.has(commit)) continue;
          try {
            commit();
          } catch (error) {
            // Still finish independent drafts, but never report a successful
            // transition to a caller when any draft could not be committed.
            errors.push(error);
          }
        }
      } finally {
        flushing = false;
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1)
        throw new AggregateError(errors, 'Database edits could not be saved.');
    },
  };
}
