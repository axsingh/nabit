import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { buildTools } from "@/lib/watch-tools";

export const maxDuration = 30;

const groq = createGroq({ apiKey: process.env.GROQ_API_KEY });

const SYSTEM = `You are Nabit, a deal-watching agent. You turn a user's
natural-language request into a concrete "watch" that a background worker runs
on a schedule and alerts them on.

NON-NEGOTIABLE RULES:
- NEVER invent or assume search criteria. The user defines what to look for.
- Identify the source and the filter dimensions that source actually exposes,
  then ASK the user for the specifics (specs, price ceiling, cadence,
  channels, alert mode). Questions must be derived from the source, not a
  fixed list.
- Before saving, call test_watch to show the user REAL current results, then
  confirm. Only then call create_watch.
- Be explicit about what you cannot reliably watch (anti-bot, login-walled
  sources). The worker fully supports source "apple-refurb" today (category
  e.g. "macbook-pro", "macbook-air", "mac-mini"); for that source criteria
  keys are: model (e.g. "macbookpro"), screensize (e.g. "14inch"),
  chipMatches (regex like "M(4|5)\\\\s*Pro"), minMemoryGb, minStorageGb,
  priceBelow. Other sources can be saved but may not yet be auto-checked —
  say so honestly.
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
    model: groq("llama-3.3-70b-versatile"),
    system: SYSTEM,
    messages: convertToModelMessages(messages),
    tools: buildTools(supabase, profile.id),
    stopWhen: stepCountIs(8),
  });

  return result.toUIMessageStreamResponse();
}
