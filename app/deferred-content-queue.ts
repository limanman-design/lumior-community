/** One heavyweight editor per frame, shared by canvas and sidebar surfaces. */
export function createDeferredContentQueue(requestFrame: (callback: () => void) => number, cancelFrame: (id: number) => void) {
  const tasks = new Map<symbol, { callback: () => void; priority: number }>();
  let frame: number | undefined;
  const schedule = () => { if (frame === undefined && tasks.size) frame = requestFrame(run); };
  function run() {
    frame = undefined;
    let first: [symbol, { callback: () => void; priority: number }] | undefined;
    for (const task of tasks) if (!first || task[1].priority > first[1].priority) first = task;
    if (first) {
      tasks.delete(first[0]);
      try { first[1].callback(); } finally { schedule(); }
    }
  }
  return (callback: () => void, priority = 0) => {
    const key = Symbol();
    tasks.set(key, { callback, priority });
    schedule();
    return () => {
      tasks.delete(key);
      if (!tasks.size && frame !== undefined) { cancelFrame(frame); frame = undefined; }
    };
  };
}
