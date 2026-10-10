import { describe, it, expect, vi } from 'vitest';
import { createAdapter } from '../../src/llm';
import type { Settings } from '../../src/settings/types';
import type { LlmRequest } from '../../src/llm/types';

const athlete = { maxHr: 190, restHr: 50 };
const req: LlmRequest = { system: 's', messages: [{ role: 'user', content: 'hi' }], tools: [] };

async function probe(s: Settings) {
  const f = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
  const err: any = await (async () => {
    try {
      for await (const _ of createAdapter(s, f).stream(req));
    } catch (e) {
      return e;
    }
  })();
  return { url: f.mock.calls[0][0] as string, err };
}

describe('createAdapter', () => {
  it('openai uses the default base URL', async () => {
    const { url, err } = await probe({ provider: 'openai', apiKey: 'k', model: 'm', athlete });
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect(err.provider).toBe('openai');
  });

  it('openai-compatible uses baseUrl and its own provider id', async () => {
    const { url, err } = await probe({
      provider: 'openai-compatible',
      apiKey: 'k',
      model: 'm',
      baseUrl: 'http://localhost:1234/v1',
      athlete,
    });
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(err.provider).toBe('openai-compatible');
  });

  it('new-api normalizes the gateway URL and uses its own provider id', async () => {
    const { url, err } = await probe({
      provider: 'new-api',
      apiKey: 'k',
      model: 'm',
      baseUrl: 'https://gw.example',
      athlete,
    });
    expect(url).toBe('https://gw.example/v1/chat/completions');
    expect(err.provider).toBe('new-api');
  });

  it('anthropic', async () => {
    const { url, err } = await probe({ provider: 'anthropic', apiKey: 'k', model: 'm', athlete });
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(err.provider).toBe('anthropic');
  });

  it('gemini', async () => {
    const { url, err } = await probe({ provider: 'gemini', apiKey: 'k', model: 'gm', athlete });
    expect(url).toContain('/models/gm:streamGenerateContent');
    expect(err.provider).toBe('gemini');
  });
});
