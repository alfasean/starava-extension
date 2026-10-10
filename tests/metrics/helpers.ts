import type { Streams } from '../../src/strava/types';

export interface BuildOpts {
  seconds: number;
  speedMps: number;
  hr?: number | ((t: number) => number);
  cadence?: number | ((t: number) => number);
  altitudeFn?: (t: number, distance: number) => number;
  /** Stopped blocks (start, end]: speed 0, moving=false, distance flat. */
  stopped?: Array<[number, number]>;
}

/** Synthetic 1 Hz streams with samples at t = 0..seconds. */
export function buildStreams(o: BuildOpts): Streams {
  const s: Streams = { time: [], distance: [], velocity_smooth: [], moving: [] };
  if (o.hr !== undefined) s.heartrate = [];
  if (o.cadence !== undefined) s.cadence = [];
  if (o.altitudeFn) s.altitude = [];
  const val = (v: number | ((t: number) => number), t: number) => (typeof v === 'function' ? v(t) : v);
  let d = 0;
  for (let t = 0; t <= o.seconds; t++) {
    const stopped = (o.stopped ?? []).some(([a, b]) => t > a && t <= b);
    if (t > 0 && !stopped) d += o.speedMps;
    s.time.push(t);
    s.distance!.push(d);
    s.velocity_smooth!.push(stopped ? 0 : o.speedMps);
    s.moving!.push(!stopped);
    s.heartrate?.push(val(o.hr!, t));
    s.cadence?.push(val(o.cadence!, t));
    s.altitude?.push(o.altitudeFn!(t, d));
  }
  return s;
}
