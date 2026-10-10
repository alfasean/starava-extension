import { describe, it, expect, vi } from 'vitest';
import { createCachedSource } from '../../src/strava/cache';
import type { ActivitySummary, StravaSource, Streams } from '../../src/strava/types';

let n = 0;
const uniqueDb = () => `strava-cache-test-${++n}`;

const summary = (id: number): ActivitySummary => ({
  id,
  name: `Run ${id}`,
  type: 'Run',
  startDate: '2026-01-01T00:00:00Z',
  distanceM: 5000,
  movingTimeSec: 1500,
  elapsedTimeSec: 1550,
  elevationGainM: 10,
  workoutType: null,
});

function makeInner(streams: Streams = { time: [0, 1, 2] }) {
  const inner = {
    listActivities: vi.fn(async () => [summary(1), summary(2)]),
    getActivity: vi.fn(async (id: number) => summary(id)),
    getStreams: vi.fn(async () => streams),
  };
  return inner satisfies StravaSource;
}

describe('createCachedSource', () => {
  it('caches streams permanently', async () => {
    const inner = makeInner();
    const src = createCachedSource(inner, { dbName: uniqueDb() });
    const a = await src.getStreams(1);
    const b = await src.getStreams(1);
    expect(inner.getStreams).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
  });

  it('does not cache empty streams', async () => {
    const inner = makeInner({ time: [] });
    const src = createCachedSource(inner, { dbName: uniqueDb() });
    await src.getStreams(1);
    await src.getStreams(1);
    expect(inner.getStreams).toHaveBeenCalledTimes(2);
  });

  it('caches list for 5 minutes', async () => {
    const inner = makeInner();
    let t = 1_000_000;
    const src = createCachedSource(inner, { dbName: uniqueDb(), now: () => t });
    await src.listActivities({ page: 1, perPage: 30 });
    t += 5 * 60_000;
    await src.listActivities({ page: 1, perPage: 30 });
    expect(inner.listActivities).toHaveBeenCalledTimes(1);
    t += 1;
    await src.listActivities({ page: 1, perPage: 30 });
    expect(inner.listActivities).toHaveBeenCalledTimes(2);
  });

  it('keys lists by page and perPage', async () => {
    const inner = makeInner();
    const src = createCachedSource(inner, { dbName: uniqueDb() });
    await src.listActivities({ page: 1, perPage: 30 });
    await src.listActivities({ page: 2, perPage: 30 });
    expect(inner.listActivities).toHaveBeenCalledTimes(2);
  });

  it('serves getActivity from a prior list', async () => {
    const inner = makeInner();
    const src = createCachedSource(inner, { dbName: uniqueDb() });
    await src.listActivities({ page: 1, perPage: 30 });
    const a = await src.getActivity(2);
    expect(a).toEqual(summary(2));
    expect(inner.getActivity).not.toHaveBeenCalled();
  });

  it('caches getActivity results', async () => {
    const inner = makeInner();
    const src = createCachedSource(inner, { dbName: uniqueDb() });
    await src.getActivity(9);
    await src.getActivity(9);
    expect(inner.getActivity).toHaveBeenCalledTimes(1);
  });

  it('propagates errors and does not cache them', async () => {
    const inner = makeInner();
    inner.getStreams.mockRejectedValueOnce(new Error('boom'));
    const src = createCachedSource(inner, { dbName: uniqueDb() });
    await expect(src.getStreams(1)).rejects.toThrow('boom');
    await expect(src.getStreams(1)).resolves.toEqual({ time: [0, 1, 2] });
    expect(inner.getStreams).toHaveBeenCalledTimes(2);
  });

  it('passes the signal to the inner source', async () => {
    const inner = makeInner();
    const src = createCachedSource(inner, { dbName: uniqueDb() });
    const ac = new AbortController();
    await src.getStreams(1, ac.signal);
    await src.getActivity(5, ac.signal);
    await src.listActivities({ page: 1, perPage: 10 }, ac.signal);
    expect(inner.getStreams).toHaveBeenCalledWith(1, ac.signal);
    expect(inner.getActivity).toHaveBeenCalledWith(5, ac.signal);
    expect(inner.listActivities).toHaveBeenCalledWith({ page: 1, perPage: 10 }, ac.signal);
  });
});
