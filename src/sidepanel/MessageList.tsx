import { useEffect, useRef } from 'react';
import Markdown from 'react-markdown';
import type { DisplayMessage } from './useChat';

const markdownComponents = {
  a: (props: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
};

interface Props {
  messages: DisplayMessage[];
  status: string | null;
  running: boolean;
}

export default function MessageList({ messages, status, running }: Props) {
  const end = useRef<HTMLDivElement>(null);
  const last = messages.at(-1);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, status]);

  return (
    <div className="messages" aria-live="polite">
      {messages.map((m) =>
        m.kind === 'user' ? (
          <div key={m.id} className="msg msg-user">
            {m.text}
          </div>
        ) : m.kind === 'assistant' ? (
          <div key={m.id} className="msg msg-assistant">
            <Markdown components={markdownComponents}>{m.text}</Markdown>
          </div>
        ) : (
          <div key={m.id} className="msg-tool">
            {m.text}
          </div>
        ),
      )}
      {running && (status || last?.kind !== 'assistant') && (
        <div className="msg-tool msg-status">{status ? `${status}…` : 'Thinking…'}</div>
      )}
      <div ref={end} />
    </div>
  );
}
