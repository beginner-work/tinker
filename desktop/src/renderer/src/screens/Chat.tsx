import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { streamChat } from "../lib/api";
import type {
  AuthUser,
  ChatError,
  ChatMessage,
  Conversation,
} from "../types";

interface Props {
  token: string;
  user: AuthUser | null;
  onLogout: () => void | Promise<void>;
}

const newId = () => "j_" + Math.random().toString(36).slice(2, 10);

function emptyJourney(): Conversation {
  return { id: newId(), title: "New journey", messages: [] };
}

// A "step" is one question + one response. The Conversation.messages array
// alternates user / assistant; we group them into steps for rendering so
// the right pane reads like a guided onboarding flow rather than a chat log.
interface Step {
  index: number;
  prompt: string;
  response: string;
  streaming: boolean;
}

function toSteps(messages: ChatMessage[], streaming: boolean): Step[] {
  const out: Step[] = [];
  for (let i = 0; i < messages.length; i += 2) {
    const userMsg = messages[i];
    const aiMsg = messages[i + 1];
    if (!userMsg || userMsg.role !== "user") continue;
    out.push({
      index: out.length + 1,
      prompt: userMsg.content,
      response: aiMsg && aiMsg.role === "assistant" ? aiMsg.content : "",
      streaming: streaming && i + 1 === messages.length - 1,
    });
  }
  return out;
}

export function Chat({ token, user, onLogout }: Props) {
  // TODO(persistence): journeys live in-memory only — they vanish on app
  // quit. The backend is fully stateless (every request sends the full
  // history), so persistence is purely a client concern.
  const [journeys, setJourneys] = useState<Conversation[]>(() => [
    emptyJourney(),
  ]);
  const [activeId, setActiveId] = useState<string>(() => journeys[0].id);
  const [composerText, setComposerText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [thinking, setThinking] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const active = useMemo(
    () => journeys.find((c) => c.id === activeId) ?? journeys[0],
    [journeys, activeId]
  );

  const steps = useMemo(
    () => toSteps(active.messages, streaming),
    [active.messages, streaming]
  );
  const isFresh = steps.length === 0;
  const stepCount = steps.length;

  // Auto-grow the composer textarea so it reads like a writing surface,
  // not a chat input.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 240) + "px";
  }, [composerText]);

  // Keep the latest step in view as new prose streams in.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [steps, thinking]);

  const updateActive = useCallback(
    (mut: (c: Conversation) => Conversation) => {
      setJourneys((all) => all.map((c) => (c.id === activeId ? mut(c) : c)));
    },
    [activeId]
  );

  const newJourney = useCallback(() => {
    const fresh = emptyJourney();
    setJourneys((all) => [fresh, ...all]);
    setActiveId(fresh.id);
    setError(null);
    setThinking("");
  }, []);

  async function handleSend(e?: FormEvent) {
    e?.preventDefault();
    if (streaming) return;
    const text = composerText.trim();
    if (!text) return;

    setError(null);
    setThinking("");
    setComposerText("");

    const userMsg: ChatMessage = { role: "user", content: text };
    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    let outgoing: ChatMessage[] = [];

    setJourneys((all) =>
      all.map((c) => {
        if (c.id !== activeId) return c;
        const messages = [...c.messages, userMsg];
        outgoing = messages;
        const title =
          c.messages.length === 0
            ? text.replace(/\s+/g, " ").slice(0, 56) || c.title
            : c.title;
        return { ...c, title, messages: [...messages, assistantMsg] };
      })
    );

    setStreaming(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    let pendingError: ChatError | null = null;

    await streamChat(token, outgoing, {
      signal: ctrl.signal,
      onText: (chunk) => {
        updateActive((c) => {
          const msgs = c.messages.slice();
          const lastIdx = msgs.length - 1;
          const last = msgs[lastIdx];
          if (last && last.role === "assistant") {
            msgs[lastIdx] = { ...last, content: last.content + chunk };
          }
          return { ...c, messages: msgs };
        });
      },
      onThinking: (chunk) => {
        setThinking((prev) => prev + chunk);
      },
      onError: (err) => {
        pendingError = err;
      },
      onDone: () => {
        setStreaming(false);
        abortRef.current = null;
        if (pendingError) {
          setError(pendingError);
          updateActive((c) => {
            const msgs = c.messages.slice();
            const lastIdx = msgs.length - 1;
            const last = msgs[lastIdx];
            if (last && last.role === "assistant" && !last.content) {
              msgs.pop();
            }
            return { ...c, messages: msgs };
          });
          if (pendingError.kind === "unauthorized") {
            void onLogout();
          }
        }
      },
    });
  }

  function handleAbort() {
    abortRef.current?.abort();
  }

  return (
    <div className="flex h-full w-full">
      {/* ── Left rail: journeys, with each step listed as a TOC entry ── */}
      <aside className="drag-region flex w-[260px] flex-shrink-0 flex-col border-r border-border bg-gradient-to-b from-parchment to-cream">
        <div className="h-[52px]" />

        <div className="no-drag px-3 pb-2">
          <button
            type="button"
            onClick={newJourney}
            className="flex w-full items-center gap-2 rounded-xl bg-forest/[0.06] px-3 py-2.5 text-sm font-semibold text-forest transition hover:bg-forest/10"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            Begin a new journey
          </button>
        </div>

        <div className="no-drag px-4 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
          Journeys
        </div>

        <div className="no-drag flex-1 overflow-y-auto px-2 pb-2">
          {journeys.map((c) => {
            const isActive = c.id === activeId;
            const stepsHere = toSteps(c.messages, false);
            return (
              <button
                type="button"
                key={c.id}
                onClick={() => {
                  setActiveId(c.id);
                  setError(null);
                  setThinking("");
                }}
                className={
                  "mb-1 flex w-full flex-col items-start gap-0.5 rounded-lg px-2.5 py-2 text-left transition " +
                  (isActive
                    ? "border border-border bg-white shadow-soft"
                    : "border border-transparent hover:bg-white/60")
                }
                title={c.title}
              >
                <span
                  className={
                    "block w-full truncate text-[13px] " +
                    (isActive
                      ? "font-semibold text-foreground"
                      : "text-muted")
                  }
                >
                  {c.title}
                </span>
                <span className="text-[11px] text-muted">
                  {stepsHere.length === 0
                    ? "Not started"
                    : `${stepsHere.length} step${stepsHere.length === 1 ? "" : "s"}`}
                </span>
              </button>
            );
          })}
        </div>

        <div className="no-drag border-t border-border/60 px-4 py-3 text-[11px] text-muted">
          {user?.email ? <div className="truncate">{user.email}</div> : null}
          <div>&copy; 2026 tinker</div>
        </div>
      </aside>

      {/* ── Right pane: a guided journey, not a chat ────────────────── */}
      <main className="flex flex-1 flex-col overflow-hidden bg-background">
        <header className="drag-region flex h-[52px] items-center justify-between border-b border-border px-6">
          <div className="no-drag flex items-center gap-3">
            <ProgressDots count={stepCount} streaming={streaming} />
            <div className="font-display text-[13px] font-semibold tracking-tight text-muted">
              {isFresh ? "Ready when you are" : active.title}
            </div>
          </div>
          <div className="no-drag flex items-center gap-2">
            {streaming && (
              <button type="button" onClick={handleAbort} className="btn-ghost">
                Stop
              </button>
            )}
            <button
              type="button"
              onClick={() => onLogout()}
              className="btn-ghost"
            >
              Log out
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-8">
          <div className="mx-auto max-w-[640px]">
            {isFresh ? (
              <HeroBegin
                value={composerText}
                onChange={setComposerText}
                onSubmit={() => void handleSend()}
                textareaRef={textareaRef}
                disabled={streaming}
              />
            ) : (
              <div className="flex flex-col gap-12 py-12">
                {steps.map((step) => (
                  <StepCard key={step.index} step={step} total={stepCount} />
                ))}

                {thinking && <ThinkingTrace text={thinking} />}

                {error && (
                  <ErrorNotice
                    error={error}
                    onDismiss={() => setError(null)}
                  />
                )}
              </div>
            )}
          </div>
        </div>

        {/* The composer only appears once we're mid-journey; the empty
            state has its own hero input above. */}
        {!isFresh && (
          <form
            onSubmit={handleSend}
            className="border-t border-border bg-white/60 px-8 py-5"
          >
            <div className="mx-auto flex max-w-[640px] items-end gap-3">
              <div className="flex-1">
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                  Step {stepCount + 1} — your turn
                </div>
                <textarea
                  ref={textareaRef}
                  value={composerText}
                  onChange={(e) => setComposerText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={1}
                  placeholder="Where would you like to go next?"
                  disabled={streaming}
                  className="block w-full resize-none border-0 bg-transparent p-0 font-display text-[16px] leading-relaxed text-foreground placeholder:text-muted/60 focus:outline-none focus:ring-0 disabled:opacity-60"
                />
              </div>
              <button
                type="submit"
                disabled={streaming || !composerText.trim()}
                className="btn-primary"
              >
                {streaming ? "…" : "Continue →"}
              </button>
            </div>
          </form>
        )}
      </main>
    </div>
  );
}

function HeroBegin({
  value,
  onChange,
  onSubmit,
  textareaRef,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
  disabled: boolean;
}) {
  return (
    <section className="flex min-h-[60vh] flex-col items-stretch justify-center py-14 animate-fade-in-up">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">
        Step 1
      </div>
      <h1 className="mb-2 font-display text-[40px] font-bold leading-[1.05] tracking-tight text-foreground">
        What are we exploring today?
      </h1>
      <p className="mb-8 font-display text-[16px] leading-relaxed text-muted">
        Type a question, a goal, or a half-formed idea. Each reply opens
        the next step of the journey.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex flex-col gap-3"
      >
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          autoFocus
          placeholder="e.g. help me plan a week-long trip to Lisbon"
          disabled={disabled}
          className="block w-full resize-none rounded-2xl border border-border bg-white px-5 py-4 font-display text-[18px] leading-relaxed text-foreground shadow-soft placeholder:text-muted/60 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/20 disabled:opacity-60"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={disabled || !value.trim()}
            className="btn-primary"
          >
            Begin →
          </button>
        </div>
      </form>
    </section>
  );
}

function ProgressDots({
  count,
  streaming,
}: {
  count: number;
  streaming: boolean;
}) {
  if (count === 0) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <span className="h-1.5 w-6 rounded-full bg-accent/30" />
      </span>
    );
  }
  // Show up to 5 dots; if we have more, the trailing one represents "more".
  const visible = Math.min(count, 5);
  const dots = Array.from({ length: visible });
  return (
    <span className="inline-flex items-center gap-1.5">
      {dots.map((_, i) => {
        const isLast = i === visible - 1;
        const active = streaming && isLast;
        return (
          <span
            key={i}
            className={
              "h-1.5 rounded-full transition-all " +
              (active
                ? "w-6 animate-pulse bg-accent"
                : "w-3 bg-accent/60")
            }
          />
        );
      })}
      {count > 5 && (
        <span className="text-[11px] font-semibold text-muted">
          +{count - 5}
        </span>
      )}
    </span>
  );
}

function StepCard({ step, total }: { step: Step; total: number }) {
  const paragraphs = splitParagraphs(step.response);
  const isCurrent = step.index === total;
  return (
    <article
      className={
        "rounded-3xl border bg-white px-7 py-6 transition " +
        (isCurrent
          ? "border-border shadow-soft animate-fade-in-up"
          : "border-border/70 opacity-95")
      }
    >
      <header className="mb-4 flex items-center gap-2">
        <span className="rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">
          Step {step.index} of {total}
        </span>
      </header>

      <div className="mb-4">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-forest">
          You wrote
        </div>
        <blockquote className="border-l-2 border-leaf pl-4 font-display text-[15.5px] leading-relaxed text-foreground/90">
          {splitParagraphs(step.prompt).map((p, i) => (
            <p key={i} className="mb-2 last:mb-0 whitespace-pre-wrap">
              {p}
            </p>
          ))}
        </blockquote>
      </div>

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-accent">
          Claude responds
        </div>
        <div className="font-display text-[16.5px] leading-[1.7] text-foreground">
          {paragraphs.length === 0 && step.streaming ? (
            <p className="text-muted">
              <ThinkingDots />
            </p>
          ) : (
            paragraphs.map((p, i) => {
              const isLastPara = i === paragraphs.length - 1;
              return (
                <p
                  key={i}
                  className={
                    "mb-3 last:mb-0 whitespace-pre-wrap" +
                    (step.streaming && isLastPara ? " cursor-blink" : "")
                  }
                >
                  {p}
                </p>
              );
            })
          )}
        </div>
      </div>
    </article>
  );
}

function ThinkingTrace({ text }: { text: string }) {
  return (
    <details className="rounded-2xl border border-dashed border-border bg-card/60 px-4 py-3 text-sm text-muted">
      <summary className="cursor-pointer select-none font-semibold text-muted">
        Reasoning trace
      </summary>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
        {text}
      </pre>
    </details>
  );
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:0ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:200ms]" />
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent [animation-delay:400ms]" />
    </span>
  );
}

function splitParagraphs(text: string): string[] {
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

function ErrorNotice({
  error,
  onDismiss,
}: {
  error: ChatError;
  onDismiss: () => void;
}) {
  let body: string = error.message;
  if (error.kind === "rate_limit" && error.retryAt) {
    const at = new Date(error.retryAt);
    const local = isNaN(at.getTime()) ? error.retryAt : at.toLocaleString();
    body = `Daily limit reached, resets at ${local}`;
  } else if (error.kind === "misconfigured") {
    body = "Server misconfigured — contact admin.";
  }

  return (
    <aside className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-rose-700">
            We hit a snag
          </div>
          <div className="mt-1 font-display text-[15px] leading-relaxed">
            {body}
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-rose-600 hover:text-rose-900"
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </aside>
  );
}
