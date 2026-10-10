import type { ActivitySummary, StravaSource } from '../strava/types';
import type { Settings } from '../settings/types';
import { analyzeActivity } from '../metrics/analysis';
import { weeklyTrend, type TrendInput } from '../metrics/trend';
import { hrZoneBounds } from '../metrics/zones';
import type { ToolContext, ToolDefinition } from './types';

export interface ToolDeps {
  source: StravaSource;
  getSettings: () => Promise<Settings>;
  getActiveTabUrl: () => Promise<string | undefined>;
  now?: () => Date;
}

const PER_PAGE = 20;
const MAX_PAGES = 20;
const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function activityIdFromUrl(url: string | undefined): number | null {
  if (!url) return null;
  const m = /\/activities\/(\d+)/.exec(url);
  return m ? Number(m[1]) : null;
}

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Local calendar date (YYYY-MM-DD) of a local-time ISO start string. */
const dayOf = (a: ActivitySummary): string => a.startDate.slice(0, 10);

function optDate(args: Record<string, unknown>, name: string): string | undefined {
  const v = args[name];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !DATE_RE.test(v) || Number.isNaN(new Date(`${v}T00:00:00`).getTime())) {
    throw new Error(`Argument "${name}" must be a date in YYYY-MM-DD format.`);
  }
  return v;
}

function intArg(args: Record<string, unknown>, name: string, min: number, max: number, def?: number): number {
  const v = args[name];
  if (v === undefined || v === null) {
    if (def !== undefined) return def;
    throw new Error(`Argument "${name}" is required and must be an integer between ${min} and ${max}.`);
  }
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`Argument "${name}" must be an integer between ${min} and ${max}.`);
  }
  return v;
}

function matchesType(actual: string, wanted: string): boolean {
  const a = actual.toLowerCase();
  const w = wanted.toLowerCase();
  if (a === w) return true;
  return w === 'run' && (a === 'virtualrun' || a === 'trailrun');
}

interface ListOpts {
  after?: string;
  before?: string;
  type: string;
  limit: number;
}

async function fetchActivities(source: StravaSource, o: ListOpts, signal?: AbortSignal): Promise<ActivitySummary[]> {
  const out: ActivitySummary[] = [];
  for (let page = 1; page <= MAX_PAGES && out.length < o.limit; page++) {
    if (signal?.aborted) throw new Error('Aborted');
    const items = await source.listActivities({ page, perPage: PER_PAGE }, signal);
    if (items.length === 0) break;
    for (const a of items) {
      const day = dayOf(a);
      if (o.after && day < o.after) continue;
      if (o.before && day > o.before) continue;
      if (!matchesType(a.type, o.type)) continue;
      out.push(a);
      if (out.length >= o.limit) break;
    }
    const oldest = items[items.length - 1];
    if (items.length < PER_PAGE) break;
    if (o.after && dayOf(oldest) < o.after) break;
  }
  return out;
}

const round = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

export function createTools(deps: ToolDeps): ToolDefinition[] {
  const { source, getSettings, getActiveTabUrl } = deps;
  const now = deps.now ?? (() => new Date());

  const getAthleteProfile: ToolDefinition = {
    spec: {
      name: 'get_athlete_profile',
      description:
        'Returns the athlete\'s max and resting heart rate (bpm), the five Karvonen heart-rate zone bounds in bpm, and threshold pace in seconds per km if set. Use it to interpret heart-rate data.',
      parameters: { type: 'object', properties: {} },
    },
    async handler() {
      const { athlete } = await getSettings();
      const b = hrZoneBounds(athlete.maxHr, athlete.restHr);
      const hrZones = [1, 2, 3, 4, 5].map((n, i) => ({ zone: `Z${n}`, minBpm: b[i], maxBpm: b[i + 1] }));
      const out: Record<string, unknown> = { maxHr: athlete.maxHr, restHr: athlete.restHr, hrZones };
      if (athlete.thresholdPaceSecPerKm !== undefined) out.thresholdPaceSecPerKm = athlete.thresholdPaceSecPerKm;
      return out;
    },
  };

  const listActivities: ToolDefinition = {
    spec: {
      name: 'list_activities',
      description:
        'Lists the athlete\'s activities, newest first, optionally filtered by date range and type. Each row has distanceKm, movingTimeSec, avgPaceSecPerKm (seconds per km) and elevationGainM (meters).',
      parameters: {
        type: 'object',
        properties: {
          after: { type: 'string', description: 'Only activities on or after this local date, YYYY-MM-DD.' },
          before: { type: 'string', description: 'Only activities on or before this local date, YYYY-MM-DD.' },
          type: { type: 'string', description: 'Activity type, case-insensitive. Default "Run".' },
          limit: { type: 'integer', description: 'Maximum number of rows, 1 to 200. Default 30.' },
        },
      },
    },
    async handler(args, ctx) {
      const after = optDate(args, 'after');
      const before = optDate(args, 'before');
      const limit = intArg(args, 'limit', 1, MAX_LIMIT, DEFAULT_LIMIT);
      const t = args.type;
      if (t !== undefined && t !== null && (typeof t !== 'string' || t.trim() === '')) {
        throw new Error('Argument "type" must be a non-empty string such as "Run".');
      }
      const type = typeof t === 'string' ? t.trim() : 'Run';
      const acts = await fetchActivities(source, { after, before, type, limit }, ctx.signal);
      const activities = acts.map((a) => {
        const distanceKm = round(a.distanceM / 1000, 2);
        return {
          id: a.id,
          date: a.startDate,
          name: a.name,
          distanceKm,
          movingTimeSec: a.movingTimeSec,
          avgPaceSecPerKm: distanceKm > 0 ? Math.round(a.movingTimeSec / distanceKm) : null,
          elevationGainM: a.elevationGainM,
          workoutType: a.workoutType,
        };
      });
      return { count: activities.length, activities };
    },
  };

  const getActivityAnalysis: ToolDefinition = {
    spec: {
      name: 'get_activity_analysis',
      description:
        'Analyzes one activity by id: summary, per-km splits, percent of time in each HR zone, aerobic decoupling %, pace variability, cadence in steps/min and TRIMP. The "missing" array lists unavailable data streams.',
      parameters: {
        type: 'object',
        properties: { id: { type: 'integer', description: 'Strava activity id.' } },
        required: ['id'],
      },
    },
    async handler(args, ctx) {
      const id = args.id;
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
        throw new Error('Argument "id" must be a positive integer activity id.');
      }
      const [summary, streams, settings] = [
        await source.getActivity(id, ctx.signal),
        await source.getStreams(id, ctx.signal),
        await getSettings(),
      ];
      return analyzeActivity(summary, streams, settings.athlete);
    },
  };

  const getTrainingTrend: ToolDefinition = {
    spec: {
      name: 'get_training_trend',
      description:
        'Weekly running trend for the last N weeks (1 to 53), oldest first: runs, km, timeSec, longestRunKm, TRIMP load, ACWR (acute/chronic load ratio) and aerobic efficiency as pace in seconds per km at HR zone 2.',
      parameters: {
        type: 'object',
        properties: { weeks: { type: 'integer', description: 'Number of weeks, 1 to 53.' } },
        required: ['weeks'],
      },
    },
    async handler(args, ctx: ToolContext) {
      const weeks = intArg(args, 'weeks', 1, 53);
      const settings = await getSettings();
      const nowDate = now();
      const from = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
      from.setDate(from.getDate() - (weeks + 3) * 7);
      const acts = await fetchActivities(
        source,
        { after: fmtDate(from), type: 'Run', limit: Number.POSITIVE_INFINITY },
        ctx.signal,
      );
      const items: TrendInput[] = [];
      for (let i = 0; i < acts.length; i++) {
        if (ctx.signal?.aborted) throw new Error('Aborted');
        ctx.reportProgress(`Fetching streams ${i + 1}/${acts.length}`);
        const streams = await source.getStreams(acts[i].id, ctx.signal);
        items.push({ summary: acts[i], streams: streams.time.length === 0 ? null : streams });
      }
      const result = weeklyTrend(items, settings.athlete, weeks, nowDate);
      const out: { weeks: typeof result; note?: string } = { weeks: result };
      if (result.some((w) => w.runsWithoutHr > 0)) {
        out.note =
          'runsWithoutHr counts runs lacking heart-rate data; they add distance and time but are excluded from HR-based metrics (TRIMP, ACWR, aerobic efficiency).';
      }
      return out;
    },
  };

  const getCurrentActivity: ToolDefinition = {
    spec: {
      name: 'get_current_activity',
      description:
        'Returns the id of the Strava activity open in the active browser tab. Use it when the user says "this run" or "this activity".',
      parameters: { type: 'object', properties: {} },
    },
    async handler() {
      const id = activityIdFromUrl(await getActiveTabUrl());
      if (id === null) throw new Error('The active tab is not a Strava activity page. Use list_activities to find the most recent run instead.');
      return { id };
    },
  };

  return [getAthleteProfile, listActivities, getActivityAnalysis, getTrainingTrend, getCurrentActivity];
}
