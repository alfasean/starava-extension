import { LlmHttpError } from '../errors';
import { parseSse } from '../sse';
import type { ChatMessage, LlmAdapter, LlmRequest, StreamEvent } from '../types';

interface AnthropicOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

type StopReason = 'end' | 'tool_calls' | 'length';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | Record<string, unknown>[];
}

function mapMessages(messages: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0]?.type === 'tool_result') {
        last.content.push(block);
      } else {
        out.push({ role: 'user', content: [block] });
      }
    } else if (m.role === 'assistant') {
      if (m.toolCalls && m.toolCalls.length > 0) {
        const blocks: Record<string, unknown>[] = [];
        if (m.content) blocks.push({ type: 'text', text: m.content });
        for (const c of m.toolCalls) {
          blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
        }
        out.push({ role: 'assistant', content: blocks });
      } else {
        out.push({ role: 'assistant', content: m.content });
      }
    } else {
      out.push({ role: 'user', content: m.content });
    }
  }
  return out;
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

export function createAnthropicAdapter(o: AnthropicOptions): LlmAdapter {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));

  return {
    async *stream(req: LlmRequest): AsyncIterable<StreamEvent> {
      const body: Record<string, unknown> = {
        model: o.model,
        max_tokens: 4096,
        system: req.system,
        messages: mapMessages(req.messages),
        stream: true,
      };
      if (req.tools.length > 0) {
        body.tools = req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.parameters,
        }));
      }

      const res = await doFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': o.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: req.signal,
      });
      if (!res.ok) throw new LlmHttpError('anthropic', res.status, await res.text().catch(() => ''));
      if (!res.body) throw new Error('anthropic response has no body');

      const blocks = new Map<number, { id: string; name: string; args: string }>();
      let emittedCalls = false;
      let finish: StopReason | null = null;

      for await (const evt of parseSse(res.body)) {
        if (evt.event === 'error') throw new LlmHttpError('anthropic', 500, evt.data);
        let json: any;
        try {
          json = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const type: unknown = evt.event ?? json?.type;
        if (type === 'content_block_start') {
          const cb = json.content_block;
          if (cb?.type === 'tool_use') {
            blocks.set(json.index, { id: cb.id ?? '', name: cb.name ?? '', args: '' });
          }
        } else if (type === 'content_block_delta') {
          const d = json.delta;
          if (d?.type === 'text_delta' && typeof d.text === 'string' && d.text) {
            yield { type: 'text', delta: d.text };
          } else if (d?.type === 'input_json_delta' && typeof d.partial_json === 'string') {
            const b = blocks.get(json.index);
            if (b) b.args += d.partial_json;
          }
        } else if (type === 'content_block_stop') {
          const b = blocks.get(json.index);
          if (b) {
            blocks.delete(json.index);
            emittedCalls = true;
            yield { type: 'tool_call', call: { id: b.id, name: b.name, arguments: parseArgs(b.args) } };
          }
        } else if (type === 'message_delta') {
          const sr = json.delta?.stop_reason;
          if (sr) {
            finish = sr === 'tool_use' ? 'tool_calls' : sr === 'max_tokens' ? 'length' : 'end';
          }
        } else if (type === 'message_stop') {
          break;
        }
      }

      yield { type: 'done', stopReason: finish ?? (emittedCalls ? 'tool_calls' : 'end') };
    },
  };
}
