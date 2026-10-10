import { describe, expect, it, vi } from 'vitest';
import { activityIdFromUrl, createTools } from '../../src/tools';
import type { ToolDefinition } from '../../src/tools/types';
import type { ActivitySummary, StravaSource, Streams } from '../../src/strava/types';
import type { Settings } from '../../src/settings/types';

const settings: Settings = {
  provider: 'openai',
  apiKey: 'k',
  model: 'm',
  athlete: { maxHr: 190, restHr: 50, thresholdPaceSecPerKm: 270 },
};

const NOW = new Date(2026, 9, 10, 12, 0, 0); // local 2026-10-10

function act(id: number, startDate: string, over: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id,
    name: `Run ${id}`,
    type: 'Run',
    startDate,
    distanceM: 10000,
    movingTimeSec: 3000,
    elapsedTimeSec: 3100,
    elevationGainM: 50,
    workoutType: null,
    ...over,
  };
}

function fullStreams(): Streams {
  const n = 1500;
  const time = Array.from({ length: n }, (_, i) => i * 2);
  return {
    time,
    distance: time.map((t) => t * 3.3),
    heartrate: time.map(() => 130),
    cadence: time.map(() => 85),
    altitude: time.map(() => 10),
    velocity_smooth: time.map(() => 3.3),
    moving: time.map(() => true),
  };
}

function makeSource(all: ActivitySummary[], streams: (id: number) => Streams = fullStreams) {
  const listActivities = vi.fn(async ({ page, perPage }: { page: number; perPage: number }) =>
    all.slice((page - 1) * perPage, page * perPage),
  );
  const getActivity = vi.fn(async (id: number) => all.find((a) => a.id === id)!);
  const getStreams = vi.fn(async (id: number) => streams(id));
  const source: StravaSource = { listActivities, getActivity, getStreams };
  return { source, listActivities, getActivity, getStreams };
}

function setup(all: ActivitySummary[], opts: { url?: string; streams?: (id: number) => Streams } = {}) {
  const m = makeSource(all, opts.streams);
  const tools = createTools({
    source: m.source,
    getSettings: async () => settings,
    getActiveTabUrl: async () => opts.url,
    now: () => NOW,
  });
  const byName = (n: string): ToolDefinition => tools.find((t) => t.spec.name === n)!;
  const progress: string[] = [];
  const ctx = { reportProgress: (l: string) => progress.push(l) };
  return { ...m, tools, byName, ctx, progress };
}

const ALLOWED = new Set(['type', 'properties', 'required', 'description', 'enum', 'items']);
function walk(schema: unknown, path = 'root'): void {
  if (Array.isArray(schema)) return schema.forEach((s, i) => walk(s, `${path}[${i}]`));
  if (schema && typeof schema === 'object') {
    for (const [k, v] of Object.entries(schema)) {
      if (path.endsWith('.properties') || path === 'properties') {
        walk(v, `${path}.${k}`);
        continue;
      }
      expect(ALLOWED.has(k), `keyword ${k} at ${path}`).toBe(true);
      if (k === 'properties') walk(v, `${path}.properties`);
      else walk(v, `${path}.${k}`);
    }
  }
}

describe('activityIdFromUrl', () => {
  it('extracts the id', () => {
    expect(activityIdFromUrl('https://www.strava.com/activities/123456/overview')).toBe(123456);
    expect(activityIdFromUrl('https://www.strava.com/activities/123456')).toBe(123456);
  });
  it('returns null for other pages', () => {
    expect(activityIdFromUrl('https://www.strava.com/dashboard')).toBeNull();
    expect(activityIdFromUrl(undefined)).toBeNull();
  });
});

describe('tool definitions', () => {
  it('exposes exactly the five spec tools with restricted schemas', () => {
    const { tools } = setup([]);
    expect(tools.map((t) => t.spec.name).sort()).toEqual(
      ['get_activity_analysis', 'get_athlete_profile', 'get_current_activity', 'get_training_trend', 'list_activities'].sort(),
    );
    for (const t of tools) {
      expect(t.spec.description.length).toBeGreaterThan(10);
      walk(t.spec.parameters);
    }
  });
});

describe('get_current_activity', () => {
  it('returns the id on an activity page', async () => {
    const s = setup([], { url: 'https://www.strava.com/activities/42' });
    expect(await s.byName('get_current_activity').handler({}, s.ctx)).toEqual({ id: 42 });
  });
  it('rejects on other pages', async () => {
    const s = setup([], { url: 'https://www.strava.com/dashboard' });
    await expect(s.byName('get_current_activity').handler({}, s.ctx)).rejects.toThrow(/not a Strava activity page/);
  });
});

describe('get_athlete_profile', () => {
  it('returns zones', async () => {
    const s = setup([]);
    const r = (await s.byName('get_athlete_profile').handler({}, s.ctx)) as any;
    expect(r.maxHr).toBe(190);
    expect(r.restHr).toBe(50);
    expect(r.thresholdPaceSecPerKm).toBe(270);
    expect(r.hrZones).toHaveLength(5);
    expect(r.hrZones[0]).toEqual({ zone: 'Z1', minBpm: 120, maxBpm: 134 });
    expect(r.hrZones[4].maxBpm).toBe(190);
  });
});

describe('list_activities', () => {
  it('filters type, computes pace and stops at items older than after', async () => {
    const all: ActivitySummary[] = [];
    for (let i = 0; i < 20; i++) all.push(act(100 + i, `2026-10-${String(20 - i).padStart(2, '0')}T07:00:00`));
    // page 1 above is Oct 20 .. Oct 1 (all newer than after) ; page 2 reaches older
    all.push(act(200, '2026-09-15T07:00:00', { type: 'Ride' }));
    all.push(act(201, '2026-09-02T07:00:00'));
    all.push(act(202, '2026-08-20T07:00:00'));
    for (let i = 0; i < 17; i++) all.push(act(300 + i, '2026-08-01T07:00:00'));
    const s = setup(all);
    const r = (await s.byName('list_activities').handler({ after: '2026-09-01' }, s.ctx)) as any;
    const rows = r.activities ?? r;
    expect(rows.map((x: any) => x.id)).toContain(201);
    expect(rows.map((x: any) => x.id)).not.toContain(200); // Ride
    expect(rows.map((x: any) => x.id)).not.toContain(202); // too old
    expect(rows[0]).toMatchObject({ id: 100, name: 'Run 100', distanceKm: 10, movingTimeSec: 3000, avgPaceSecPerKm: 300 });
    expect(s.listActivities).toHaveBeenCalledTimes(2);
  });

  it('honours limit and before', async () => {
    const all = [
      act(1, '2026-10-09T10:00:00'),
      act(2, '2026-10-05T10:00:00'),
      act(3, '2026-10-04T23:59:00'),
      act(4, '2026-10-03T10:00:00'),
    ];
    const s = setup(all);
    const r = (await s.byName('list_activities').handler({ before: '2026-10-05', limit: 2 }, s.ctx)) as any;
    expect((r.activities ?? r).map((x: any) => x.id)).toEqual([2, 3]);
  });

  it('accepts VirtualRun/TrailRun for Run, case-insensitively', async () => {
    const all = [act(1, '2026-10-09T10:00:00', { type: 'TrailRun' }), act(2, '2026-10-08T10:00:00', { type: 'VirtualRun' }), act(3, '2026-10-07T10:00:00', { type: 'Ride' })];
    const s = setup(all);
    const r = (await s.byName('list_activities').handler({ type: 'run' }, s.ctx)) as any;
    expect((r.activities ?? r).map((x: any) => x.id)).toEqual([1, 2]);
    const r2 = (await s.byName('list_activities').handler({ type: 'ride' }, s.ctx)) as any;
    expect((r2.activities ?? r2).map((x: any) => x.id)).toEqual([3]);
  });

  it('validates arguments', async () => {
    const s = setup([]);
    const h = s.byName('list_activities').handler;
    await expect(h({ limit: 201 }, s.ctx)).rejects.toThrow(/limit.*1.*200/);
    await expect(h({ limit: 0 }, s.ctx)).rejects.toThrow(/limit/);
    await expect(h({ after: 'yesterday' }, s.ctx)).rejects.toThrow(/after.*YYYY-MM-DD/);
  });
});

describe('get_activity_analysis', () => {
  it('analyzes with streams', async () => {
    const s = setup([act(7, '2026-10-06T07:00:00')]);
    const r = (await s.byName('get_activity_analysis').handler({ id: 7 }, s.ctx)) as any;
    expect(r.summary.id).toBe(7);
    expect(r.missing).toEqual([]);
    expect(JSON.stringify(r).length).toBeLessThan(8192);
  });

  it('resolves with all streams missing for empty streams', async () => {
    const s = setup([act(7, '2026-10-06T07:00:00')], { streams: () => ({ time: [] }) });
    const r = (await s.byName('get_activity_analysis').handler({ id: 7 }, s.ctx)) as any;
    expect(r.missing).toEqual(expect.arrayContaining(['heartrate', 'cadence', 'distance', 'altitude', 'velocity_smooth']));
  });

  it('validates id', async () => {
    const s = setup([]);
    await expect(s.byName('get_activity_analysis').handler({ id: 'x' }, s.ctx)).rejects.toThrow(/id/);
  });
});

describe('get_training_trend', () => {
  const runs = [
    act(1, '2026-10-08T07:00:00'),
    act(2, '2026-10-06T07:00:00'),
    act(3, '2026-09-30T07:00:00', { type: 'Ride' }),
    act(4, '2026-09-25T07:00:00'),
  ];

  it('reports progress and returns weeks', async () => {
    const s = setup(runs);
    const r = (await s.byName('get_training_trend').handler({ weeks: 4 }, s.ctx)) as any;
    expect(s.progress).toEqual(['Fetching streams 1/3', 'Fetching streams 2/3', 'Fetching streams 3/3']);
    expect(s.getStreams).toHaveBeenCalledTimes(3);
    expect(r.weeks).toHaveLength(4);
    expect(r.weeks[3].runs).toBe(2);
    expect(JSON.stringify(r).length).toBeLessThan(8192);
  });

  it('adds a note for runs without HR', async () => {
    const s = setup(runs, { streams: () => ({ time: [] }) });
    const r = (await s.byName('get_training_trend').handler({ weeks: 4 }, s.ctx)) as any;
    expect(typeof r.note).toBe('string');
  });

  it('rejects out-of-range weeks', async () => {
    const s = setup(runs);
    await expect(s.byName('get_training_trend').handler({ weeks: 54 }, s.ctx)).rejects.toThrow(/weeks.*1.*53/);
    await expect(s.byName('get_training_trend').handler({}, s.ctx)).rejects.toThrow(/weeks/);
  });

  it('stops when aborted', async () => {
    const s = setup(runs);
    const ac = new AbortController();
    s.getStreams.mockImplementation(async () => {
      ac.abort();
      return fullStreams();
    });
    await expect(s.byName('get_training_trend').handler({ weeks: 4 }, { ...s.ctx, signal: ac.signal })).rejects.toThrow(/abort/i);
  });
});
