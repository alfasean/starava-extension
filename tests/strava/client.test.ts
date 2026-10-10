import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createStravaClient } from '../../src/strava/client';
import {
  StravaAuthError,
  StravaFormatError,
  StravaRateLimitError,
} from '../../src/strava/errors';

const fixture = (name: string) =>
  readFileSync(resolve(__dirname, '../fixtures/strava', name), 'utf8');

interface FakeResponseInit {
  status?: number;
  body?: string;
  contentType?: string | null;
  redirected?: boolean;
  url?: string;
}

function fakeResponse(o: FakeResponseInit = {}): Response {
  const status = o.status ?? 200;
  const headers = new Headers();
  const ct = o.contentType === undefined ? 'application/json; charset=utf-8' : o.contentType;
  if (ct) headers.set('content-type', ct);
  return {
    status,
    ok: status >= 200 && status < 300,
    redirected: o.redirected ?? false,
    url: o.url ?? 'https://www.strava.com/athlete/training_activities',
    headers,
    text: async () => o.body ?? '',
  } as unknown as Response;
}

function makeClient(responses: Array<Response | (() => Response)>) {
  const queue = [...responses];
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('unexpected fetch');
    return typeof next === 'function' ? next() : next;
  });
  const sleep = vi.fn(async (_ms: number) => {});
  const client = createStravaClient({
    fetch: fetchMock as unknown as typeof fetch,
    sleep,
    rateLimit: { maxConcurrent: 2, minIntervalMs: 0 },
  });
  return { client, fetchMock, sleep };
}

describe('createStravaClient.listActivities', () => {
  it('requests the training_activities endpoint with credentials and JSON headers', async () => {
    const { client, fetchMock } = makeClient([fakeResponse({ body: fixture('training_activities.json') })]);
    await client.listActivities({ page: 2, perPage: 20 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      'https://www.strava.com/athlete/training_activities?page=2&per_page=20',
    );
    expect(init?.credentials).toBe('include');
    const headers = new Headers(init?.headers);
    expect(headers.get('Accept')).toBe('application/json');
    expect(headers.get('X-Requested-With')).toBe('XMLHttpRequest');
  });

  it('maps fixture models to ActivitySummary', async () => {
    const { client } = makeClient([fakeResponse({ body: fixture('training_activities.json') })]);
    const list = await client.listActivities({ page: 1, perPage: 20 });
    expect(list).toEqual([
      {
        id: 101,
        name: 'Morning Long Run',
        type: 'Run',
        startDate: '2026-01-01T08:00:00',
        distanceM: 10020.5,
        movingTimeSec: 3000,
        elapsedTimeSec: 3100,
        elevationGainM: 45.2,
        workoutType: 'long_run',
      },
      {
        id: 102,
        name: 'Tempo Tuesday',
        type: 'Run',
        startDate: '2026-01-03T07:30:00',
        distanceM: 8500,
        movingTimeSec: 2400,
        elapsedTimeSec: 2400,
        elevationGainM: 12,
        workoutType: 'workout',
      },
      {
        id: 103,
        name: 'Evening Ride',
        type: 'Ride',
        startDate: '2026-01-05T18:15:00',
        distanceM: 20000,
        movingTimeSec: 3600,
        elapsedTimeSec: 4000,
        elevationGainM: 0,
        workoutType: null,
      },
    ]);
  });

  it('accepts a top-level array and passes string workout types through', async () => {
    const body = JSON.stringify([
      {
        id: 7,
        name: 'x',
        type: 'Run',
        start_date_local: '2026-02-01T06:00:00+01:00',
        distance_raw: 5000,
        moving_time_raw: 1500,
        workout_type: 'race',
      },
      {
        id: 8,
        name: 'y',
        type: 'Run',
        start_date_local: '2026-02-02T06:00:00Z',
        distance_raw: 5000,
        moving_time_raw: 1500,
        workout_type: 0,
      },
    ]);
    const { client } = makeClient([fakeResponse({ body })]);
    const list = await client.listActivities({ page: 1, perPage: 20 });
    expect(list.map((a) => [a.startDate, a.workoutType])).toEqual([
      ['2026-02-01T06:00:00', 'race'],
      ['2026-02-02T06:00:00', 'default'],
    ]);
  });

  it('rejects StravaFormatError with zod issues and the raw body when required fields are missing', async () => {
    const body = JSON.stringify({ models: [{ id: 1, name: 'no distance', type: 'Run' }] });
    const { client } = makeClient([fakeResponse({ body })]);
    const err = await client.listActivities({ page: 1, perPage: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(StravaFormatError);
    expect(err.name).toBe('StravaFormatError');
    expect(err.details).toContain('distanceM');
    expect(err.details).toContain('startDate');
    expect(err.details).toContain('no distance');
  });

  it('rejects StravaFormatError on non-JSON bodies', async () => {
    const { client } = makeClient([fakeResponse({ body: 'not json' })]);
    await expect(client.listActivities({ page: 1, perPage: 20 })).rejects.toBeInstanceOf(
      StravaFormatError,
    );
  });
});

describe('auth detection', () => {
  const cases: Array<[string, Response]> = [
    [
      'redirect to /login',
      fakeResponse({ redirected: true, url: 'https://www.strava.com/login', contentType: 'text/html' }),
    ],
    [
      'redirect to /session',
      fakeResponse({ redirected: true, url: 'https://www.strava.com/session', body: '{}' }),
    ],
    ['HTML content-type', fakeResponse({ contentType: 'text/html; charset=utf-8', body: '<html></html>' })],
    ['401', fakeResponse({ status: 401 })],
    ['403', fakeResponse({ status: 403 })],
  ];

  for (const [label, res] of cases) {
    it(`rejects StravaAuthError on ${label}`, async () => {
      const { client } = makeClient([res]);
      const err = await client.listActivities({ page: 1, perPage: 20 }).catch((e) => e);
      expect(err).toBeInstanceOf(StravaAuthError);
      expect(err.name).toBe('StravaAuthError');
    });
  }

  it('rejects StravaAuthError on streams too', async () => {
    const { client } = makeClient([fakeResponse({ status: 401 })]);
    await expect(client.getStreams(1)).rejects.toBeInstanceOf(StravaAuthError);
  });
});

describe('createStravaClient.getStreams', () => {
  it('requests the streams endpoint with encoded stream_types', async () => {
    const { client, fetchMock } = makeClient([fakeResponse({ body: fixture('streams_with_hr.json') })]);
    await client.getStreams(42);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe(
      'https://www.strava.com/activities/42/streams?' +
        ['time', 'distance', 'heartrate', 'cadence', 'altitude', 'velocity_smooth', 'moving']
          .map((t) => `stream_types%5B%5D=${t}`)
          .join('&'),
    );
    expect(fetchMock.mock.calls[0][1]?.credentials).toBe('include');
  });

  it('parses the object form with heart rate', async () => {
    const { client } = makeClient([fakeResponse({ body: fixture('streams_with_hr.json') })]);
    const s = await client.getStreams(1);
    expect(s).toEqual({
      time: [0, 1, 2, 3, 4],
      distance: [0, 3.1, 6.2, 9.4, 12.5],
      heartrate: [120, 125, 130, 134, 138],
      cadence: [84, 85, 86, 86, 87],
      altitude: [10.0, 10.2, 10.3, 10.5, 10.4],
      velocity_smooth: [0, 3.1, 3.1, 3.15, 3.12],
      moving: [false, true, true, true, true],
    });
  });

  it('parses the API v3 array form without heart rate', async () => {
    const { client } = makeClient([fakeResponse({ body: fixture('streams_no_hr.json') })]);
    const s = await client.getStreams(1);
    expect(s.heartrate).toBeUndefined();
    expect(s.time).toEqual([0, 1, 2, 3]);
    expect(s.cadence).toEqual([80, 82, 83, 83]);
    expect(s.moving).toEqual([false, true, true, true]);
  });

  it('returns { time: [] } on 404', async () => {
    const { client } = makeClient([fakeResponse({ status: 404, contentType: 'text/html' })]);
    await expect(client.getStreams(1)).resolves.toEqual({ time: [] });
  });

  it('returns { time: [] } on an empty body', async () => {
    const { client } = makeClient([fakeResponse({ body: '' })]);
    await expect(client.getStreams(1)).resolves.toEqual({ time: [] });
  });

  it('returns { time: [] } when the time stream is missing', async () => {
    const { client } = makeClient([fakeResponse({ body: JSON.stringify({ heartrate: [1, 2] }) })]);
    await expect(client.getStreams(1)).resolves.toEqual({ time: [] });
  });

  it('rejects StravaFormatError when a stream has the wrong shape', async () => {
    const { client } = makeClient([
      fakeResponse({ body: JSON.stringify({ time: [0, 1], heartrate: 'nope' }) }),
    ]);
    const err = await client.getStreams(1).catch((e) => e);
    expect(err).toBeInstanceOf(StravaFormatError);
    expect(err.details).toContain('heartrate');
  });
});

describe('createStravaClient.getActivity', () => {
  const page = (ids: number[]) =>
    fakeResponse({
      body: JSON.stringify({
        models: ids.map((id) => ({
          id,
          name: `Run ${id}`,
          type: 'Run',
          start_date_local_raw: 1767254400,
          distance_raw: 5000,
          moving_time_raw: 1500,
        })),
      }),
    });

  it('scans list pages for the id', async () => {
    const { client, fetchMock } = makeClient([page([1, 2]), page([3, 4])]);
    const a = await client.getActivity(4);
    expect(a.id).toBe(4);
    expect(String(fetchMock.mock.calls[1][0])).toContain('page=2&per_page=20');
  });

  it('throws when not found within 10 pages', async () => {
    const pages = Array.from({ length: 10 }, (_, i) => page([i * 2 + 1, i * 2 + 2]));
    const { client, fetchMock } = makeClient(pages);
    await expect(client.getActivity(999)).rejects.toThrow(
      'Activity 999 not found in the 200 most recent activities',
    );
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('stops scanning at an empty page', async () => {
    const { client, fetchMock } = makeClient([page([1]), page([])]);
    await expect(client.getActivity(999)).rejects.toThrow('Activity 999 not found');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('429 handling and other errors', () => {
  it('backs off 1000, 2000, 4000 then rejects StravaRateLimitError', async () => {
    const { client, sleep, fetchMock } = makeClient([
      fakeResponse({ status: 429 }),
      fakeResponse({ status: 429 }),
      fakeResponse({ status: 429 }),
      fakeResponse({ status: 429 }),
    ]);
    const err = await client.getStreams(1).catch((e) => e);
    expect(err).toBeInstanceOf(StravaRateLimitError);
    expect(err.name).toBe('StravaRateLimitError');
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('resolves after a 429 followed by 200', async () => {
    const { client, sleep } = makeClient([
      fakeResponse({ status: 429 }),
      fakeResponse({ body: fixture('streams_with_hr.json') }),
    ]);
    const s = await client.getStreams(1);
    expect(s.heartrate).toHaveLength(5);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000]);
  });

  it('rejects with a plain Error on other non-OK statuses', async () => {
    const { client } = makeClient([fakeResponse({ status: 500 })]);
    await expect(client.listActivities({ page: 1, perPage: 20 })).rejects.toThrow(
      'Strava request failed with HTTP 500',
    );
  });
});

describe('abort', () => {
  it('rejects with AbortError when the signal is already aborted', async () => {
    const { client, fetchMock } = makeClient([fakeResponse({ body: '[]' })]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(client.listActivities({ page: 1, perPage: 20 }, ctrl.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
    await expect(client.getStreams(1, ctrl.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects with AbortError when aborted during backoff sleep', async () => {
    const ctrl = new AbortController();
    const fetchMock = vi.fn(async () => fakeResponse({ status: 429 }));
    const client = createStravaClient({
      fetch: fetchMock as unknown as typeof fetch,
      sleep: () => new Promise(() => {}), // never resolves on its own
      rateLimit: { maxConcurrent: 2, minIntervalMs: 0 },
    });
    const p = client.getStreams(1, ctrl.signal);
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    ctrl.abort();
    await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
