import { abortError } from './errors';

export type RateLimiter = <T>(fn: () => Promise<T>, signal?: AbortSignal) => Promise<T>;

interface Job {
  run: () => void;
}

/**
 * Runs at most `maxConcurrent` tasks at a time, and starts tasks at least
 * `minIntervalMs` apart. Queued tasks whose `signal` aborts are dropped and
 * rejected with an AbortError.
 */
export function createRateLimiter(o: { maxConcurrent: number; minIntervalMs: number }): RateLimiter {
  const queue: Job[] = [];
  let active = 0;
  let lastStart: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function pump(): void {
    if (timer !== null) return;
    while (queue.length > 0 && active < o.maxConcurrent) {
      if (lastStart !== null) {
        const wait = lastStart + o.minIntervalMs - Date.now();
        if (wait > 0) {
          timer = setTimeout(() => {
            timer = null;
            pump();
          }, wait);
          return;
        }
      }
      const job = queue.shift()!;
      active++;
      lastStart = Date.now();
      job.run();
    }
  }

  return <T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortError());
        return;
      }
      const onAbort = () => {
        const i = queue.indexOf(job);
        if (i >= 0) {
          queue.splice(i, 1);
          reject(abortError());
        }
      };
      const job: Job = {
        run: () => {
          signal?.removeEventListener('abort', onAbort);
          Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => {
              active--;
              pump();
            });
        },
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      queue.push(job);
      pump();
    });
}
