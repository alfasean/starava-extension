/**
 * Parsing of Strava's internal web endpoints.
 *
 * NOTE: the field mappings below are UNVERIFIED against live data. The endpoint
 * probe (Task 2) has not run yet, so they are built from the expected shapes
 * of `/athlete/training_activities` and `/activities/{id}/streams` and parse
 * defensively (several candidate field names, first present wins). Revisit
 * once docs/strava-endpoints.md and real fixtures exist.
 */
import { z } from 'zod';
import { StravaFormatError } from './errors';
import type { ActivitySummary, Streams } from './types';

const RAW_SNIPPET_CHARS = 500;

function formatError(message: string, issues: unknown, raw: string): StravaFormatError {
  return new StravaFormatError(
    message,
    `issues: ${JSON.stringify(issues, null, 2)}\nraw body (first ${RAW_SNIPPET_CHARS} chars): ${raw.slice(0, RAW_SNIPPET_CHARS)}`,
  );
}

export function parseJsonBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw formatError('Strava returned a non-JSON body', [{ message: String(e) }], raw);
  }
}

// ---------------------------------------------------------------- activities

const Model = z.record(z.string(), z.unknown());
const TrainingActivitiesResponse = z.union([
  z.array(Model),
  z.object({ models: z.array(Model) }),
]);

export const ActivitySummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  type: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
  distanceM: z.number().nonnegative(),
  movingTimeSec: z.number().nonnegative(),
  elapsedTimeSec: z.number().nonnegative(),
  elevationGainM: z.number(),
  workoutType: z.string().nullable(),
});

const RUN_WORKOUT_TYPES: Record<number, string> = {
  0: 'default',
  1: 'race',
  2: 'long_run',
  3: 'workout',
};

const present = (v: unknown) => v !== undefined && v !== null && v !== '';

function firstPresent(m: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (present(m[k])) return m[k];
  return undefined;
}

/** Number, or a numeric string; anything else → undefined. */
function toNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/,/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Seconds from a number, numeric string, or "h:mm:ss" / "mm:ss" string. */
function toSeconds(v: unknown): number | undefined {
  const n = toNumber(v);
  if (n !== undefined) return n;
  if (typeof v === 'string' && /^\d+(:\d{1,2}){1,2}$/.test(v.trim())) {
    return v
      .trim()
      .split(':')
      .reduce((acc, part) => acc * 60 + Number(part), 0);
  }
  return undefined;
}

const WALL_CLOCK = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/;

/** Wall-clock part of an ISO-ish timestamp, dropping any 'Z' / offset / fraction. */
function wallClock(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const m = WALL_CLOCK.exec(v.trim());
  return m ? `${m[1]}T${m[2]}` : undefined;
}

function startDate(m: Record<string, unknown>): string | undefined {
  const raw = toNumber(m.start_date_local_raw);
  if (raw !== undefined) {
    // Epoch seconds of the local wall-clock time: format with UTC getters.
    return new Date(raw * 1000).toISOString().slice(0, 19);
  }
  return wallClock(m.start_date_local) ?? wallClock(m.start_time);
}

function distanceM(m: Record<string, unknown>): number | undefined {
  if (present(m.distance_raw)) return toNumber(m.distance_raw);
  const d = m.distance;
  if (typeof d === 'number') return Number.isFinite(d) ? d : undefined;
  if (typeof d === 'string') {
    // A display string in km (e.g. "10.02") when no raw field is given.
    const km = toNumber(d);
    return km === undefined ? undefined : Math.round(km * 1000 * 1000) / 1000;
  }
  return undefined;
}

function workoutType(v: unknown): string | null {
  if (typeof v === 'string' && v !== '') return v;
  if (typeof v === 'number') return RUN_WORKOUT_TYPES[v] ?? null;
  return null;
}

function normalizeModel(m: Record<string, unknown>) {
  const movingTimeSec = toSeconds(firstPresent(m, ['moving_time_raw', 'moving_time']));
  const type = firstPresent(m, ['sport_type', 'type', 'display_type']);
  return {
    id: toNumber(m.id),
    name: typeof m.name === 'string' ? m.name : '',
    type: typeof type === 'string' ? type : undefined,
    startDate: startDate(m),
    distanceM: distanceM(m),
    movingTimeSec,
    elapsedTimeSec: toSeconds(firstPresent(m, ['elapsed_time_raw', 'elapsed_time'])) ?? movingTimeSec,
    elevationGainM: toNumber(firstPresent(m, ['elevation_gain_raw', 'total_elevation_gain'])) ?? 0,
    workoutType: workoutType(m.workout_type),
  };
}

/** Parses a `/athlete/training_activities` JSON body into summaries. */
export function parseTrainingActivities(raw: string): ActivitySummary[] {
  const parsed = TrainingActivitiesResponse.safeParse(parseJsonBody(raw));
  if (!parsed.success) {
    throw formatError('Unexpected Strava activity list shape', parsed.error.issues, raw);
  }
  const models = Array.isArray(parsed.data) ? parsed.data : parsed.data.models;
  return models.map((m, i) => {
    const r = ActivitySummarySchema.safeParse(normalizeModel(m));
    if (!r.success) {
      const issues = r.error.issues.map((iss) => ({ ...iss, path: ['models', i, ...iss.path] }));
      throw formatError(`Unexpected Strava activity shape at index ${i}`, issues, raw);
    }
    return r.data;
  });
}

// ------------------------------------------------------------------- streams

const NumberStream = z.array(z.number());
const MovingStream = z.array(z.union([z.boolean(), z.number()])).transform((a) => a.map(Boolean));

const StreamsObject = z.object({
  time: NumberStream.optional(),
  distance: NumberStream.optional(),
  heartrate: NumberStream.optional(),
  cadence: NumberStream.optional(),
  altitude: NumberStream.optional(),
  velocity_smooth: NumberStream.optional(),
  moving: MovingStream.optional(),
});

const StreamsArray = z.array(z.object({ type: z.string(), data: z.unknown() }));

const EMPTY_STREAMS = (): Streams => ({ time: [] });

/** Parses a `/activities/{id}/streams` body. Empty body or no time stream → { time: [] }. */
export function parseStreams(raw: string): Streams {
  if (raw.trim() === '') return EMPTY_STREAMS();
  let body = parseJsonBody(raw);
  if (body === null) return EMPTY_STREAMS();

  if (Array.isArray(body)) {
    const arr = StreamsArray.safeParse(body);
    if (!arr.success) throw formatError('Unexpected Strava streams shape', arr.error.issues, raw);
    body = Object.fromEntries(arr.data.map((s) => [s.type, s.data]));
  }

  const r = StreamsObject.safeParse(body);
  if (!r.success) throw formatError('Unexpected Strava streams shape', r.error.issues, raw);
  if (!r.data.time) return EMPTY_STREAMS();

  const out: Streams = { time: r.data.time };
  for (const k of ['distance', 'heartrate', 'cadence', 'altitude', 'velocity_smooth'] as const) {
    const v = r.data[k];
    if (v) out[k] = v;
  }
  if (r.data.moving) out.moving = r.data.moving;
  return out;
}
