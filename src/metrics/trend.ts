import type { ActivitySummary, Streams } from '../strava/types';
import type { AthleteProfile } from '../settings/types';
import { trimp } from './activity';
import { movingIntervals } from './samples';
import { hrZoneBounds, zoneIndex } from './zones';

export interface TrendInput {
  summary: ActivitySummary;
  streams: Streams | null;
}

export interface WeekTrend {
  weekStart: string; // local YYYY-MM-DD of the Monday
  runs: number;
  km: number;
  timeSec: number;
  longestRunKm: number;
  trimp: number;
  acwr: number | null;
  aerobicEfficiencyPaceSecPerKm: number | null;
  runsWithoutHr: number;
}

const DAY_MS = 86_400_000;

const round = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return m;
}

function fmtDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Z2 (index 1) moving seconds and distance-weighted speed accumulation: returns [sumSpeed*dt, sumDt]. */
function z2Speed(s: Streams, bounds: number[]): [number, number] {
  const hr = s.heartrate;
  if (!hr) return [0, 0];
  let weighted = 0;
  let secs = 0;
  for (const { i, dt } of movingIntervals(s)) {
    const h = hr[i];
    if (typeof h !== 'number' || Number.isNaN(h) || zoneIndex(h, bounds) !== 1) continue;
    let v: number | undefined = s.velocity_smooth?.[i];
    if (typeof v !== 'number' || Number.isNaN(v)) {
      const d = s.distance;
      v = d ? (d[i] - d[i - 1]) / dt : undefined;
    }
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    weighted += v * dt;
    secs += dt;
  }
  return [weighted, secs];
}

export function weeklyTrend(items: TrendInput[], p: AthleteProfile, weeks: number, now: Date): WeekTrend[] {
  const bounds = hrZoneBounds(p.maxHr, p.restHr);
  const nowMs = now.getTime();
  const acts = items
    .map((it) => ({ it, t: new Date(it.summary.startDate).getTime() }))
    .filter((a) => !Number.isNaN(a.t) && a.t <= nowMs)
    .map((a) => ({ ...a, load: a.it.streams ? (trimp(a.it.streams, p) ?? 0) : 0 }));

  const loadIn = (fromExcl: number, toIncl: number): number =>
    acts.reduce((sum, a) => (a.t > fromExcl && a.t <= toIncl ? sum + a.load : sum), 0);

  const currentStart = mondayOf(now);
  const out: WeekTrend[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const start = new Date(currentStart);
    start.setDate(start.getDate() - 7 * k);
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const inWeek = acts.filter((a) => a.t >= startMs && a.t < endMs);

    let km = 0;
    let timeSec = 0;
    let longest = 0;
    let load = 0;
    let withoutHr = 0;
    let wSpeed = 0;
    let wSecs = 0;
    for (const a of inWeek) {
      const dKm = a.it.summary.distanceM / 1000;
      km += dKm;
      timeSec += a.it.summary.movingTimeSec;
      longest = Math.max(longest, dKm);
      load += a.load;
      const hr = a.it.streams?.heartrate;
      if (!a.it.streams || !hr || hr.length === 0) withoutHr++;
      if (a.it.streams) {
        const [w, s] = z2Speed(a.it.streams, bounds);
        wSpeed += w;
        wSecs += s;
      }
    }

    const asOf = Math.min(endMs, nowMs);
    const acute = loadIn(asOf - 7 * DAY_MS, asOf);
    const chronic = loadIn(asOf - 28 * DAY_MS, asOf) / 4;
    const avgSpeed = wSecs > 0 ? wSpeed / wSecs : 0;

    out.push({
      weekStart: fmtDate(start),
      runs: inWeek.length,
      km: round(km, 2),
      timeSec,
      longestRunKm: round(longest, 2),
      trimp: round(load, 1),
      acwr: chronic > 0 ? round(acute / chronic, 2) : null,
      aerobicEfficiencyPaceSecPerKm: avgSpeed > 0 ? Math.round(1000 / avgSpeed) : null,
      runsWithoutHr: withoutHr,
    });
  }
  return out;
}
