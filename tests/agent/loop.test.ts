import { describe, expect, it } from 'vitest';
import { runAgent, type AgentEvent } from '../../src/agent/loop';
import { buildSystemPrompt, QUICK_ACTIONS, SYSTEM_PROMPT } from '../../src/agent/prompts';
import type { ChatMessage, LlmAdapter, LlmRequest, StreamEvent } from '../../src/llm/types';
import type { ToolDefinition } from '../../src/tools/types';

function scripted(rounds: StreamEvent[][], calls: LlmRequest[] = []): LlmAdapter {
  let i = 0;
  return {
    async *stream(req) {
      calls.push({ ...req, messages: [...req.messages] });
      const events = rounds[Math.min(i++, rounds.length - 1)];
      for (const e of events) yield e;
    },
  };
}

const call = (id = 'c1', name = 'echo', args: Record<string, unknown> = { x: 1 }): StreamEvent => ({
  type: 'tool_call',
  call: { id, name, arguments: args },
});
const done = (stopReason: 'end' | 'tool_calls' = 'end'): StreamEvent => ({ type: 'done', stopReason });
const history: ChatMessage[] = [{ role: 'user', content: 'hi' }];

function tool(handler: ToolDefinition['handler']): ToolDefinition {
  return { spec: { name: 'echo', description: 'd', parameters: {} }, handler };
}

describe('runAgent', () => {
  it('returns a single assistant message for text-only', async () => {
    const events: AgentEvent[] = [];
    const out = await runAgent({
      adapter: scripted([[{ type: 'text', delta: 'Hel' }, { type: 'text', delta: 'lo' }, done()]]),
      tools: [], system: 's', history, onEvent: (e) => events.push(e),
    });
    expect(out).toEqual([{ role: 'assistant', content: 'Hello' }]);
    expect(events).toEqual([{ type: 'text', delta: 'Hel' }, { type: 'text', delta: 'lo' }]);
  });

  it('executes tool calls and continues', async () => {
    const events: AgentEvent[] = [];
    const seen: unknown[] = [];
    const out = await runAgent({
      adapter: scripted([[call(), done('tool_calls')], [{ type: 'text', delta: 'ok' }, done()]]),
      tools: [tool(async (a) => { seen.push(a); return { y: 2 }; })],
      system: 's', history, onEvent: (e) => events.push(e),
    });
    expect(seen).toEqual([{ x: 1 }]);
    expect(out).toEqual([
      { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'echo', arguments: { x: 1 } }] },
      { role: 'tool', toolCallId: 'c1', name: 'echo', content: '{"y":2}' },
      { role: 'assistant', content: 'ok' },
    ]);
    expect(events).toContainEqual({ type: 'tool_start', name: 'echo', args: { x: 1 } });
    expect(events).toContainEqual({ type: 'tool_end', name: 'echo', ok: true });
  });

  it('turns a throwing handler into an error tool message', async () => {
    const events: AgentEvent[] = [];
    const out = await runAgent({
      adapter: scripted([[call(), done('tool_calls')], [{ type: 'text', delta: 'ok' }, done()]]),
      tools: [tool(async () => { throw new Error('boom'); })],
      system: 's', history, onEvent: (e) => events.push(e),
    });
    expect(out[1]).toMatchObject({ role: 'tool', content: JSON.stringify({ error: 'boom' }) });
    expect(events).toContainEqual({ type: 'tool_end', name: 'echo', ok: false });
    expect(out[2].role).toBe('assistant');
  });

  it('handles unknown tools without throwing', async () => {
    const out = await runAgent({
      adapter: scripted([[call('c1', 'nope'), done('tool_calls')], [done()]]),
      tools: [], system: 's', history, onEvent: () => {},
    });
    expect(out[1].role).toBe('tool');
    expect((out[1] as { content: string }).content).toContain('error');
  });

  it('forces a final tools-free request after maxRounds', async () => {
    const calls: LlmRequest[] = [];
    const out = await runAgent({
      adapter: scripted([[call(), done('tool_calls')]], calls),
      tools: [tool(async () => 1)], system: 's', history, maxRounds: 2, onEvent: () => {},
    });
    expect(calls).toHaveLength(3);
    expect(calls[0].tools).toHaveLength(1);
    expect(calls[2].tools).toEqual([]);
    const last = calls[2].messages[calls[2].messages.length - 1];
    expect(last).toEqual({ role: 'user', content: 'Tool limit reached. Conclude with the data gathered so far.' });
    expect(out.length).toBeGreaterThan(0);
  });

  it('rejects with AbortError mid-stream, keeps partial text, and is reusable', async () => {
    const ctrl = new AbortController();
    const events: AgentEvent[] = [];
    await expect(
      runAgent({
        adapter: scripted([[{ type: 'text', delta: 'a' }, { type: 'text', delta: 'b' }, { type: 'text', delta: 'c' }, done()]]),
        tools: [], system: 's', history, signal: ctrl.signal,
        onEvent: (e) => {
          events.push(e);
          if (e.type === 'text' && e.delta === 'b') ctrl.abort();
        },
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(events.filter((e) => e.type === 'text').map((e) => (e as { delta: string }).delta)).toEqual(['a', 'b']);
    const out = await runAgent({
      adapter: scripted([[{ type: 'text', delta: 'fine' }, done()]]),
      tools: [], system: 's', history, onEvent: () => {},
    });
    expect(out).toEqual([{ role: 'assistant', content: 'fine' }]);
  });

  it('surfaces reportProgress as progress events', async () => {
    const events: AgentEvent[] = [];
    await runAgent({
      adapter: scripted([[call(), done('tool_calls')], [done()]]),
      tools: [tool(async (_a, ctx) => { ctx.reportProgress('step 1'); return null; })],
      system: 's', history, onEvent: (e) => events.push(e),
    });
    expect(events).toContainEqual({ type: 'progress', label: 'step 1' });
  });
});

describe('prompts', () => {
  it('includes date and weekday', () => {
    const p = buildSystemPrompt(new Date(2026, 9, 10));
    expect(p).toContain('2026-10-10');
    expect(p).toContain('Saturday');
    expect(p).toContain(SYSTEM_PROMPT);
  });
  it('defines quick actions', () => {
    expect(QUICK_ACTIONS.map((a) => a.id)).toEqual(['analyze-current', 'trend-4', 'trend-12', 'year-to-date']);
    expect(QUICK_ACTIONS.map((a) => a.label)).toEqual(['Analyze this activity', '4-week trend', '12-week trend', 'This year']);
    expect(QUICK_ACTIONS[3].prompt).toContain('January 1');
    expect(QUICK_ACTIONS[0].prompt).toContain('get_current_activity');
    expect(QUICK_ACTIONS[2].prompt).toContain('12 weeks');
  });
});
