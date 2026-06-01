"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";

export default function Chat() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { messages, sendMessage, status, error } = useChat({
    onFinish: () => router.refresh(), // refresh dashboard if a watch was created
  });
  const busy = status === "submitted" || status === "streaming";

  // Focus the input on mount.
  useEffect(() => {
    taRef.current?.focus();
  }, []);

  // Auto-grow the textarea with the content, capped to ~8 lines then scroll.
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 220) + "px";
  }, [input]);

  // Auto-scroll the messages container to the bottom on new content.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    sendMessage({ text });
    setInput("");
    requestAnimationFrame(() => taRef.current?.focus());
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div
        ref={scrollRef}
        className="max-h-[60vh] min-h-[200px] space-y-3 overflow-y-auto p-5"
      >
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 py-8 text-center">
            <p className="max-w-md text-sm text-zinc-500">
              Tell me what deal to watch. I&apos;ll ask what I need, show you
              live results, then set it up.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {[
                "Watch a 14″ MacBook Pro refurb (M4/M5 Pro, 24GB+, 1TB+) under $1,899",
                "Watch any iPad Pro M4 refurb under $899",
                "What watches do I have?",
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setInput(s);
                    requestAnimationFrame(() => taRef.current?.focus());
                  }}
                  className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                m.role === "user"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                  : "bg-zinc-100 text-zinc-900 dark:bg-zinc-900 dark:text-zinc-100"
              }`}
            >
              {m.parts.map((p, i) => {
                if (p.type === "text") return <span key={i}>{p.text}</span>;
                if (p.type.startsWith("tool-"))
                  return (
                    <span
                      key={i}
                      className="mt-1 block text-xs italic text-zinc-400"
                    >
                      · {p.type.replace("tool-", "")}…
                    </span>
                  );
                return null;
              })}
            </div>
          </div>
        ))}

        {busy && (
          <div className="flex justify-start">
            <div className="flex items-center gap-1 rounded-2xl bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-zinc-400" />
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error.message || "Something went wrong. Please try again."}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-end gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <textarea
          ref={taRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe a deal to watch…  (Enter to send · Shift+Enter for newline)"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-zinc-300 bg-transparent px-3 py-2 text-sm leading-relaxed outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:focus:ring-zinc-800"
          style={{ maxHeight: 220 }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="shrink-0 rounded-xl bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          Send
        </button>
      </form>
    </div>
  );
}
