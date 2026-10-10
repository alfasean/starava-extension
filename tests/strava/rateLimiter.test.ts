import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRateLimiter } from '../../src/strava/rateLimiter';

afterEach(() => {
  vi.useRealTimers();
});

describe('createRateLimiter', () => {
  it('never runs more than maxConcurrent tasks and spaces starts by minIntervalMs', async () => {
    vi.useFakeTimers();
    const limit = createRateLimiter({ maxConcurrent: 2, minIntervalMs: 300 });
    let running = 0;
    let maxRunning = 0;
    const starts: number[] = [];

    const task = (i: number) => async () => {
      starts.push(Date.now());
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 1000));
      running--;
      return i;
    };

    const all = Promise.all([0, 1, 2, 3, 4].map((i) => limit(task(i))));
    await vi.runAllTimersAsync();
    await expect(all).resolves.toEqual([0, 1, 2, 3, 4]);

    expect(starts).toHaveLength(5);
    expect(maxRunning).toBeLessThanOrEqual(2);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(300);
    }
  });

  it('propagates task rejections and keeps processing the queue', async () => {
    const limit = createRateLimiter({ maxConcurrent: 1, minIntervalMs: 0 });
    const a = limit(async () => {
      throw new Error('boom');
    });
    const b = limit(async () => 'ok');
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe('ok');
  });

  it('rejects with AbortError when the signal aborts while queued', async () => {
    vi.useFakeTimers();
    const limit = createRateLimiter({ maxConcurrent: 1, minIntervalMs: 0 });
    const first = limit(() => new Promise((r) => setTimeout(() => r('first'), 1000)));
    const ctrl = new AbortController();
    const fn = vi.fn(async () => 'second');
    const second = limit(fn, ctrl.signal);
    const assertion = expect(second).rejects.toMatchObject({ name: 'AbortError' });
    ctrl.abort();
    await assertion;
    await vi.runAllTimersAsync();
    await expect(first).resolves.toBe('first');
    expect(fn).not.toHaveBeenCalled();
  });
});
