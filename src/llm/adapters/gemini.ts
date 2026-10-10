import { LlmHttpError } from '../errors';
import { parseSse } from '../sse';
import type { ChatMessage, LlmAdapter, LlmRequest, StreamEvent } from '../types';

interface GeminiOptions {
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
}

type StopReason = 'end' | 'tool_calls' | 'length';
type Part = Record<string, unknown>;
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

function parseResult(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function mapMessages(messages: ChatMessage[]): Content[] {
  const out: Content[] = [];
  for (const m of messages) {
    if (m.role === 'tool') {
      const part: Part = { functionResponse: { name: m.name, response: { result: parseResult(m.content) } } };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.parts[0]?.functionResponse) {
        last.parts.push(part);
      } else {
        out.push({ role: 'user', parts: [part] });
      }
    } else if (m.role === 'assistant') {
      const parts: Part[] = [];
      if (m.content) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) {
        parts.push({ functionCall: { name: c.name, args: c.arguments } });
      }
      if (parts.length === 0) parts.push({ text: '' });
      out.push({ role: 'model', parts });
    } else {
      out.push({ role: 'user', parts: [{ text: m.content }] });
    }
  }
  return out;
}

export function createGeminiAdapter(o: GeminiOptions): LlmAdapter {
  const doFetch = o.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));

  return {
    async *stream(req: LlmRequest): AsyncIterable<StreamEvent> {
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: mapMessages(req.messages),
      };
      if (req.tools.length > 0) {
        body.tools = [
          {
            functionDeclarations: req.tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
          },
        ];
      }

      const res = await doFetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(o.model)}:streamGenerateContent?alt=sse`,
        {
          method: 'POST',
          headers: { 'x-goog-api-key': o.apiKey, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: req.signal,
        },
      );
      if (!res.ok) throw new LlmHttpError('gemini', res.status, await res.text().catch(() => ''));
      if (!res.body) throw new Error('gemini response has no body');

      let n = 0;
      let finish: StopReason | null = null;

      for await (const evt of parseSse(res.body)) {
        let json: any;
        try {
          json = JSON.parse(evt.data);
        } catch {
          continue;
        }
        const cand = json?.candidates?.[0];
        if (!cand) continue;
        for (const p of cand.content?.parts ?? []) {
          if (typeof p?.text === 'string' && p.text) {
            yield { type: 'text', delta: p.text };
          } else if (p?.functionCall) {
            const args = p.functionCall.args;
            n++;
            yield {
              type: 'tool_call',
              call: {
                id: `gemini-${n}`,
                name: p.functionCall.name ?? '',
                arguments: args && typeof args === 'object' && !Array.isArray(args) ? args : {},
              },
            };
          }
        }
        if (cand.finishReason) {
          finish = cand.finishReason === 'MAX_TOKENS' ? 'length' : 'end';
        }
      }

      const stopReason: StopReason = finish === 'length' ? 'length' : n > 0 ? 'tool_calls' : 'end';
      yield { type: 'done', stopReason };
    },
  };
}
