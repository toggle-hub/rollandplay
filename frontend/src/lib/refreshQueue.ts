export type RefreshQueue<Part extends string> = {
  /** Asks for `parts` to be reloaded; resolves once a reload that includes them has finished. */
  request: (...parts: Part[]) => Promise<void>;
  /** Drops anything still waiting and ignores later requests; pending promises resolve. */
  stop: () => void;
};

/**
 * Batches reloads: parts requested within `delayMs` of each other, or while a reload is running, are
 * fetched together in the next run, so a burst of events costs one request per part. Runs never
 * overlap, so a slow older response can't overwrite a newer one. `run` must handle its own errors.
 */
export function createRefreshQueue<Part extends string>(run: (parts: ReadonlySet<Part>) => Promise<void>, delayMs: number): RefreshQueue<Part> {
  let parts = new Set<Part>();
  let waiters: (() => void)[] = [];
  let timer: number | undefined;
  let running = false;
  let stopped = false;

  function schedule() {
    if (stopped || running || timer !== undefined || parts.size === 0) return;
    timer = window.setTimeout(() => void start(), delayMs);
  }

  async function start() {
    timer = undefined;
    const batch = parts;
    const done = waiters;
    parts = new Set();
    waiters = [];
    running = true;
    try {
      await run(batch);
    } finally {
      running = false;
      done.forEach((resolve) => resolve());
      schedule();
    }
  }

  return {
    request(...next) {
      if (stopped) return Promise.resolve();
      next.forEach((part) => parts.add(part));
      const done = new Promise<void>((resolve) => waiters.push(resolve));
      schedule();
      return done;
    },
    stop() {
      stopped = true;
      window.clearTimeout(timer);
      timer = undefined;
      parts.clear();
      waiters.forEach((resolve) => resolve());
      waiters = [];
    },
  };
}
