import type { Settings } from '../settings/types';
import { createAnthropicAdapter } from './adapters/anthropic';
import { createGeminiAdapter } from './adapters/gemini';
import { createOpenAiAdapter } from './adapters/openai';
import { normalizeOpenAiBaseUrl } from './models';
import type { LlmAdapter } from './types';

export function createAdapter(s: Settings, f?: typeof fetch): LlmAdapter {
  switch (s.provider) {
    case 'openai':
      return createOpenAiAdapter({ apiKey: s.apiKey, model: s.model, fetch: f });
    case 'openai-compatible':
      return createOpenAiAdapter({
        apiKey: s.apiKey,
        model: s.model,
        baseUrl: s.baseUrl,
        fetch: f,
        provider: 'openai-compatible',
      });
    case 'new-api':
      return createOpenAiAdapter({
        apiKey: s.apiKey,
        model: s.model,
        baseUrl: normalizeOpenAiBaseUrl(s.baseUrl ?? ''),
        provider: 'new-api',
        fetch: f,
      });
    case 'anthropic':
      return createAnthropicAdapter({ apiKey: s.apiKey, model: s.model, fetch: f });
    case 'gemini':
      return createGeminiAdapter({ apiKey: s.apiKey, model: s.model, fetch: f });
  }
}
