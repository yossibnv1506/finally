"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { formatPrice, formatQty } from "@/lib/format";
import type { ChatActions, ChatMessage, ChatTradeAction, ChatWatchlistAction } from "@/lib/types";

interface ChatPanelProps {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (message: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}

const SUGGESTIONS = [
  "How concentrated is my portfolio?",
  "Buy 5 NVDA",
  "Add PYPL to my watchlist",
];

export function describeTrade(t: ChatTradeAction): string {
  const verb = t.side === "buy" ? "Bought" : "Sold";
  if (t.status === "executed") {
    return `${verb} ${formatQty(t.quantity)} ${t.ticker}${t.price != null ? ` at ${formatPrice(t.price)}` : ""}`;
  }
  return `Couldn't ${t.side} ${formatQty(t.quantity)} ${t.ticker}${t.error ? `: ${t.error}` : ""}`;
}

export function describeWatchlist(w: ChatWatchlistAction): string {
  if (w.status === "executed") {
    return w.action === "add" ? `Added ${w.ticker} to watchlist` : `Removed ${w.ticker} from watchlist`;
  }
  return `Couldn't ${w.action} ${w.ticker}${w.error ? `: ${w.error}` : ""}`;
}

function ActionList({ actions }: { actions: ChatActions | null }) {
  const trades = actions?.trades ?? [];
  const changes = actions?.watchlist_changes ?? [];
  if (!trades.length && !changes.length) return null;
  const item = (ok: boolean, text: string, key: string) => (
    <li
      key={key}
      data-testid="chat-action"
      data-status={ok ? "executed" : "failed"}
      className={`flex items-start gap-1.5 border-l-2 py-0.5 pl-2 text-xs ${
        ok ? "border-up text-up" : "border-down text-down"
      }`}
    >
      <span aria-hidden>{ok ? "✓" : "✕"}</span>
      <span>{text}</span>
    </li>
  );
  return (
    <ul className="mt-1.5 space-y-1">
      {trades.map((t, i) => item(t.status === "executed", describeTrade(t), `t${i}`))}
      {changes.map((w, i) => item(w.status === "executed", describeWatchlist(w), `w${i}`))}
    </ul>
  );
}

export default function ChatPanel({ messages, loading, onSend, collapsed, onToggle }: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, loading, collapsed]);

  const send = (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    onSend(msg);
    setDraft("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  if (collapsed) {
    return (
      <aside data-testid="chat-panel" data-collapsed="true" className="flex h-full flex-col items-center border border-rule bg-panel py-2">
        <button
          type="button"
          data-testid="chat-toggle"
          onClick={onToggle}
          aria-label="Open assistant"
          aria-expanded={false}
          className="rounded-sm px-2 py-1 text-xs text-accent hover:bg-raise [writing-mode:vertical-rl]"
        >
          Open assistant
        </button>
      </aside>
    );
  }

  return (
    <aside data-testid="chat-panel" data-collapsed="false" className="flex h-full min-h-0 flex-col border border-rule bg-panel">
      <header className="flex h-8 shrink-0 items-center justify-between border-b border-rule px-3">
        <h2 className="text-[13px] font-medium">
          FinAlly <span className="text-dim">assistant</span>
        </h2>
        <button
          type="button"
          data-testid="chat-toggle"
          onClick={onToggle}
          aria-label="Collapse assistant"
          aria-expanded
          className="rounded-sm px-1.5 text-dim hover:bg-raise hover:text-text"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
            <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        </button>
      </header>

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
        {messages.length === 0 && !loading ? (
          <div className="space-y-2 text-xs text-dim">
            <p>Ask about your positions, or tell me what to trade. Orders execute immediately.</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-sm border border-rule px-2 py-1 text-left text-text hover:border-blue"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <div
            key={m.id}
            data-testid="chat-message"
            data-role={m.role}
            className={m.role === "user" ? "ml-6 flex justify-end" : "mr-2"}
          >
            <div
              className={
                m.role === "user"
                  ? "rounded-sm bg-blue/15 px-2.5 py-1.5 text-[13px] text-text"
                  : "border-l-2 border-accent/70 pl-2.5 text-[13px] leading-relaxed text-text"
              }
            >
              <p className="whitespace-pre-wrap break-words">{m.content}</p>
              {m.role === "assistant" ? <ActionList actions={m.actions} /> : null}
            </div>
          </div>
        ))}

        {loading ? (
          <div data-testid="chat-loading" role="status" aria-label="Assistant is thinking" className="flex items-center gap-1 pl-2.5 text-dim">
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="typing-dot h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="ml-1.5 text-xs">Thinking</span>
          </div>
        ) : null}
      </div>

      <form onSubmit={onSubmit} className="shrink-0 border-t border-rule p-2">
        <div className="flex items-end gap-1.5">
          <textarea
            data-testid="chat-input"
            aria-label="Message the assistant"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="Ask FinAlly…"
            className="scroll-thin min-w-0 flex-1 resize-none rounded-sm border border-rule bg-ink px-2 py-1.5 text-[13px] placeholder:text-faint focus:border-blue focus:outline-none"
          />
          <button
            type="submit"
            data-testid="chat-send-button"
            disabled={loading || !draft.trim()}
            className="rounded-sm bg-purple px-3 py-1.5 text-[13px] font-semibold text-white hover:bg-purple-hi disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
