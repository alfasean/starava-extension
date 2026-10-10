import { computeSplits } from '../../src/metrics/splits';
import { buildStreams } from './helpers';

const V = 1000 / 300;

describe('computeSplits', () => {
  it('makes 3 full splits plus a 500 m remainder', () => {
    const s = buildStreams({ seconds: 1050, speedMps: V, cadence: 85, hr: 150, altitudeFn: (_t, d) => d / 100 });
    const sp = computeSplits(s);
    expect(sp).toHaveLength(4);
    sp.slice(0, 3).forEach((x, k) => {
      expect(x.km).toBe(k + 1);
      expect(Math.abs(x.paceSecPerKm - 300)).toBeLessThanOrEqual(1);
    });
    expect(sp[3].distanceM).toBeCloseTo(500, 0);
    expect(Math.abs(sp[3].paceSecPerKm - 300)).toBeLessThanOrEqual(1);
    expect(sp[0].avgCadenceSpm).toBe(170);
    expect(sp[0].avgHr).toBe(150);
    expect(sp[0].elevDeltaM).toBeCloseTo(10, 0);
  });

  it('excludes stopped time from pace', () => {
    const s = buildStreams({ seconds: 1170, speedMps: V, stopped: [[400, 520]] });
    const sp = computeSplits(s);
    expect(sp).toHaveLength(4);
    expect(Math.abs(sp[1].paceSecPerKm - 300)).toBeLessThanOrEqual(1);
  });

  it('gives one split for a 600 m run and none without distance', () => {
    const sp = computeSplits(buildStreams({ seconds: 180, speedMps: V }));
    expect(sp).toHaveLength(1);
    expect(sp[0].distanceM).toBeCloseTo(600, 0);
    expect(computeSplits({ time: [0, 1, 2] })).toEqual([]);
  });

  it('nulls missing optional streams', () => {
    const sp = computeSplits(buildStreams({ seconds: 300, speedMps: V }));
    expect(sp[0].avgHr).toBeNull();
    expect(sp[0].avgCadenceSpm).toBeNull();
    expect(sp[0].elevDeltaM).toBeNull();
  });
});
