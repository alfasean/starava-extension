import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChat } from '../../src/sidepanel/useChat';
import type { LlmAdapter, LlmRequest, StreamEvent } from '../../src/llm/types';
import type { ToolDefinition } from '../../src/tools/types';
import { StravaAuthError } from '../../src/strava/errors';

type Round = (req: LlmRequest) => AsyncIterable<StreamEvent>;

function fakeAdapter(rounds: Round[], calls: LlmRequest[]): LlmAdapter {
  let i = 0;
  return {
    stream(req) {
      calls.push({ ...req, messages: [...req.messages] });
      return rounds[Math.min(i++, rounds.length - 1)](req);
    },
  };
}

const textRound =
  (...deltas: string[]): Round =>
  async function* () {
    for (const d of deltas) yield { type: 'text', delta: d };
    yield { type: 'done', stopReason: 'end' };
  };

/** Yields `first`, then blocks until the request is aborted. */
const hangingRound =
  (first: string): Round =>
  async function* (req) {
    yield { type: 'text', delta: first };
    await new Promise<void>((_, reject) => {
      req.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    });
  };

function setup(rounds: Round[], tools: ToolDefinition[] = []) {
  const calls: LlmRequest[] = [];
  const adapter = fakeAdapter(rounds, calls);
  const hook = renderHook(() =>
    useChat({ createAdapter: () => adapter, createTools: () => tools }),
  );
  return { calls, hook };
}

describe('useChat', () => {
  it('shows the user message and the streamed assistant reply', async () => {
    const { hook } = setup([textRound('Hel', 'lo!')]);
    act(() => hook.result.current.send('How was my run?'));
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(hook.result.current.messages.map((m) => [m.kind, m.text])).toEqual([
      ['user', 'How was my run?'],
      ['assistant', 'Hello!'],
    ]);
    expect(hook.result.current.error).toBeNull();
  });

  it('keeps partial text on stop and the next send works with that context', async () => {
    const { hook, calls } = setup([hangingRound('Partial'), textRound('Second answer')]);
    act(() => hook.result.current.send('first'));
    await waitFor(() =>
      expect(hook.result.current.messages.some((m) => m.kind === 'assistant' && m.text === 'Partial')).toBe(
        true,
      ),
    );
    expect(hook.result.current.running).toBe(true);

    act(() => hook.result.current.stop());
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.messages.map((m) => [m.kind, m.text])).toEqual([
      ['user', 'first'],
      ['assistant', 'Partial'],
    ]);

    act(() => hook.result.current.send('second'));
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(calls[1].messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'Partial' },
      { role: 'user', content: 'second' },
    ]);
    expect(hook.result.current.messages.at(-1)).toMatchObject({ kind: 'assistant', text: 'Second answer' });
  });

  it('shows tool steps as status lines and progress labels as status', async () => {
    let releaseTool!: () => void;
    const toolGate = new Promise<void>((r) => (releaseTool = r));
    const tool: ToolDefinition = {
      spec: { name: 'get_training_trend', description: 'd', parameters: {} },
      async handler(_args, ctx) {
        ctx.reportProgress('Fetching streams 3/40');
        await toolGate;
        return { ok: true };
      },
    };
    const toolRound: Round = async function* () {
      yield { type: 'tool_call', call: { id: 'c1', name: 'get_training_trend', arguments: {} } };
      yield { type: 'done', stopReason: 'tool_calls' };
    };
    const { hook, calls } = setup([toolRound, textRound('Trend looks good.')], [tool]);
    act(() => hook.result.current.send('trend'));
    await waitFor(() => expect(hook.result.current.status).toBe('Fetching streams 3/40'));
    act(() => releaseTool());
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(hook.result.current.status).toBeNull();
    expect(hook.result.current.messages.map((m) => [m.kind, m.text])).toEqual([
      ['user', 'trend'],
      ['tool', 'Called get_training_trend'],
      ['assistant', 'Trend looks good.'],
    ]);
    expect(calls[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('does not render the synthetic tool-limit note but keeps it in history', async () => {
    const tool: ToolDefinition = {
      spec: { name: 'echo', description: 'd', parameters: {} },
      handler: async () => 1,
    };
    const toolRound: Round = async function* () {
      yield { type: 'tool_call', call: { id: 'c', name: 'echo', arguments: {} } };
      yield { type: 'done', stopReason: 'tool_calls' };
    };
    // 8 tool rounds hit the limit, then the forced final round answers.
    const rounds = [...Array(8).fill(toolRound), textRound('Done.')];
    const { hook, calls } = setup(rounds, [tool]);
    act(() => hook.result.current.send('go'));
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(hook.result.current.messages.some((m) => m.text.startsWith('Tool limit reached.'))).toBe(false);

    calls.length = 0;
    act(() => hook.result.current.send('next'));
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(
      calls[0].messages.some((m) => m.role === 'user' && m.content.startsWith('Tool limit reached.')),
    ).toBe(true);
  });

  it('maps errors to a user-facing error and reset clears everything', async () => {
    const failing: Round = async function* () {
      yield { type: 'text', delta: '' };
      throw new StravaAuthError();
    };
    const { hook } = setup([failing]);
    act(() => hook.result.current.send('hi'));
    await waitFor(() => expect(hook.result.current.running).toBe(false));
    expect(hook.result.current.error).toEqual({
      message: 'Please log in to strava.com and try again.',
      action: 'open-strava',
    });
    act(() => hook.result.current.reset());
    expect(hook.result.current.messages).toEqual([]);
    expect(hook.result.current.error).toBeNull();
  });

  it('passes the active tab URL from chrome.tabs.query to the tools', async () => {
    chrome.tabs.query = vi.fn(async () => [{ url: 'https://www.strava.com/activities/42' }]) as any;
    let seen: string | undefined;
    const calls: LlmRequest[] = [];
    const adapter = fakeAdapter([textRound('ok')], calls);
    const hook = renderHook(() =>
      useChat({
        createAdapter: () => adapter,
        createTools: (d) => {
          void d.getActiveTabUrl().then((u) => (seen = u));
          return [];
        },
      }),
    );
    act(() => hook.result.current.send('x'));
    await waitFor(() => expect(seen).toBe('https://www.strava.com/activities/42'));
    expect(chrome.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
  });
});
