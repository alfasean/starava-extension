import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createOpenAiAdapter } from '../../src/llm/adapters/openai';
import { LlmHttpError } from '../../src/llm/errors';
import type { StreamEvent, LlmRequest } from '../../src/llm/types';

function fixtureResponse(name: string): Response {
  const text = readFileSync(`tests/fixtures/llm/${name}`, 'utf8');
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
async function run(a: ReturnType<typeof createOpenAiAdapter>, req: LlmRequest) {
  const out: StreamEvent[] = [];
  for await (const e of a.stream(req)) out.push(e);
  return out;
}
const baseReq: LlmRequest = { system: 'SYS', messages: [{ role: 'user', content: 'hi' }], tools: [] };

describe('openai adapter', () => {
  it('streams text then done(end)', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('openai_text.txt'));
    const ev = await run(createOpenAiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    const text = ev
      .filter((e) => e.type === 'text')
      .map((e) => (e as { delta: string }).delta)
      .join('');
    expect(text).toBe('Nice easy run, keep it up!');
    expect(ev[ev.length - 1]).toEqual({ type: 'done', stopReason: 'end' });
    expect(ev.filter((e) => e.type === 'done')).toHaveLength(1);
  });

  it('assembles a tool call from fragments', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('openai_tool_call.txt'));
    const ev = await run(createOpenAiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(ev).toEqual([
      { type: 'tool_call', call: { id: 'call_1', name: 'list_activities', arguments: { limit: 5 } } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('builds the request body and uses baseUrl override', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('openai_text.txt'));
    const ac = new AbortController();
    await run(
      createOpenAiAdapter({ apiKey: 'sk', model: 'gpt-x', baseUrl: 'http://localhost:1234/v1/', fetch: f }),
      {
        system: 'SYS',
        signal: ac.signal,
        tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
        messages: [
          { role: 'user', content: 'hi' },
          { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 't', arguments: { a: 1 } }] },
          { role: 'tool', toolCallId: 'c1', name: 't', content: '{"ok":true}' },
        ],
      },
    );
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(ac.signal);
    expect(init.headers.Authorization).toBe('Bearer sk');
    expect(JSON.parse(init.body)).toEqual({
      model: 'gpt-x',
      stream: true,
      messages: [
        { role: 'system', content: 'SYS' },
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'c1', type: 'function', function: { name: 't', arguments: '{"a":1}' } }],
        },
        { role: 'tool', tool_call_id: 'c1', content: '{"ok":true}' },
      ],
      tools: [{ type: 'function', function: { name: 't', description: 'd', parameters: { type: 'object' } } }],
    });
  });

  it('throws LlmHttpError on 401', async () => {
    const f = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
    const p = run(createOpenAiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    await expect(p).rejects.toBeInstanceOf(LlmHttpError);
    await expect(p).rejects.toMatchObject({ status: 401, body: 'bad key' });
  });

  const sseResponse = (frames: object[], tail = '') =>
    new Response(frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('') + tail, { status: 200 });
  const tcChunk = (args: string, extra: object = {}) => ({
    choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'c9', function: { name: 'fn', arguments: args }, ...extra }] } }],
  });

  it('uses the provider option in LlmHttpError', async () => {
    const f = vi.fn().mockResolvedValue(new Response('no', { status: 401 }));
    const p = run(createOpenAiAdapter({ apiKey: 'k', model: 'm', provider: 'openai-compatible', fetch: f }), baseReq);
    await expect(p).rejects.toMatchObject({ provider: 'openai-compatible', status: 401 });
  });

  it('reports tool_calls when finish_reason is stop but tool calls were emitted', async () => {
    const f = vi.fn().mockResolvedValue(
      sseResponse([tcChunk('{"a":1}'), { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }], 'data: [DONE]\n\n'),
    );
    const ev = await run(createOpenAiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(ev).toEqual([
      { type: 'tool_call', call: { id: 'c9', name: 'fn', arguments: { a: 1 } } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('emits pending tool calls then done when the stream ends without finish_reason', async () => {
    const f = vi.fn().mockResolvedValue(sseResponse([tcChunk('{"a":2}')]));
    const ev = await run(createOpenAiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(ev).toEqual([
      { type: 'tool_call', call: { id: 'c9', name: 'fn', arguments: { a: 2 } } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('uses empty arguments for invalid tool-call JSON and keeps going', async () => {
    const f = vi.fn().mockResolvedValue(
      sseResponse([tcChunk('{"a":'), { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }]),
    );
    const ev = await run(createOpenAiAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(ev).toEqual([
      { type: 'tool_call', call: { id: 'c9', name: 'fn', arguments: {} } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });
});
