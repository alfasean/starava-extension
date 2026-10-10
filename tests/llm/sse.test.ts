import { describe, it, expect } from 'vitest';
import { parseSse } from '../../src/llm/sse';

function streamOf(chunks: (string | Uint8Array)[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(typeof ch === 'string' ? enc.encode(ch) : ch);
      c.close();
    },
  });
}
async function collect(s: ReadableStream<Uint8Array>) {
  const out: { event?: string; data: string }[] = [];
  for await (const e of parseSse(s)) out.push(e);
  return out;
}

describe('parseSse', () => {
  it('handles chunk boundary mid-line', async () => {
    expect(await collect(streamOf(['data: {"a"', ':1}\n\n']))).toEqual([{ data: '{"a":1}' }]);
  });
  it('handles CRLF and multiple events in one chunk', async () => {
    const r = await collect(streamOf(['event: x\r\ndata: 1\r\n\r\ndata: 2\r\n\r\n']));
    expect(r).toEqual([{ event: 'x', data: '1' }, { data: '2' }]);
  });
  it('handles split mid-CRLF', async () => {
    const r = await collect(streamOf(['data: 1\r', '\n\r', '\ndata: 2\n\n']));
    expect(r).toEqual([{ data: '1' }, { data: '2' }]);
  });
  it('joins multiple data lines, skips comments, flushes final event', async () => {
    const r = await collect(streamOf([': ping\ndata: a\ndata: b\n\ndata: tail']));
    expect(r).toEqual([{ data: 'a\nb' }, { data: 'tail' }]);
  });
  it('handles multibyte chars split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: é\n\n');
    const r = await collect(streamOf([bytes.slice(0, 7), bytes.slice(7)]));
    expect(r).toEqual([{ data: 'é' }]);
  });
  it('cancels the underlying stream when the consumer stops early', async () => {
    let cancelled = false;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: 1\n\ndata: 2\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const e of parseSse(body)) {
      expect(e.data).toBe('1');
      break;
    }
    expect(cancelled).toBe(true);
  });
});
