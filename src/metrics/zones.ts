import type { Streams } from '../strava/types';
import { movingIntervals } from './samples';

const ZONE_START_FRACTIONS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

/** Six bounds (Z1 lower .. Z5 upper) from heart-rate reserve percentages. */
export function hrZoneBounds(maxHr: number, restHr: number): number[] {
  const reserve = maxHr - restHr;
  return ZONE_START_FRACTIONS.map((f) => Math.round(restHr + f * reserve));
}

export function zoneIndex(hr: number, bounds: number[]): 0 | 1 | 2 | 3 | 4 {
  for (let z = 4; z >= 1; z--) {
    if (hr >= bounds[z]) return z as 1 | 2 | 3 | 4;
  }
  return 0;
}

/** Percentage of moving time in each of the 5 zones (1 dp), or null without HR / moving time. */
export function zoneDistribution(s: Streams, bounds: number[]): number[] | null {
  const hr = s.heartrate;
  if (!hr) return null;
  const secs = [0, 0, 0, 0, 0];
  let total = 0;
  for (const { i, dt } of movingIntervals(s)) {
    const v = hr[i];
    if (typeof v !== 'number' || Number.isNaN(v)) continue;
    secs[zoneIndex(v, bounds)] += dt;
    total += dt;
  }
  if (total === 0) return null;
  return secs.map((x) => Math.round((x / total) * 1000) / 10);
}
