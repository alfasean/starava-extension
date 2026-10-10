import type { Streams } from '../strava/types';
import type { AthleteProfile } from '../settings/types';
import { movingIntervals } from './samples';

const round = (x: number, dp: number): number => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v);

/** Speed (m/s) for interval i: velocity_smooth if present, else Δdistance/Δt; null if no source. */
function speedAt(s: Streams, i: number, dt: number): number | null {
  if (s.velocity_smooth && s.velocity_smooth.length > 0) {
    const v = s.velocity_smooth[i];
    return isNum(v) ? v : null;
  }
  if (s.distance && s.distance.length > 0) {
    const a = s.distance[i];
    const b = s.distance[i - 1];
    return isNum(a) && isNum(b) ? (a - b) / dt : null;
  }
  return null;
}

function hasSpeedSource(s: Streams): boolean {
  return (s.velocity_smooth?.length ?? 0) > 0 || (s.distance?.length ?? 0) > 0;
}

/** Aerobic decoupling %: (first - second) / first of speed/HR, halves split by moving time. */
export function aerobicDecoupling(s: Streams): number | null {
  const hr = s.heartrate;
  if (!hr || hr.length === 0 || !hasSpeedSource(s)) return null;
  const pts: Array<{ dt: number; v: number; h: number }> = [];
  for (const { i, dt } of movingIntervals(s)) {
    const v = speedAt(s, i, dt);
    const h = hr[i];
    if (v === null || !isNum(h)) continue;
    pts.push({ dt, v, h });
  }
  const total = pts.reduce((a, p) => a + p.dt, 0);
  if (total < 600) return null;
  const acc = [
    { t: 0, v: 0, h: 0 },
    { t: 0, v: 0, h: 0 },
  ];
  let cum = 0;
  for (const p of pts) {
    const half = cum + p.dt / 2 < total / 2 ? 0 : 1;
    acc[half].t += p.dt;
    acc[half].v += p.v * p.dt;
    acc[half].h += p.h * p.dt;
    cum += p.dt;
  }
  if (acc[0].t === 0 || acc[1].t === 0) return null;
  const ratio = (a: { t: number; v: number; h: number }) => a.v / a.t / (a.h / a.t);
  const first = ratio(acc[0]);
  const second = ratio(acc[1]);
  if (!Number.isFinite(first) || !Number.isFinite(second) || first === 0) return null;
  return round(((first - second) / first) * 100, 2);
}

/** Coefficient of variation of moving speed (dt-weighted), 3 dp. */
export function paceVariability(s: Streams): number | null {
  if (!hasSpeedSource(s)) return null;
  let t = 0;
  let sum = 0;
  const pts: Array<{ dt: number; v: number }> = [];
  for (const { i, dt } of movingIntervals(s)) {
    const v = speedAt(s, i, dt);
    if (v === null) continue;
    pts.push({ dt, v });
    t += dt;
    sum += v * dt;
  }
  if (t === 0) return null;
  const mean = sum / t;
  if (mean === 0) return null;
  const variance = pts.reduce((a, p) => a + p.dt * (p.v - mean) ** 2, 0) / t;
  return round(Math.sqrt(variance) / mean, 3);
}

/** Cadence in steps/min (value × 2): dt-weighted mean and std-dev over moving samples, 1 dp. */
export function cadenceStats(s: Streams): { meanSpm: number; sdSpm: number } | null {
  const c = s.cadence;
  if (!c || c.length === 0) return null;
  let t = 0;
  let sum = 0;
  const pts: Array<{ dt: number; v: number }> = [];
  for (const { i, dt } of movingIntervals(s)) {
    if (!isNum(c[i])) continue;
    const v = c[i] * 2;
    pts.push({ dt, v });
    t += dt;
    sum += v * dt;
  }
  if (t === 0) return null;
  const mean = sum / t;
  const variance = pts.reduce((a, p) => a + p.dt * (p.v - mean) ** 2, 0) / t;
  return { meanSpm: round(mean, 1), sdSpm: round(Math.sqrt(variance), 1) };
}

/** Banister TRIMP over moving intervals, 1 dp. */
export function trimp(s: Streams, p: AthleteProfile): number | null {
  const hr = s.heartrate;
  if (!hr || hr.length === 0) return null;
  const reserve = p.maxHr - p.restHr;
  if (!(reserve > 0)) return null;
  let total = 0;
  for (const { i, dt } of movingIntervals(s)) {
    if (!isNum(hr[i])) continue;
    const r = Math.min(1, Math.max(0, (hr[i] - p.restHr) / reserve));
    total += (dt / 60) * r * 0.64 * Math.exp(1.92 * r);
  }
  return round(total, 1);
}
