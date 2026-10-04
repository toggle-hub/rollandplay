export type FrameThrottle<T> = { push(frame: T): void; cancel(): void };

/** Sends at most one frame per `ms`; the newest frame pushed during a wait is sent when the wait ends. */
export function createFrameThrottle<T>(sendFrame: (frame: T) => void, ms: number): FrameThrottle<T> {
  let last = -Infinity;
  let pending: { frame: T } | null = null;
  let timer: number | undefined;
  return {
    push(frame) {
      const now = Date.now();
      if (now - last >= ms) {
        last = now;
        sendFrame(frame);
        return;
      }
      pending = { frame };
      if (timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        const next = pending;
        pending = null;
        if (!next) return;
        last = Date.now();
        sendFrame(next.frame);
      }, ms - (now - last));
    },
    cancel() {
      window.clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}
