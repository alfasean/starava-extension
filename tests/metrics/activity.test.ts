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
    expect(aerobicDecoupling(base)).toBe(aerobicDecoupling(ref));
  });
});

describe('trimp', () => {
  it('is ~50.14 for HR 120 over an hour', () => {
    const s = buildStreams({ seconds: 3600, speedMps: 3, hr: 120 });
    expect(trimp(s, { maxHr: 190, restHr: 50 })).toBeCloseTo(50.14, 0);
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
  it('CV is 0 for constant speed', () => {
    expect(paceVariability(buildStreams({ seconds: 100, speedMps: 3 }))).toBe(0);
  });
  it('CV null without speed source', () => {
    expect(paceVariability({ time: [0, 1, 2] })).toBeNull();
  });
});
