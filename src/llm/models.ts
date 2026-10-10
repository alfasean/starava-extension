import type { ProviderId } from '../settings/types';
import { LlmHttpError } from './errors';

/** Trims, strips trailing slashes and appends `/v1` unless the URL already ends with it. */
export function normalizeOpenAiBaseUrl(url: string): string {
  const base = url.trim().replace(/\/+$/, '');
  return /\/v1$/i.test(base) ? base : `${base}/v1`;
}

export interface ListModelsOptions {
  /** Already-normalized API base, e.g. https://your-gateway.example/v1 */
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  signal?: AbortSignal;
  provider?: ProviderId;
}

const UNREADABLE = 'Could not read the model list from the gateway';

export async function listModels(o: ListModelsOptions): Promise<string[]> {
  const f = o.fetch ?? fetch;
  const res = await f(`${o.baseUrl.replace(/\/+$/, '')}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${o.apiKey}` },
    signal: o.signal,
  });
  if (!res.ok) {
    throw new LlmHttpError(o.provider ?? 'openai-compatible', res.status, await res.text().catch(() => ''));
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new Error(UNREADABLE);
  }
  const list = Array.isArray(json) ? json : (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(list)) throw new Error(UNREADABLE);
  const ids = list
    .map((m) => (m as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids)].sort();
}
