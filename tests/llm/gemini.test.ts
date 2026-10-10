import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createGeminiAdapter } from '../../src/llm/adapters/gemini';
import { LlmHttpError } from '../../src/llm/errors';
import type { StreamEvent, LlmRequest } from '../../src/llm/types';

function chunked(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  const sizes = [7, 31, 5, 100, 13];
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      let i = 0;
      let k = 0;
      while (i < bytes.length) {
        const n = sizes[k++ % sizes.length];
        c.enqueue(bytes.slice(i, i + n));
        i += n;
      }
      c.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
const fixtureResponse = (name: string) => chunked(readFileSync(`tests/fixtures/llm/${name}`, 'utf8'));
async function run(a: ReturnType<typeof createGeminiAdapter>, req: LlmRequest) {
  const out: StreamEvent[] = [];
  for await (const e of a.stream(req)) out.push(e);
  return out;
}
const baseReq: LlmRequest = { system: 'SYS', messages: [{ role: 'user', content: 'hi' }], tools: [] };

describe('gemini adapter', () => {
  it('streams text, tool calls with generated ids, then done(tool_calls)', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('gemini_tool_call.txt'));
    const ev = await run(createGeminiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(ev).toEqual([
      { type: 'text', delta: 'Let me ' },
      { type: 'text', delta: 'check.' },
      { type: 'tool_call', call: { id: 'gemini-1', name: 'list_activities', arguments: { limit: 5 } } },
      { type: 'tool_call', call: { id: 'gemini-2', name: 'noargs', arguments: {} } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('maps MAX_TOKENS to length and STOP without calls to end', async () => {
    const mk = (r: string) =>
      chunked(`data: {"candidates":[{"content":{"parts":[{"text":"x"}]},"finishReason":"${r}"}]}\n\n`);
    const f1 = vi.fn().mockResolvedValue(mk('MAX_TOKENS'));
    expect((await run(createGeminiAdapter({ apiKey: 'k', model: 'm', fetch: f1 }), baseReq)).at(-1)).toEqual({
      type: 'done',
      stopReason: 'length',
    });
    const f2 = vi.fn().mockResolvedValue(mk('STOP'));
    expect((await run(createGeminiAdapter({ apiKey: 'k', model: 'm', fetch: f2 }), baseReq)).at(-1)).toEqual({
      type: 'done',
      stopReason: 'end',
    });
  });

  it('emits done once when the stream ends without finishReason', async () => {
    const f = vi.fn().mockResolvedValue(
      chunked('data: {"candidates":[{"content":{"parts":[{"functionCall":{"name":"t","args":{}}}]}}]}\n\n'),
    );
    const ev = await run(createGeminiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(ev.filter((e) => e.type === 'done')).toEqual([{ type: 'done', stopReason: 'tool_calls' }]);
  });

  it('sends url, header, signal and maps messages', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('gemini_tool_call.txt'));
    const ac = new AbortController();
    await run(createGeminiAdapter({ apiKey: 'gk', model: 'gemini-x', fetch: f }), {
      system: 'SYS',
      signal: ac.signal,
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: 'ok',
          toolCalls: [
            { id: 'c1', name: 't', arguments: { a: 1 } },
            { id: 'c2', name: 't', arguments: {} },
          ],
        },
        { role: 'tool', toolCallId: 'c1', name: 't', content: '{"x":1}' },
        { role: 'tool', toolCallId: 'c2', name: 't', content: 'plain text' },
      ],
    });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-x:streamGenerateContent?alt=sse',
    );
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(ac.signal);
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'gk', 'content-type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({
      systemInstruction: { parts: [{ text: 'SYS' }] },
      tools: [{ functionDeclarations: [{ name: 't', description: 'd', parameters: { type: 'object' } }] }],
      contents: [
        { role: 'user', parts: [{ text: 'hi' }] },
        {
          role: 'model',
          parts: [
            { text: 'ok' },
            { functionCall: { name: 't', args: { a: 1 } } },
            { functionCall: { name: 't', args: {} } },
          ],
        },
        {
          role: 'user',
          parts: [
            { functionResponse: { name: 't', response: { result: { x: 1 } } } },
            { functionResponse: { name: 't', response: { result: 'plain text' } } },
          ],
        },
      ],
    });
  });

  it('omits tools when empty', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('gemini_tool_call.txt'));
    await run(createGeminiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(JSON.parse(f.mock.calls[0][1].body)).not.toHaveProperty('tools');
  });

  it('throws LlmHttpError on 401', async () => {
    const f = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
    const p = run(createGeminiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    await expect(p).rejects.toBeInstanceOf(LlmHttpError);
    await expect(p).rejects.toMatchObject({ provider: 'gemini', status: 401, body: 'bad key' });
  });
});
