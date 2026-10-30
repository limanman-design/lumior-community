type Job<T> = {
  priority: () => number;
  run: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

// PDF canvas/text work shares the renderer thread. Visible pages go first;
// neighbours, thumbnails and speculative preparation wait behind them.
export function createPdfRenderScheduler() {
  const jobs: Job<unknown>[] = [];
  let active = false,
    queued = false;
  const pump = () => {
    queued = false;
    if (active) return;
    for (let i = jobs.length - 1; i >= 0; i--) {
      if (jobs[i].signal?.aborted)
        jobs
          .splice(i, 1)[0]
          .reject(new DOMException('Cancelled', 'AbortError'));
    }
    if (!jobs.length) return;
    let index = 0;
    for (let i = 1; i < jobs.length; i++)
      if (jobs[i].priority() < jobs[index].priority()) index = i;
    const job = jobs.splice(index, 1)[0];
    if (job.abort) job.signal?.removeEventListener('abort', job.abort);
    active = true;
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        active = false;
        queue();
      });
  };
  const queue = () => {
    if (queued || active) return;
    queued = true;
    setTimeout(pump, 0);
  };
  return {
    schedule<T>(
      priority: () => number,
      run: () => Promise<T>,
      signal?: AbortSignal,
    ) {
      return new Promise<T>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Cancelled', 'AbortError'));
          return;
        }
        const job = { priority, run, signal, resolve, reject } as Job<unknown>;
        job.abort = () => {
          const index = jobs.indexOf(job);
          if (index >= 0) {
            jobs.splice(index, 1);
            reject(new DOMException('Cancelled', 'AbortError'));
          }
        };
        signal?.addEventListener('abort', job.abort, { once: true });
        jobs.push(job);
        queue();
      });
    },
  };
}

export const pdfRenderScheduler = createPdfRenderScheduler();
