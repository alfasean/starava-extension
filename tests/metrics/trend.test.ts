import { describe, expect, it } from 'vitest';
import { weeklyTrend, type TrendInput } from '../../src/metrics/trend';
import type { ActivitySummary } from '../../src/strava/types';
import type { AthleteProfile } from '../../src/settings/types';
import { buildStreams } from './helpers';

const P: AthleteProfile = { maxHr: 190, restHr: 50 };
const NOW = new Date('2026-10-10T12:00:00'); // Saturday, local time

let nextId = 1;
function run(startDate: string, km: number, withStreams = true, hr = 150): TrendInput {
  const summary: ActivitySummary = {
    id: nextId++,
    name: 'Run',
    type: 'Run',
    startDate,
    distanceM: km * 1000,
    movingTimeSec: Math.round(km * 360),
    elapsedTimeSec: Math.round(km * 360),
    elevationGainM: 0,
    workoutType: null,
  };
  return { summary, streams: withStreams ? buildStreams({ seconds: 1800, speedMps: 3, hr }) : null };
}

describe('weeklyTrend', () => {
  it('aggregates runs, km and longest run in the current week', () => {
    const out = weeklyTrend([run('2026-10-06T07:00:00', 5), run('2026-10-08T07:00:00', 10)], P, 4, NOW);
    const last = out[out.length - 1];
    expect(last.weekStart).toBe('2026-10-05');
    expect(last.runs).toBe(2);
    expect(last.km).toBe(15);
    expect(last.longestRunKm).toBe(10);
  });

  it('returns the requested number of weeks, oldest first', () => {
    const out = weeklyTrend([], P, 4, NOW);
    expect(out).toHaveLength(4);
    expect(out[0].weekStart).toBe('2026-09-14');
  });

  it('counts runs without streams and adds zero TRIMP', () => {
    const out = weeklyTrend([run('2026-10-06T07:00:00', 5, false)], P, 2, NOW);
    const last = out[out.length - 1];
    expect(last.runs).toBe(1);
    expect(last.km).toBe(5);
    expect(last.runsWithoutHr).toBe(1);
    expect(last.trimp).toBe(0);
    expect(last.acwr).toBeNull();
  });

  it('gives an ACWR of about 1 for constant weekly load', () => {
    const items = ['2026-10-07', '2026-09-30', '2026-09-23', '2026-09-16', '2026-09-09', '2026-09-02'].map((d) =>
      run(`${d}T07:00:00`, 8),
    );
    const out = weeklyTrend(items, P, 2, NOW);
    expect(out[out.length - 1].acwr).toBeCloseTo(1, 1);
  });

  it('ignores future activities and uses pre-window activities only for ACWR history', () => {
    const out = weeklyTrend([run('2026-10-11T07:00:00', 5), run('2026-09-01T07:00:00', 5)], P, 2, NOW);
    expect(out.reduce((a, w) => a + w.runs, 0)).toBe(0);
  });

  it('computes aerobic efficiency pace from Z2 samples', () => {
    // Z2 for 190/50: 134..147 bpm; hr 140 at 3 m/s -> 333 s/km
    const out = weeklyTrend([run('2026-10-06T07:00:00', 5, true, 140)], P, 1, NOW);
    expect(out[0].aerobicEfficiencyPaceSecPerKm).toBe(333);
    const none = weeklyTrend([run('2026-10-06T07:00:00', 5, true, 170)], P, 1, NOW);
    expect(none[0].aerobicEfficiencyPaceSecPerKm).toBeNull();
  });
});
