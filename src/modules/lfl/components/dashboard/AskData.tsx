"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import type { AskAnswerDto, LflFilters } from "../../contracts";
import { toSearchParams } from "../../hooks/useLflDashboard";
import { Drawer } from "../ui/Drawer";
import { Icon } from "../ui/Icon";

type Message = { role: "user" | "assistant"; content: string; error?: boolean; queries?: AskAnswerDto["queries"] };

const SUGGESTIONS = [
  "Which region is dragging LFL down, and why?",
  "Which AMs have the most concern stores?",
  "Which 10 stores sold the most earrings yesterday?",
  "Which hours of the day get the most footfall in Bengaluru stores?",
  "Who were the top 5 salespeople by gold sales this month?",
];

/** **bold** and simple "- " bullets; everything else is plain text. */
function Rich({ text }: { text: string }) {
  const inline = (line: string): ReactNode[] =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>
    );
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) blocks.push(<ul key={blocks.length}>{bullets.map((b, i) => <li key={i}>{inline(b)}</li>)}</ul>);
    bullets = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
    if (bullet) bullets.push(bullet[1]!);
    else {
      flush();
      if (line) blocks.push(<p key={blocks.length}>{inline(line.replace(/^#+\s*/, ""))}</p>);
    }
  }
  flush();
  return <>{blocks}</>;
}

/**
 * "Ask the data": a chat about the current view. Hidden unless the server
 * has an AI endpoint configured. Questions use the filters on screen.
 */
export function AskData({ filters }: { filters: LflFilters }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/v1/lfl/ask")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setEnabled(Boolean(body?.enabled ?? body?.data?.enabled)))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const history = messages.filter((m) => !m.error).slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages((m) => [...m, { role: "user", content: q }]);
    setDraft("");
    setBusy(true);
    try {
      const response = await fetch(`/api/v1/lfl/ask?${toSearchParams(filters)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error?.message || response.statusText);
      const result: AskAnswerDto = body?.data ?? body ?? { answer: "" };
      setMessages((m) => [...m, { role: "assistant", content: result.answer, queries: result.queries }]);
    } catch (error) {
      setMessages((m) => [...m, { role: "assistant", content: error instanceof Error ? error.message : String(error), error: true }]);
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) return null;
  return (
    <>
      <button className="btn ask-btn" type="button" onClick={() => setOpen(true)}>
        <Icon name="chat" /> Ask the data
      </button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        label="Ask the data"
        header={
          <>
            <h2>Ask the data</h2>
            <span className="sub">Answers use the dates and filters on screen</span>
          </>
        }
      >
        <div className="ask">
          <div className="ask-log">
            {messages.length === 0 ? (
              <div className="ask-empty">
                <p className="muted">Try one of these, or type your own:</p>
                {SUGGESTIONS.map((s) => (
                  <button key={s} className="chip" type="button" onClick={() => void ask(s)}>
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`bubble ${m.role}${m.error ? " error" : ""}`}>
                  {m.role === "assistant" && !m.error ? <Rich text={m.content} /> : m.content}
                  {m.queries?.length ? (
                    <details className="ask-sql">
                      <summary>
                        {m.queries.length} quer{m.queries.length === 1 ? "y" : "ies"} run on BigQuery
                      </summary>
                      {m.queries.map((q, j) => (
                        <div key={j} className="ask-sql-q">
                          <b>{q.purpose}</b> <span className="muted">{q.error ? `· failed: ${q.error}` : `· ${q.rows} row${q.rows === 1 ? "" : "s"}`}</span>
                          <pre>{q.sql}</pre>
                        </div>
                      ))}
                    </details>
                  ) : null}
                </div>
              ))
            )}
            {busy ? <div className="bubble assistant muted">Looking at the numbers (and querying BigQuery if needed)…</div> : null}
            <div ref={end} />
          </div>
          <form
            className="ask-input"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(draft);
            }}
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="e.g. Why is Bengaluru down this month?"
              maxLength={600}
              aria-label="Your question"
            />
            <button className="btn primary icon-only" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
              <Icon name="send" />
            </button>
          </form>
          <p className="ask-note muted">AI answers can be wrong. Check important numbers in the tables.</p>
        </div>
      </Drawer>
    </>
  );
}
