// Repro of the exact /api/chat pipeline to surface the real error.
import { readFileSync } from "node:fs";
import { streamText, convertToModelMessages, stepCountIs, tool } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";

for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

// minimal UIMessage exactly like @ai-sdk/react useChat sends
const messages = [
  {
    id: "1",
    role: "user",
    parts: [
      { type: "text", text: "14-inch MacBook Pro refurb with M4 Pro, 24GB+, 1TB+ under 1500 USD" },
    ],
  },
];

try {
  const tools = {
    test_watch: tool({
      description: "Run a watch live without saving.",
      inputSchema: z.object({
        source: z.string(),
        category: z.string().optional(),
        criteria: z.record(z.string(), z.any()),
      }),
      async execute() {
        return { ok: true };
      },
    }),
    create_watch: tool({
      description: "Persist a watch.",
      inputSchema: z.object({
        name: z.string(),
        source: z.string(),
        criteria: z.record(z.string(), z.any()),
        channels: z.array(z.enum(["email", "web-push", "sms"])).default(["email"]),
        every_minutes: z.number().int().min(5).default(10),
      }),
      async execute() {
        return { ok: true };
      },
    }),
  };

  const result = streamText({
    model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
    system: "You are Nabit. Ask the user what they need, then help.",
    messages: convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(4),
  });

  let text = "";
  for await (const chunk of result.textStream) text += chunk;
  console.log("RESPONSE:", text.slice(0, 300));
  console.log("OK ✅");
} catch (e) {
  console.error("CHAT PIPELINE ERROR ❌");
  console.error("name:", e.name);
  console.error("message:", e.message);
  if (e.cause) console.error("cause:", JSON.stringify(e.cause).slice(0, 500));
  if (e.responseBody) console.error("responseBody:", String(e.responseBody).slice(0, 500));
  process.exit(1);
}
