import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAnthropicAdapter } from '../../src/llm/adapters/anthropic';
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
async function run(a: ReturnType<typeof createAnthropicAdapter>, req: LlmRequest) {
  const out: StreamEvent[] = [];
  for await (const e of a.stream(req)) out.push(e);
  return out;
}
const baseReq: LlmRequest = { system: 'SYS', messages: [{ role: 'user', content: 'hi' }], tools: [] };

describe('anthropic adapter', () => {
  it('streams text then a parsed tool call then done(tool_calls)', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('anthropic_tool_call.txt'));
    const ev = await run(createAnthropicAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    expect(ev).toEqual([
      { type: 'text', delta: 'Let me ' },
      { type: 'text', delta: 'check.' },
      { type: 'tool_call', call: { id: 'toolu_01', name: 'list_activities', arguments: { limit: 5 } } },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('sends headers and maps messages (consecutive tool results merge)', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('anthropic_tool_call.txt'));
    const ac = new AbortController();
    await run(createAnthropicAdapter({ apiKey: 'sk', model: 'claude-x', fetch: f }), {
      system: 'SYS',
      signal: ac.signal,
      tools: [{ name: 't', description: 'd', parameters: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'c1', name: 't', arguments: { a: 1 } },
            { id: 'c2', name: 't', arguments: {} },
          ],
        },
        { role: 'tool', toolCallId: 'c1', name: 't', content: 'r1' },
        { role: 'tool', toolCallId: 'c2', name: 't', content: 'r2' },
      ],
    });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.method).toBe('POST');
    expect(init.signal).toBe(ac.signal);
    expect(init.headers).toMatchObject({
      'x-api-key': 'sk',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    });
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      model: 'claude-x',
      max_tokens: 4096,
      system: 'SYS',
      stream: true,
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
      messages: [
        { role: 'user', content: 'hi' },
        {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'c1', name: 't', input: { a: 1 } },
            { type: 'tool_use', id: 'c2', name: 't', input: {} },
          ],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'c1', content: 'r1' },
            { type: 'tool_result', tool_use_id: 'c2', content: 'r2' },
          ],
        },
      ],
    });
    expect(body.messages).toHaveLength(3);
  });

  it('puts text before tool_use blocks', async () => {
    const f = vi.fn().mockResolvedValue(fixtureResponse('anthropic_tool_call.txt'));
    await run(createAnthropicAdapter({ apiKey: 'k', model: 'm', fetch: f }), {
      ...baseReq,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'ok', toolCalls: [{ id: 'c1', name: 't', arguments: {} }] },
      ],
    });
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'tool_use', id: 'c1', name: 't', input: {} },
    ]);
  });

  it('throws LlmHttpError on 401', async () => {
    const f = vi.fn().mockResolvedValue(new Response('bad key', { status: 401 }));
    const p = run(createAnthropicAdapter({ apiKey: 'k', model: 'm', fetch: f }), baseReq);
    await expect(p).rejects.toBeInstanceOf(LlmHttpError);
    await expect(p).rejects.toMatchObject({ status: 401, body: 'bad key' });
  });
});
