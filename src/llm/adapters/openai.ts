import type { ProviderId } from '../../settings/types';
import { LlmHttpError } from '../errors';
import { parseSse } from '../sse';
import type { ChatMessage, LlmAdapter, LlmRequest, StreamEvent, ToolCall } from '../types';

interface OpenAiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  provider?: ProviderId;
  fetch?: typeof fetch;
}

type StopReason = 'end' | 'tool_calls' | 'length';

function mapMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
  if (m.role === 'assistant') {
    const out: Record<string, unknown> = { role: 'assistant', content: m.content };
    if (m.toolCalls && m.toolCalls.length > 0) {
      out.tool_calls = m.toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      }));
    }
    return out;
  }
  return { role: 'user', content: m.content };
}

function parseArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function createOpenAiAdapter(o: OpenAiOptions): LlmAdapter {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  const baseUrl = (o.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

  return {
    async *stream(req: LlmRequest): AsyncIterable<StreamEvent> {
      const body: Record<string, unknown> = {
        model: o.model,
        stream: true,
        messages: [{ role: 'system', content: req.system }, ...req.messages.map(mapMessage)],
      };
      if (req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          type: 'function',
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      const res = await doFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) throw new LlmHttpError(o.provider ?? 'openai', res.status, await res.text().catch(() => ''));
      if (!res.body) throw new Error('openai response has no body');

      const pending = new Map<number, { id: string; name: string; args: string }>();
      let emittedCalls = false;
      let finish: StopReason | null = null;

      const drain = (): ToolCall[] => {
        const calls = [...pending.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, p]) => ({ id: p.id, name: p.name, arguments: parseArgs(p.args) }));
        pending.clear();
        if (calls.length > 0) emittedCalls = true;
        return calls;
      };

      for await (const evt of parseSse(res.body)) {
        if (evt.data === '[DONE]') break;
        let json: any;
        try {
          json = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const choice = json?.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta ?? {};
        if (typeof delta.content === 'string' && delta.content) {
          yield { type: 'text', delta: delta.content };
        }
        for (const tc of delta.tool_calls ?? []) {
          const idx: number = typeof tc.index === 'number' ? tc.index : 0;
          const p = pending.get(idx) ?? { id: '', name: '', args: '' };
          if (tc.id) p.id = tc.id;
          if (tc.function?.name) p.name += tc.function.name;
          if (tc.function?.arguments) p.args += tc.function.arguments;
          pending.set(idx, p);
        }
        if (choice.finish_reason) {
          for (const call of drain()) yield { type: 'tool_call', call };
          finish =
            choice.finish_reason === 'tool_calls' || choice.finish_reason === 'function_call'
              ? 'tool_calls'
              : choice.finish_reason === 'length'
                ? 'length'
                : 'end';
          break;
        }
      }

      for (const call of drain()) yield { type: 'tool_call', call };
      const stopReason: StopReason = !finish || finish === 'end' ? (emittedCalls ? 'tool_calls' : 'end') : finish;
      yield { type: 'done', stopReason };
    },
  };
}
