export interface SseEvent {
  event?: string;
  data: string;
}

/** Parses a Server-Sent Events byte stream into events. Chunk boundaries may fall anywhere. */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncIterable<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let event: string | undefined;
  let data: string[] = [];

  const flush = (): SseEvent | null => {
    if (data.length === 0) {
      event = undefined;
      return null;
    }
    const out: SseEvent = event !== undefined ? { event, data: data.join('\n') } : { data: data.join('\n') };
    event = undefined;
    data = [];
    return out;
  };

  const handleLine = (line: string): SseEvent | null => {
    if (line === '') return flush();
    if (line.startsWith(':')) return null;
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') data.push(value);
    else if (field === 'event') event = value;
    return null;
  };

  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // A trailing lone \r may be the first half of \r\n; keep it for the next chunk.
      let end = buffer.length;
      if (buffer.endsWith('\r')) end -= 1;
      const complete = buffer.slice(0, end);
      const lines = complete.split(/\r\n|\n|\r/);
      const rest = lines.pop() ?? '';
      buffer = rest + buffer.slice(end);
      for (const line of lines) {
        const ev = handleLine(line);
        if (ev) yield ev;
      }
    }
    buffer += decoder.decode();
    const lines = buffer.split(/\r\n|\n|\r/);
    for (const line of lines) {
      const ev = handleLine(line);
      if (ev) yield ev;
    }
    const last = flush();
    if (last) yield last;
    completed = true;
  } finally {
    if (!completed) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
