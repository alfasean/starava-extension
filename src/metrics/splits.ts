import type { Streams } from '../strava/types';
import { movingIntervals } from './samples';

export interface Split {
  km: number;
  distanceM: number;
  timeSec: number;
  paceSecPerKm: number;
  avgHr: number | null;
  avgCadenceSpm: number | null;
  elevDeltaM: number | null;
}

const SPLIT_M = 1000;
const MIN_TRAILING_M = 50;
const EPS = 1e-6;

export function computeSplits(s: Streams): Split[] {
  const dist = s.distance;
  if (!dist || dist.length < 2) return [];
  const movingDt = new Map<number, number>();
  for (const { i, dt } of movingIntervals(s)) movingDt.set(i, dt);

  const splits: Split[] = [];
  let startIdx = 0;
  let timeSec = 0;
  let hrW = 0, hrT = 0, cadW = 0, cadT = 0;

  const close = (endIdx: number) => {
    const distanceM = dist[endIdx] - dist[startIdx];
    const alt = s.altitude;
    const elev = alt && alt[endIdx] != null && alt[startIdx] != null
      ? Math.round((alt[endIdx] - alt[startIdx]) * 10) / 10
      : null;
    splits.push({
      km: splits.length + 1,
      distanceM: Math.round(distanceM * 10) / 10,
      timeSec: Math.round(timeSec * 10) / 10,
      paceSecPerKm: timeSec > 0 && distanceM > 0 ? Math.round(timeSec / (distanceM / 1000)) : 0,
      avgHr: hrT > 0 ? Math.round(hrW / hrT) : null,
      avgCadenceSpm: cadT > 0 ? Math.round((cadW / cadT) * 2) : null,
      elevDeltaM: elev,
    });
    startIdx = endIdx;
    timeSec = 0; hrW = 0; hrT = 0; cadW = 0; cadT = 0;
  };

  for (let i = 1; i < dist.length; i++) {
    const dt = movingDt.get(i);
    if (dt !== undefined) {
      timeSec += dt;
      const h = s.heartrate?.[i];
      if (typeof h === 'number' && !Number.isNaN(h)) { hrW += h * dt; hrT += dt; }
      const c = s.cadence?.[i];
      if (typeof c === 'number' && !Number.isNaN(c)) { cadW += c * dt; cadT += dt; }
    }
    if (dist[i] >= (splits.length + 1) * SPLIT_M - EPS) close(i);
  }

  const last = dist.length - 1;
  const rest = dist[last] - dist[startIdx];
  if (startIdx < last && rest > 0 && (splits.length === 0 || rest >= MIN_TRAILING_M)) close(last);
  return splits;
}
