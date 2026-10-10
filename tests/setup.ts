import 'fake-indexeddb/auto';

type Store = Record<string, unknown>;
let localStore: Store = {};

const storageLocal = {
  async get(keys?: string | string[] | null): Promise<Store> {
    if (keys == null) return { ...localStore };
    const list = Array.isArray(keys) ? keys : [keys];
    const out: Store = {};
    for (const k of list) if (k in localStore) out[k] = localStore[k];
    return out;
  },
  async set(items: Store): Promise<void> {
    Object.assign(localStore, items);
  },
};

const chromeMock = {
  storage: { local: storageLocal },
  __reset() {
    localStore = {};
  },
};

(globalThis as any).chrome = chromeMock;

beforeEach(() => {
  chromeMock.__reset();
});
