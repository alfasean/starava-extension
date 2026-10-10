import { describe, expect, it } from 'vitest';
import { aerobicDecoupling, cadenceStats, paceVariability, trimp } from '../../src/metrics/activity';
import { buildStreams } from './helpers';

describe('aerobicDecoupling', () => {
  it('computes ~9.09% for HR 150 -> 165 at constant speed', () => {
    const s = buildStreams({ seconds: 1200, speedMps: 3, hr: (t) => (t <= 600 ? 150 : 165) });
    expect(aerobicDecoupling(s)).toBeCloseTo(9.09, 1);
  });
  it('is null for a 300 s run', () => {
    expect(aerobicDecoupling(buildStreams({ seconds: 300, speedMps: 3, hr: 150 }))).toBeNull();
  });
  it('is null without HR', () => {
    expect(aerobicDecoupling(buildStreams({ seconds: 1200, speedMps: 3 }))).toBeNull();
  });
  it('ignores stopped blocks', () => {
    const hr = (t: number) => (t > 1000 && t <= 1100 ? 100 : t <= 600 ? 150 : 165);
    const base = buildStreams({ seconds: 1300, speedMps: 3, hr, stopped: [[1000, 1100]] });
    const ref = buildStreams({ seconds: 1300, speedMps: 3, hr: (t) => (t <= 600 ? 150 : 165), stopped: [[1000, 1100]] });
    expect(aerobicDecoupling(base)).not.toBeNull();
    expect(aerobicDecoupling(base)).toBeCloseTo(9.09, 1);
    expect(aerobicDecoupling(base)).toBe(aerobicDecoupling(ref));
  });
});

describe('trimp', () => {
  it('is ~50.14 for HR 120 over an hour', () => {
    const s = buildStreams({ seconds: 3600, speedMps: 3, hr: 120 });
    expect(Math.abs((trimp(s, { maxHr: 190, restHr: 50 }) as number) - 50.14)).toBeLessThanOrEqual(0.1);
  });
  it('is null without HR', () => {
    expect(trimp(buildStreams({ seconds: 100, speedMps: 3 }), { maxHr: 190, restHr: 50 })).toBeNull();
  });
});

describe('cadenceStats / paceVariability', () => {
  it('doubles cadence to spm', () => {
    const s = buildStreams({ seconds: 100, speedMps: 3, cadence: 85 });
    expect(cadenceStats(s)).toEqual({ meanSpm: 170, sdSpm: 0 });
  });
  it('cadence null when absent', () => {
    expect(cadenceStats(buildStreams({ seconds: 100, speedMps: 3 }))).toBeNull();
  });
  it('CV is non-zero for varying speed', () => {
    const s = buildStreams({ seconds: 100, speedMps: 3 });
    s.velocity_smooth = s.velocity_smooth!.map((_, i) => (i % 2 === 0 ? 2 : 4));
    // moving samples alternate 4,2 (i>=1): mean 3, sd 1 -> CV ~0.333
    expect(paceVariability(s)).toBeCloseTo(0.333, 2);
  });
  it('cadence sd is non-zero for varying cadence', () => {
    const s = buildStreams({ seconds: 100, speedMps: 3, cadence: (t) => (t % 2 === 0 ? 80 : 90) });
    const r = cadenceStats(s)!;
    expect(r.meanSpm).toBeCloseTo(170, 0);
    expect(r.sdSpm).toBeCloseTo(10, 0);
  });
  it('CV is 0 for constant speed', () => {
    expect(paceVariability(buildStreams({ seconds: 100, speedMps: 3 }))).toBe(0);
  });
  it('CV null without speed source', () => {
    expect(paceVariability({ time: [0, 1, 2] })).toBeNull();
  });
});
