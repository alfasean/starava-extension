// TEMPORARY: Strava endpoint probe. Removed in Task 2 Step 6.
export interface ProbeEntry {
  mode: 'extension' | 'content-script';
  name: string;
  url: string;
  status: number;
  finalUrl: string;
  redirected: boolean;
  contentType: string;
  body: string;
  error?: string;
}
export type RawResult = Omit<ProbeEntry, 'mode' | 'name'>;

const MAX_BODY = 2 * 1024 * 1024;
const BASE = 'https://www.strava.com';
const STREAM_TYPES = ['time', 'distance', 'heartrate', 'cadence', 'altitude', 'velocity_smooth', 'moving'];

export const probeFetch = async (url: string): Promise<RawResult> => {
  try {
    const r = await fetch(url, {
      credentials: 'include',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    let body = await r.text();
    if (body.length > MAX_BODY) body = body.slice(0, MAX_BODY) + '\n[TRUNCATED]';
    return {
      url,
      status: r.status,
      finalUrl: r.url,
      redirected: r.redirected,
      contentType: r.headers.get('content-type') ?? '',
      body,
    };
  } catch (e) {
    return { url, status: 0, finalUrl: '', redirected: false, contentType: '', body: '', error: String(e) };
  }
};

type Fetcher = (url: string) => Promise<RawResult>;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const contentScriptFetcher: Fetcher = async (url) => {
  const empty = { url, status: 0, finalUrl: '', redirected: false, contentType: '', body: '' };
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url?.startsWith(BASE)) {
      return { ...empty, error: 'No active strava.com tab' };
    }
    const res = await chrome.tabs.sendMessage(tab.id, { type: 'probe-fetch', url });
    return res ?? { ...empty, error: 'No response from content script (reload the Strava tab?)' };
  } catch (e) {
    return { ...empty, error: String(e) };
  }
};

export const parseRunIds = (body: string, max = 2): string[] => {
  try {
    const json = JSON.parse(body);
    const arr: unknown[] = Array.isArray(json)
      ? json
      : ((['models', 'activities', 'data', 'entries'].map((k) => json?.[k]).find(Array.isArray) as unknown[]) ?? []);
    const ids: string[] = [];
    for (const a of arr as Record<string, unknown>[]) {
      const type = String(a?.type ?? a?.sport_type ?? a?.activity_type ?? '');
      if (/run/i.test(type) && a?.id != null) ids.push(String(a.id));
      if (ids.length >= max) break;
    }
    return ids;
  } catch {
    return [];
  }
};

export const runProbe = async (
  providedIds: string[],
  onProgress?: (e: ProbeEntry) => void,
): Promise<ProbeEntry[]> => {
  const out: ProbeEntry[] = [];
  const modes: [ProbeEntry['mode'], Fetcher][] = [
    ['extension', probeFetch],
    ['content-script', contentScriptFetcher],
  ];
  let first = true;
  for (const [mode, fetcher] of modes) {
    const run = async (name: string, url: string) => {
      if (!first) await sleep(500);
      first = false;
      const e: ProbeEntry = { mode, name, ...(await fetcher(url)) };
      out.push(e);
      onProgress?.(e);
      return e;
    };
    const list = await run('training_activities', `${BASE}/athlete/training_activities?page=1&per_page=20`);
    const ids = providedIds.length ? providedIds : parseRunIds(list.body);
    const qs = STREAM_TYPES.map((t) => `stream_types[]=${t}`).join('&');
    for (const id of ids) await run(`streams:${id}`, `${BASE}/activities/${id}/streams?${qs}`);
    if (ids[0]) await run(`detail:${ids[0]}`, `${BASE}/activities/${ids[0]}`);
  }
  return out;
};

export const downloadJson = (data: unknown) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `strava-probe-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
