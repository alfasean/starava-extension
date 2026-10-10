import { useCallback, useEffect, useRef, useState } from 'react';
import { runAgent, type AgentEvent } from '../agent/loop';
import { buildSystemPrompt } from '../agent/prompts';
import { createAdapter as defaultCreateAdapter } from '../llm/index';
import type { ChatMessage, LlmAdapter } from '../llm/types';
import { loadSettings } from '../settings/store';
import type { Settings } from '../settings/types';
import { createCachedSource } from '../strava/cache';
import { createStravaClient } from '../strava/client';
import type { StravaSource } from '../strava/types';
import { createTools as defaultCreateTools, type ToolDeps } from '../tools/index';
import type { ToolDefinition } from '../tools/types';
import { toUserFacingError, type UserFacingError } from './errors';

export type DisplayMessage =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'tool'; text: string };

export interface UseChatDeps {
  createAdapter?: (s: Settings) => LlmAdapter;
  createTools?: (d: ToolDeps) => ToolDefinition[];
}

export interface UseChat {
  messages: DisplayMessage[];
  status: string | null;
  running: boolean;
  error: UserFacingError | null;
  /** `display` optionally replaces the text shown in the user bubble (e.g. a quick-action label). */
  send(text: string, display?: string): void;
  stop(): void;
  reset(): void;
}

interface Turn {
  controller: AbortController;
  /** All assistant text streamed during this turn. */
  partial: string;
  /** Display id of the assistant bubble currently receiving text, if any. */
  assistantId: number | null;
  /** Display id of the tool line for the running tool, if any. */
  toolId: number | null;
  done: boolean;
}

async function activeTabUrl(): Promise<string | undefined> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab?.url;
  } catch {
    return undefined;
  }
}

export function useChat(deps: UseChatDeps = {}): UseChat {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<UserFacingError | null>(null);

  const history = useRef<ChatMessage[]>([]);
  const turn = useRef<Turn | null>(null);
  const nextId = useRef(1);
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const source = useRef<StravaSource | null>(null);

  useEffect(() => () => turn.current?.controller.abort(), []);

  const append = useCallback((kind: DisplayMessage['kind'], text: string): number => {
    const id = nextId.current++;
    setMessages((ms) => [...ms, { id, kind, text }]);
    return id;
  }, []);

  const patch = useCallback((id: number, update: (text: string) => string) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, text: update(m.text) } : m)));
  }, []);

  /** Ends the turn exactly once. On failure, keeps any partial reply as model context. */
  const finish = useCallback((t: Turn, appended: ChatMessage[] | null) => {
    if (t.done) return;
    t.done = true;
    if (turn.current === t) turn.current = null;
    if (appended) {
      history.current.push(...appended);
    } else if (t.partial) {
      history.current.push({ role: 'assistant', content: t.partial });
    } else {
      // Nothing came back: drop the unanswered user message so roles keep alternating.
      const last = history.current.at(-1);
      if (last?.role === 'user') history.current.pop();
    }
    setStatus(null);
    setRunning(false);
  }, []);

  const send = useCallback(
    (text: string, display?: string) => {
      const prompt = text.trim();
      if (!prompt || turn.current) return;
      const t: Turn = {
        controller: new AbortController(),
        partial: '',
        assistantId: null,
        toolId: null,
        done: false,
      };
      turn.current = t;
      setError(null);
      setStatus(null);
      setRunning(true);
      append('user', display ?? prompt);
      history.current.push({ role: 'user', content: prompt });
      const priorHistory = [...history.current];

      const onEvent = (e: AgentEvent) => {
        if (t.done) return;
        switch (e.type) {
          case 'text': {
            if (!e.delta) return;
            t.partial += e.delta;
            if (t.assistantId === null) t.assistantId = append('assistant', e.delta);
            else patch(t.assistantId, (s) => s + e.delta);
            return;
          }
          case 'tool_start':
            t.assistantId = null;
            t.toolId = append('tool', `Calling ${e.name}…`);
            return;
          case 'tool_end': {
            const label = e.ok ? `Called ${e.name}` : `${e.name} failed`;
            if (t.toolId !== null) patch(t.toolId, () => label);
            t.toolId = null;
            setStatus(null);
            return;
          }
          case 'progress':
            setStatus(e.label);
            return;
        }
      };

      void (async () => {
        try {
          const { createAdapter = defaultCreateAdapter, createTools = defaultCreateTools } =
            depsRef.current;
          const settings = await loadSettings();
          source.current ??= createCachedSource(createStravaClient());
          const tools = createTools({
            source: source.current,
            getSettings: loadSettings,
            getActiveTabUrl: activeTabUrl,
          });
          const appended = await runAgent({
            adapter: createAdapter(settings),
            tools,
            system: buildSystemPrompt(new Date()),
            history: priorHistory,
            signal: t.controller.signal,
            onEvent,
          });
          finish(t, appended);
        } catch (e) {
          if (t.done) return;
          finish(t, null);
          setError(toUserFacingError(e));
        }
      })();
    },
    [append, patch, finish],
  );

  const stop = useCallback(() => {
    const t = turn.current;
    if (!t) return;
    t.controller.abort();
    finish(t, null);
  }, [finish]);

  const reset = useCallback(() => {
    const t = turn.current;
    if (t) {
      t.controller.abort();
      t.done = true;
      turn.current = null;
    }
    history.current = [];
    setMessages([]);
    setStatus(null);
    setRunning(false);
    setError(null);
  }, []);

  return { messages, status, running, error, send, stop, reset };
}
