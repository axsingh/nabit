/**
 * End-to-end verification of the REAL agent (exact production code paths):
 * same lib/watch-tools.ts, same model + SYSTEM prompt as app/api/chat,
 * real Groq, real Supabase. Creates a temp user, drives a scripted
 * conversation, asserts a correct watch row is persisted, then cleans up.
 *
 * Run: npx tsx scripts/verify-agent.ts
 */
import { readFileSync } from "node:fs";
import ws from "ws";
// @ts-expect-error local Node<22 polyfill for supabase-js realtime
globalThis.WebSocket ||= ws;
import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createClient } from "@supabase/supabase-js";
import { buildTools } from "../lib/watch-tools";

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
const admin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

// Exact system prompt from app/api/chat/route.ts (kept in sync).
const SYSTEM = readFileSync(new URL("../app/api/chat/route.ts", import.meta.url), "utf8")
  .match(/const SYSTEM = `([\s\S]*?)`;/)![1];

const EMAIL = "agent-verify@example.com";

async function main() {
  const list = await admin.auth.admin.listUsers();
  const ex = list.data.users.find((u) => u.email === EMAIL);
  if (ex) await admin.auth.admin.deleteUser(ex.id);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
  });
  if (error) throw error;
  const userId = created.user.id;
  console.log("temp user:", userId);

  const tools = buildTools(admin as never, userId);

  const messages: ModelMessage[] = [
    {
      role: "user",
      content:
        "Watch Apple refurbished (source apple-refurb, category macbook-pro) for a " +
        "14-inch MacBook Pro with an M4 Pro or M5 Pro chip, 24GB+ RAM, 1TB+ storage, " +
        "priced under $1899. Email me, alert once then pause, check every 10 min. " +
        "Run a quick live test, then go ahead and create it — I confirm.",
    },
  ];

  const res = await generateText({
    model: groq(MODEL),
    system: SYSTEM,
    messages,
    tools,
    stopWhen: stepCountIs(8),
  });

  const toolNames = res.steps.flatMap((s) =>
    s.toolCalls.map((t) => t.toolName)
  );
  console.log("tools called:", toolNames.join(", ") || "(none)");
  console.log("final:", res.text.slice(0, 200).replace(/\n/g, " "));

  const { data: watches } = await admin
    .from("watches")
    .select("name,source,category,criteria,channels,alert_mode,schedule,status")
    .eq("user_id", userId);

  console.log("\nwatches persisted:", JSON.stringify(watches, null, 2));

  const w = watches?.[0];
  const ok =
    !!w &&
    w.source === "apple-refurb" &&
    w.category === "macbook-pro" &&
    w.criteria &&
    typeof w.criteria === "object" &&
    (w.criteria.priceBelow === 1899 || w.criteria.price_below === 1899);

  await admin.auth.admin.deleteUser(userId); // cascade cleanup
  console.log("\nAGENT E2E:", ok ? "PASS ✅" : "FAIL ❌");
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
