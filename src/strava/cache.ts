import { openDB, type IDBPDatabase } from 'idb';
import type { ActivitySummary, StravaSource, Streams } from './types';

const LIST_TTL_MS = 5 * 60_000;

interface ListEntry {
  at: number;
  items: ActivitySummary[];
}

export function createCachedSource(
  inner: StravaSource,
  o: { dbName?: string; now?: () => number } = {},
): StravaSource {
  const dbName = o.dbName ?? 'strava-cache';
  const now = o.now ?? Date.now;

  let dbPromise: Promise<IDBPDatabase> | null = null;
  const db = () => {
    dbPromise ??= openDB(dbName, 1, {
      upgrade(d) {
        d.createObjectStore('streams');
        d.createObjectStore('activities');
        d.createObjectStore('lists');
      },
    });
    return dbPromise;
  };

  return {
    async listActivities(opts, signal) {
      const key = `${opts.page}:${opts.perPage}`;
      const d = await db();
      const hit = (await d.get('lists', key)) as ListEntry | undefined;
      if (hit && now() - hit.at <= LIST_TTL_MS) return hit.items;

      const items = await inner.listActivities(opts, signal);
      const tx = d.transaction(['lists', 'activities'], 'readwrite');
      tx.objectStore('lists').put({ at: now(), items } satisfies ListEntry, key);
      for (const a of items) tx.objectStore('activities').put(a, a.id);
      await tx.done;
      return items;
    },

    async getActivity(id, signal) {
      const d = await db();
      const hit = (await d.get('activities', id)) as ActivitySummary | undefined;
      if (hit) return hit;
      const a = await inner.getActivity(id, signal);
      await d.put('activities', a, id);
      return a;
    },

    async getStreams(id, signal) {
      const d = await db();
      const hit = (await d.get('streams', id)) as Streams | undefined;
      if (hit) return hit;
      const s = await inner.getStreams(id, signal);
      if (s.time.length > 0) await d.put('streams', s, id);
      return s;
    },
  };
}
