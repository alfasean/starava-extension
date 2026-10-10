import type { Streams } from '../strava/types';

export const MAX_GAP_SEC = 30;
export const MOVING_SPEED_MPS = 0.5;

/**
 * Intervals (i >= 1) that count as moving time. dt = time[i] - time[i-1].
 * Moving when moving[i] is true, else (no moving stream) velocity_smooth[i] > 0.5,
 * else always. Gaps longer than 30 s are never moving.
 */
export function movingIntervals(s: Streams): Array<{ i: number; dt: number }> {
  const out: Array<{ i: number; dt: number }> = [];
  for (let i = 1; i < s.time.length; i++) {
    const dt = s.time[i] - s.time[i - 1];
    if (!(dt > 0) || dt > MAX_GAP_SEC) continue;
    let isMoving = true;
    if (s.moving) isMoving = s.moving[i] === true;
    else if (s.velocity_smooth) isMoving = s.velocity_smooth[i] > MOVING_SPEED_MPS;
    if (isMoving) out.push({ i, dt });
  }
  return out;
}
