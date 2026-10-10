/**
 * Strava client over the user's logged-in strava.com web session
 * (`credentials: 'include'`), rate limited and with 429 backoff.
 *
 * NOTE: the endpoints and field mappings are UNVERIFIED against live data.
 * The endpoint probe (Task 2) has not run yet; this targets the candidate
 * internal endpoints and parses defensively (see schemas.ts).
 */
import { StravaAuthError, StravaRateLimitError, abortError, throwIfAborted } from './errors';
import { createRateLimiter } from './rateLimiter';
import { parseStreams, parseTrainingActivities } from './schemas';
import type { ActivitySummary, StravaSource, Streams } from './types';

const DEFAULT_BASE_URL = 'https://www.strava.com';
const BACKOFF_MS = [1000, 2000, 4000];
const STREAM_TYPES = ['time', 'distance', 'heartrate', 'cadence', 'altitude', 'velocity_smooth', 'moving'];
const SCAN_PER_PAGE = 20;
const SCAN_MAX_PAGES = 10;

export interface StravaClientOptions {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  baseUrl?: string;
  /** Defaults to 2 concurrent requests, starts ≥ 300 ms apart. */
  rateLimit?: { maxConcurrent: number; minIntervalMs: number };
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** `sleep` that rejects with AbortError as soon as `signal` aborts. */
function abortableSleep(
  sleep: (ms: number) => Promise<void>,
  ms: number,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (!signal) return sleep(ms);
  return new Promise<void>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    sleep(ms).then(
      () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function isLoginRedirect(res: Response): boolean {
  return res.redirected && /\/(login|session)\b/.test(res.url);
}

function isHtml(res: Response): boolean {
  return (res.headers.get('content-type') ?? '').toLowerCase().includes('text/html');
}

export function createStravaClient(o: StravaClientOptions = {}): StravaSource {
  const doFetch: typeof fetch = o.fetch ?? ((input, init) => fetch(input, init));
  const sleep = o.sleep ?? defaultSleep;
  const baseUrl = (o.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const limit = createRateLimiter(o.rateLimit ?? { maxConcurrent: 2, minIntervalMs: 300 });

  /** Fetches through the limiter, retrying 429s with backoff; checks auth. */
  async function request(url: string, signal?: AbortSignal): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      throwIfAborted(signal);
      const res = await limit(
        () =>
          doFetch(url, {
            credentials: 'include',
            headers: { Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
            signal,
          }),
        signal,
      );
      if (res.status === 429) {
        if (attempt >= BACKOFF_MS.length) throw new StravaRateLimitError();
        await abortableSleep(sleep, BACKOFF_MS[attempt], signal);
        continue;
      }
      if (res.status === 401 || res.status === 403 || isLoginRedirect(res)) {
        throw new StravaAuthError();
      }
      return res;
    }
  }

  function failIfNotOk(res: Response): void {
    if (!res.ok) throw new Error(`Strava request failed with HTTP ${res.status}`);
    if (isHtml(res)) throw new StravaAuthError('Strava returned HTML instead of JSON; not logged in?');
  }

  const source: StravaSource = {
    async listActivities({ page, perPage }, signal) {
      const url = `${baseUrl}/athlete/training_activities?page=${page}&per_page=${perPage}`;
      const res = await request(url, signal);
      failIfNotOk(res);
      const body = await res.text();
      throwIfAborted(signal);
      return parseTrainingActivities(body);
    },

    async getActivity(id, signal): Promise<ActivitySummary> {
      for (let page = 1; page <= SCAN_MAX_PAGES; page++) {
        const items = await source.listActivities({ page, perPage: SCAN_PER_PAGE }, signal);
        const hit = items.find((a) => a.id === id);
        if (hit) return hit;
        if (items.length === 0) break;
      }
      throw new Error(
        `Activity ${id} not found in the ${SCAN_PER_PAGE * SCAN_MAX_PAGES} most recent activities`,
      );
    },

    async getStreams(id, signal): Promise<Streams> {
      const query = STREAM_TYPES.map((t) => `stream_types%5B%5D=${t}`).join('&');
      const res = await request(`${baseUrl}/activities/${id}/streams?${query}`, signal);
      if (res.status === 404) return { time: [] };
      failIfNotOk(res);
      const body = await res.text();
      throwIfAborted(signal);
      return parseStreams(body);
    },
  };
  return source;
}
