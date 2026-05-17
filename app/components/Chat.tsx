"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { useRouter } from "next/navigation";

export default function Chat() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error } = useChat({
    onFinish: () => router.refresh(), // refresh dashboard if a watch was created
  });
  const busy = status === "submitted" || status === "streaming";

  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 dark:border-zinc-800">
      <div className="max-h-[60vh] min-h-[280px] space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="text-sm text-zinc-400">
            Tell me what deal to watch — e.g. &ldquo;a 14&Prime; MacBook Pro
            refurb with M4 Pro, 24GB+, 1TB+, under $1,899&rdquo;. I&apos;ll ask
            what I need, show you live results, then set it up.
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "text-right" : "text-left"}
          >
            <div
              className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                m.role === "user"
                  ? "bg-zinc-900 text-white dark:bg-white dark:text-black"
                  : "bg-zinc-100 dark:bg-zinc-900"
              }`}
            >
              {m.parts.map((p, i) => {
                if (p.type === "text") return <span key={i}>{p.text}</span>;
                if (p.type.startsWith("tool-"))
                  return (
                    <span
                      key={i}
                      className="block text-xs italic text-zinc-400"
                    >
                      · {p.type.replace("tool-", "")}…
                    </span>
                  );
                return null;
              })}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-zinc-400">thinking…</p>}
        {error && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error.message || "Something went wrong. Please try again."}
          </p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!input.trim() || busy) return;
          sendMessage({ text: input });
          setInput("");
        }}
        className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Describe a deal to watch…"
          className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-black"
        >
          Send
        </button>
      </form>
    </div>
  );
}
