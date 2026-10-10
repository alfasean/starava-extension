import type { ActivitySummary, Streams } from '../strava/types';
import type { AthleteProfile } from '../settings/types';
import { aerobicDecoupling, cadenceStats, paceVariability, trimp } from './activity';
import { movingIntervals } from './samples';
import { computeSplits, type Split } from './splits';
import { hrZoneBounds, zoneDistribution } from './zones';

export interface ActivityAnalysis {
  summary: {
    id: number;
    name: string;
    date: string;
    distanceKm: number;
    movingTimeSec: number;
    avgPaceSecPerKm: number;
    elevationGainM: number;
    workoutType: string | null;
    avgHr: number | null;
  };
  splits: Split[];
  hrZonesPct: number[] | null;
  decouplingPct: number | null;
  paceCv: number | null;
  cadence: { meanSpm: number; sdSpm: number } | null;
  trimp: number | null;
  missing: Array<'heartrate' | 'cadence' | 'distance' | 'altitude' | 'velocity_smooth'>;
}

const STREAM_KEYS = ['heartrate', 'cadence', 'distance', 'altitude', 'velocity_smooth'] as const;

function meanMovingHr(s: Streams): number | null {
  const hr = s.heartrate;
  if (!hr) return null;
  let t = 0;
  let sum = 0;
  for (const { i, dt } of movingIntervals(s)) {
    if (typeof hr[i] !== 'number' || Number.isNaN(hr[i])) continue;
    t += dt;
    sum += hr[i] * dt;
  }
  return t === 0 ? null : Math.round(sum / t);
}

export function analyzeActivity(a: ActivitySummary, s: Streams, p: AthleteProfile): ActivityAnalysis {
  const distanceKm = Math.round((a.distanceM / 1000) * 100) / 100;
  return {
    summary: {
      id: a.id,
      name: a.name,
      date: a.startDate,
      distanceKm,
      movingTimeSec: a.movingTimeSec,
      avgPaceSecPerKm: distanceKm > 0 ? Math.round(a.movingTimeSec / distanceKm) : 0,
      elevationGainM: a.elevationGainM,
      workoutType: a.workoutType,
      avgHr: meanMovingHr(s),
    },
    splits: computeSplits(s),
    hrZonesPct: zoneDistribution(s, hrZoneBounds(p.maxHr, p.restHr)),
    decouplingPct: aerobicDecoupling(s),
    paceCv: paceVariability(s),
    cadence: cadenceStats(s),
    trimp: trimp(s, p),
    missing: STREAM_KEYS.filter((k) => (s[k]?.length ?? 0) === 0),
  };
}
