import { describe, expect, it } from 'vitest';
import { analyzeActivity } from '../../src/metrics/analysis';
import type { ActivitySummary } from '../../src/strava/types';
import { buildStreams } from './helpers';

const act: ActivitySummary = {
  id: 7, name: 'Run', type: 'Run', startDate: '2026-01-02T08:00:00Z',
  distanceM: 3600, movingTimeSec: 1200, elapsedTimeSec: 1200, elevationGainM: 10, workoutType: null,
};
const profile = { maxHr: 190, restHr: 50 };

describe('analyzeActivity', () => {
  it('handles time-only streams', () => {
    const r = analyzeActivity(act, { time: [0, 1, 2] }, profile);
    expect(r.splits).toEqual([]);
    expect(r.hrZonesPct).toBeNull();
    expect(r.decouplingPct).toBeNull();
    expect(r.paceCv).toBeNull();
    expect(r.cadence).toBeNull();
    expect(r.trimp).toBeNull();
    expect(r.summary.avgHr).toBeNull();
    expect(r.missing).toEqual(['heartrate', 'cadence', 'distance', 'altitude', 'velocity_smooth']);
  });
  it('builds summary and metrics from full streams', () => {
    const s = buildStreams({ seconds: 1200, speedMps: 3, hr: 140, cadence: 85, altitudeFn: () => 0 });
    const r = analyzeActivity(act, s, profile);
    expect(r.summary).toMatchObject({
      id: 7, date: act.startDate, distanceKm: 3.6, avgPaceSecPerKm: 333, avgHr: 140, movingTimeSec: 1200,
    });
    expect(r.missing).toEqual([]);
    expect(r.decouplingPct).toBe(0);
    expect(r.hrZonesPct).not.toBeNull();
    expect(r.cadence?.meanSpm).toBe(170);
  });
  it('pace 0 when distance 0', () => {
    const r = analyzeActivity({ ...act, distanceM: 0 }, { time: [] }, profile);
    expect(r.summary.avgPaceSecPerKm).toBe(0);
  });
});
