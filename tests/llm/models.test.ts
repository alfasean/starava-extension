import { describe, it, expect, vi } from 'vitest';
import { listModels, normalizeOpenAiBaseUrl } from '../../src/llm/models';
import { LlmHttpError } from '../../src/llm/errors';

describe('normalizeOpenAiBaseUrl', () => {
  it.each([
    ['https://gw.example', 'https://gw.example/v1'],
    ['https://gw.example/', 'https://gw.example/v1'],
    ['  https://gw.example///  ', 'https://gw.example/v1'],
    ['https://gw.example/v1/', 'https://gw.example/v1'],
    ['https://gw.example/api/v1', 'https://gw.example/api/v1'],
  ])('%s -> %s', (input, out) => {
    expect(normalizeOpenAiBaseUrl(input)).toBe(out);
  });
});

describe('listModels', () => {
  it('parses, sorts and dedupes ids and sends a Bearer header', async () => {
    const f = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: 'b' }, { id: 'a' }, { id: 'a' }] }), { status: 200 }),
    );
    const ids = await listModels({ baseUrl: 'https://gw.example/v1', apiKey: 'sk-1', fetch: f });
    expect(ids).toEqual(['a', 'b']);
    expect(f.mock.calls[0][0]).toBe('https://gw.example/v1/models');
    expect(new Headers(f.mock.calls[0][1].headers).get('authorization')).toBe('Bearer sk-1');
  });

  it('accepts a top-level array', async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify([{ id: 'z' }, { id: 'y' }]), { status: 200 }));
    expect(await listModels({ baseUrl: 'https://gw.example/v1', apiKey: 'k', fetch: f })).toEqual(['y', 'z']);
  });

  it('throws LlmHttpError with the given provider on non-OK', async () => {
    const f = vi.fn().mockResolvedValue(new Response('no', { status: 401 }));
    const err = await listModels({ baseUrl: 'https://gw.example/v1', apiKey: 'k', fetch: f, provider: 'new-api' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err).toMatchObject({ provider: 'new-api', status: 401, body: 'no' });
  });

  it('defaults the provider to openai-compatible', async () => {
    const f = vi.fn().mockResolvedValue(new Response('no', { status: 500 }));
    const err = await listModels({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: f }).catch((e) => e);
    expect(err.provider).toBe('openai-compatible');
  });

  it('throws a readable error on garbage', async () => {
    const f = vi.fn().mockResolvedValue(new Response('<html>', { status: 200 }));
    await expect(listModels({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: f })).rejects.toThrow(
      'Could not read the model list from the gateway',
    );
  });

  it('throws a readable error on unexpected JSON shape', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await expect(listModels({ baseUrl: 'https://x/v1', apiKey: 'k', fetch: f })).rejects.toThrow(
      'Could not read the model list from the gateway',
    );
  });
});
