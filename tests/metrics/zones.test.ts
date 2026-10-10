import { hrZoneBounds, zoneIndex, zoneDistribution } from '../../src/metrics/zones';
import { movingIntervals } from '../../src/metrics/samples';
import { buildStreams } from './helpers';

const b = hrZoneBounds(190, 50);

describe('hrZoneBounds / zoneIndex', () => {
  it('computes reserve-based bounds', () => {
    expect(b).toEqual([120, 134, 148, 162, 176, 190]);
  });
  it('clamps and classifies', () => {
    expect(zoneIndex(100, b)).toBe(0);
    expect(zoneIndex(150, b)).toBe(2);
    expect(zoneIndex(200, b)).toBe(4);
  });
});

describe('zoneDistribution', () => {
  it('splits moving time by zone', () => {
    const s = buildStreams({ seconds: 200, speedMps: 3, hr: (t) => (t <= 100 ? 125 : 170) });
    expect(zoneDistribution(s, b)).toEqual([50, 0, 0, 50, 0]);
  });
  it('returns null without HR', () => {
    expect(zoneDistribution(buildStreams({ seconds: 60, speedMps: 3 }), b)).toBeNull();
  });
  it('ignores stopped time', () => {
    const s = buildStreams({ seconds: 200, speedMps: 3, hr: 125, stopped: [[50, 150]] });
    expect(zoneDistribution(s, b)).toEqual([100, 0, 0, 0, 0]);
  });
});

describe('movingIntervals', () => {
  it('falls back to velocity, then to always, and drops pause gaps', () => {
    expect(movingIntervals({ time: [0, 1, 2], velocity_smooth: [3, 3, 0.2] })).toEqual([{ i: 1, dt: 1 }]);
    expect(movingIntervals({ time: [0, 1, 2] })).toHaveLength(2);
    expect(movingIntervals({ time: [0, 1, 100] })).toEqual([{ i: 1, dt: 1 }]);
  });
});
