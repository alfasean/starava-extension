import type { ChatMessage, LlmAdapter, ToolCall } from '../llm/types';
import type { ToolDefinition } from '../tools/types';

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; name: string; ok: boolean }
  | { type: 'progress'; label: string };

export interface RunAgentOptions {
  adapter: LlmAdapter;
  tools: ToolDefinition[];
  system: string;
  history: ChatMessage[];
  signal?: AbortSignal;
  onEvent: (e: AgentEvent) => void;
  maxRounds?: number;
}

const LIMIT_NOTE = 'Tool limit reached. Conclude with the data gathered so far.';

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export async function runAgent(o: RunAgentOptions): Promise<ChatMessage[]> {
  const { adapter, tools, system, signal, onEvent } = o;
  const maxRounds = o.maxRounds ?? 8;
  const appended: ChatMessage[] = [];
  const checkAbort = () => {
    if (signal?.aborted) throw abortError();
  };

  // One model round: streams text, collects tool calls, appends the assistant message.
  const round = async (withTools: boolean): Promise<ToolCall[]> => {
    const toolCalls: ToolCall[] = [];
    let content = '';
    const stream = adapter.stream({
      system,
      messages: [...o.history, ...appended],
      tools: withTools ? tools.map((t) => t.spec) : [],
      signal,
    });
    for await (const ev of stream) {
      checkAbort();
      if (ev.type === 'text') {
        content += ev.delta;
        onEvent({ type: 'text', delta: ev.delta });
      } else if (ev.type === 'tool_call') {
        toolCalls.push(ev.call);
      }
    }
    checkAbort();
    appended.push(
      toolCalls.length > 0
        ? { role: 'assistant', content, toolCalls }
        : { role: 'assistant', content },
    );
    return toolCalls;
  };

  const execute = async (tc: ToolCall): Promise<void> => {
    checkAbort();
    onEvent({ type: 'tool_start', name: tc.name, args: tc.arguments });
    const def = tools.find((t) => t.spec.name === tc.name);
    let ok = true;
    let content: string;
    try {
      if (!def) throw new Error(`Unknown tool: ${tc.name}`);
      const result = await def.handler(tc.arguments, {
        signal,
        reportProgress: (label) => onEvent({ type: 'progress', label }),
      });
      content = JSON.stringify(result ?? null);
    } catch (err) {
      if (signal?.aborted) throw abortError();
      ok = false;
      content = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
    }
    onEvent({ type: 'tool_end', name: tc.name, ok });
    checkAbort();
    appended.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content });
  };

  for (let r = 0; r < maxRounds; r++) {
    const calls = await round(true);
    if (calls.length === 0) return appended;
    for (const tc of calls) await execute(tc);
  }

  appended.push({ role: 'user', content: LIMIT_NOTE });
  await round(false);
  return appended;
}
