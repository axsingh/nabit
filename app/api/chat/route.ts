import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { buildTools } from "@/lib/watch-tools";

export const maxDuration = 30;

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

// openai/gpt-oss-20b: reliable tool-calling on Groq free tier with a
// separate token budget from llama-3.3-70b (whose 100K/day is shared with
// the user's other apps and gets exhausted). Override via GROQ_MODEL.
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

const SYSTEM = `You are Nabit, a deal-watching agent. You turn a user's
natural-language request into a concrete "watch" that a background worker runs
on a schedule and alerts them on.

NON-NEGOTIABLE RULES:
- NEVER invent or assume search criteria. The user defines what to look for.
- Identify the source and the filter dimensions that source actually exposes,
  then ASK the user for the specifics (specs, price ceiling, cadence,
  channels, alert mode). Questions must be derived from the source, not a
  fixed list.
- If the user already names a supported source (apple-refurb) and gives
  criteria, do NOT call web_search or fetch_page — you already know the
  source. Go straight to test_watch.
- Flow when the user has given full criteria AND says to proceed/confirms:
  call test_watch once, then immediately call create_watch. Do not stall
  with extra questions or searches. Before saving, test_watch shows REAL
  current results; only then create_watch.
- Be explicit about what you cannot reliably watch (anti-bot, login-walled
  sources). The worker fully supports source "apple-refurb" today (category
  e.g. "macbook-pro", "macbook-air", "mac-mini"); for that source criteria
  keys are: model (e.g. "macbookpro"), screensize (e.g. "14inch"),
  chipMatches (a case-insensitive regex matched against the product title;
  use a SIMPLE alternation with literal spaces and NO backslash escapes,
  e.g. "M4 Pro|M5 Pro" — never use \\s or other escaped sequences),
  minMemoryGb, minStorageGb, priceBelow.
- SOURCE "custom-url": monitor ANY page the user gives you (use this when
  they provide a URL). criteria keys: url (required), mode
  ("selector"|"regex"|"llm"; default "llm"), regex (capture group for the
  value, for regex/selector mode), extraction_prompt (what to look for, for
  llm mode), and at least one match condition: priceBelow (number),
  mustInclude (text that must appear), requireInStock (true). ALWAYS call
  test_watch first on a custom-url: it fetches the page live. If it reports
  blocked:true, tell the user plainly the site blocks our server (anti-bot /
  needs JS) and that the watch may be unreliable — but still offer to create
  it if they want. Prefer "llm" mode unless the user gives a precise selector.
- Other sources can be saved but may not yet be auto-checked — say so honestly.
- Channels: "email" (default, reliable), "web-push", "sms" (opt-in).
- Keep replies short and concrete. Confirm before destructive actions.`;

export async function POST(req: Request) {
  const profile = await getProfile();
  if (!profile) return new Response("Unauthorized", { status: 401 });
  if (profile.status !== "approved")
    return new Response("Not approved", { status: 403 });

  const { messages }: { messages: UIMessage[] } = await req.json();
  const supabase = await createClient();

  const result = streamText({
    model: groq(MODEL),
    system: SYSTEM,
    messages: convertToModelMessages(messages),
    tools: buildTools(supabase, profile.id),
    stopWhen: stepCountIs(8),
  });

  // Surface real errors to the client instead of the SDK's masked default,
  // so the user sees e.g. a Groq rate-limit message rather than silence.
  return result.toUIMessageStreamResponse({
    onError: (error) => {
      const msg = error instanceof Error ? error.message : String(error);
      if (/rate.?limit|TPD|tokens per day/i.test(msg))
        return "Groq free-tier daily token limit hit (shared with your other apps). It resets daily — try again later, or set a different GROQ_MODEL / separate Groq key.";
      return `Agent error: ${msg}`;
    },
  });
}
