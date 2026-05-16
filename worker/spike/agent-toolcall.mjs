// Spike: confirm Groq + AI SDK v5 actually performs multi-step tool calls
// with our model. Throwaway verification (not shipped logic).
import { generateText, tool, stepCountIs } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { readFileSync } from "node:fs";
import { z } from "zod";

// load GROQ_API_KEY from .env
for (const line of readFileSync(
  new URL("../../.env", import.meta.url),
  "utf8"
).split("\n")) {
  const m = line.match(/^GROQ_API_KEY=(.+)$/);
  if (m) process.env.GROQ_API_KEY = m[1].trim();
}

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

let toolCalled = false;
const res = await generateText({
  model: groq("llama-3.3-70b-versatile"),
  stopWhen: stepCountIs(4),
  tools: {
    get_price: tool({
      description: "Get the current price of a product by name.",
      inputSchema: z.object({ product: z.string() }),
      async execute({ product }) {
        toolCalled = true;
        return { product, price: 1799 };
      },
    }),
  },
  prompt:
    "Use the get_price tool to find the price of 'MacBook Pro 14', then tell me the number.",
});

console.log("tool was called:", toolCalled);
console.log("final text:", res.text.trim());
console.log("steps:", res.steps.length);
process.exit(toolCalled && /1799/.test(res.text) ? 0 : 1);
