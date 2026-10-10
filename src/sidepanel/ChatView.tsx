import { useState, type KeyboardEvent } from 'react';
import { QUICK_ACTIONS } from '../agent/prompts';
import type { UserFacingError } from './errors';
import MessageList from './MessageList';
import { useChat } from './useChat';

const STRAVA_LOGIN_URL = 'https://www.strava.com/login';

interface Props {
  configured: boolean;
  onOpenSettings(): void;
}

function ErrorBanner({ error, onOpenSettings }: { error: UserFacingError; onOpenSettings(): void }) {
  return (
    <div className="error" role="alert">
      <div className="error-row">
        <span>{error.message}</span>
        {error.action === 'open-strava' && (
          <button className="link" onClick={() => void chrome.tabs.create({ url: STRAVA_LOGIN_URL })}>
            Open Strava
          </button>
        )}
        {error.action === 'open-settings' && (
          <button className="link" onClick={onOpenSettings}>
            Open Settings
          </button>
        )}
      </div>
      {error.details && (
        <details>
          <summary>Details</summary>
          <pre>{error.details}</pre>
        </details>
      )}
    </div>
  );
}

export default function ChatView({ configured, onOpenSettings }: Props) {
  const chat = useChat();
  const [input, setInput] = useState('');
  const canSend = configured && !chat.running;

  const submit = () => {
    if (!canSend || !input.trim()) return;
    chat.send(input);
    setInput('');
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <section className="chat">
      <div className="chat-toolbar">
        <button className="ghost" onClick={chat.reset} disabled={chat.messages.length === 0 && !chat.running}>
          New chat
        </button>
      </div>

      {chat.messages.length === 0 ? (
        <div className="empty">
          <p>Ask your running coach about your Strava runs, or start with a quick action below.</p>
        </div>
      ) : (
        <MessageList messages={chat.messages} status={chat.status} running={chat.running} />
      )}

      <div className="composer">
        {chat.error && <ErrorBanner error={chat.error} onOpenSettings={onOpenSettings} />}
        {!configured && (
          <p className="setup-hint">
            <button className="link" onClick={onOpenSettings}>
              Set up your AI provider in Settings
            </button>
          </p>
        )}
        <div className="chips">
          {QUICK_ACTIONS.map((q) => (
            <button key={q.id} className="chip" disabled={!canSend} onClick={() => chat.send(q.prompt, q.label)}>
              {q.label}
            </button>
          ))}
        </div>
        <div className="input-row">
          <textarea
            aria-label="Message"
            rows={2}
            placeholder={configured ? 'Ask about your runs…' : 'Set up your AI provider in Settings first'}
            value={input}
            disabled={!configured}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {chat.running ? (
            <button className="stop" onClick={chat.stop}>
              Stop
            </button>
          ) : (
            <button className="primary" onClick={submit} disabled={!canSend || !input.trim()}>
              Send
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
