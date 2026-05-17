import { tool } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runAppleRefurb } from "@/lib/sources/apple-refurb";

// Some models pass object args as a JSON string. Coerce defensively so a
// model quirk never causes a silent "nothing happens".
const jsonObject = z.preprocess((v) => {
  if (typeof v === "string") {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}, z.record(z.string(), z.any()));

// Builds the agent's tool set, scoped to one authenticated user.
// All DB writes go through the user's RLS-scoped client.
export function buildTools(supabase: SupabaseClient, userId: string) {
  return {
    web_search: tool({
      description:
        "Search the web to find candidate source URLs / pages for a watch. Use when you don't already know where to look.",
      inputSchema: z.object({ query: z.string() }),
      async execute({ query }) {
        try {
          const r = await fetch(
            "https://duckduckgo.com/html/?q=" + encodeURIComponent(query),
            { headers: { "User-Agent": "Mozilla/5.0" } }
          );
          const html = await r.text();
          const results = [
            ...html.matchAll(
              /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g
            ),
          ]
            .slice(0, 5)
            .map((m) => ({
              url: decodeURIComponent(
                (m[1].match(/uddg=([^&]+)/)?.[1] ?? m[1]) as string
              ),
              title: m[2].replace(/<[^>]+>/g, "").trim(),
            }));
          return { results };
        } catch (e) {
          return { error: String(e), results: [] };
        }
      },
    }),

    fetch_page: tool({
      description:
        "Fetch a URL and return its visible text (truncated). Use to verify what data a source actually exposes before creating a watch.",
      inputSchema: z.object({ url: z.string() }),
      async execute({ url }) {
        try {
          const r = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0" },
          });
          const text = (await r.text())
            .replace(/<script[\s\S]*?<\/script>/g, " ")
            .replace(/<style[\s\S]*?<\/style>/g, " ")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim();
          return { status: r.status, text: text.slice(0, 4000) };
        } catch (e) {
          return { error: String(e) };
        }
      },
    }),

    test_watch: tool({
      description:
        "Run a watch's source+criteria LIVE right now WITHOUT saving it, to show the user real current results before they commit. Currently fully supported for source 'apple-refurb'.",
      inputSchema: z.object({
        source: z.string(),
        category: z.string().optional(),
        criteria: jsonObject,
      }),
      async execute({ source, category, criteria }) {
        if (source !== "apple-refurb") {
          return {
            supported: false,
            message: `Live test isn't available for source "${source}" yet. You can still create the watch; the background worker supports apple-refurb today and more sources are being added.`,
          };
        }
        try {
          const { scanned, matches } = await runAppleRefurb(
            category ?? "macbook-pro",
            criteria
          );
          return {
            supported: true,
            scanned,
            matchCount: matches.length,
            matches: matches.slice(0, 10),
          };
        } catch (e) {
          return { supported: true, error: String(e) };
        }
      },
    }),

    create_watch: tool({
      description:
        "Persist a new watch for the user. Only call AFTER confirming source, criteria, price/threshold, schedule, channels and alert mode WITH the user. Never invent criteria.",
      inputSchema: z.object({
        name: z.string(),
        description: z.string().optional(),
        source: z.string(),
        category: z.string().optional(),
        criteria: jsonObject,
        channels: z.array(z.enum(["email", "web-push", "sms"])).default(["email"]),
        alert_mode: z
          .enum(["once_then_pause", "every_match", "daily_digest"])
          .default("once_then_pause"),
        every_minutes: z.number().int().min(5).default(10),
      }),
      async execute(args) {
        const { data, error } = await supabase
          .from("watches")
          .insert({
            user_id: userId,
            name: args.name,
            description: args.description ?? null,
            source: args.source,
            category: args.category ?? null,
            criteria: args.criteria,
            channels: args.channels,
            alert_mode: args.alert_mode,
            schedule: { everyMinutes: args.every_minutes },
            status: "active",
          })
          .select("id,name")
          .single();
        if (error) return { error: error.message };
        return { created: data };
      },
    }),

    list_watches: tool({
      description: "List the user's watches.",
      inputSchema: z.object({}),
      async execute() {
        const { data, error } = await supabase
          .from("watches")
          .select("id,name,source,category,status,alert_mode,channels,created_at")
          .order("created_at", { ascending: false });
        return error ? { error: error.message } : { watches: data };
      },
    }),

    update_watch: tool({
      description: "Update fields on an existing watch by id.",
      inputSchema: z.object({
        id: z.string(),
        patch: jsonObject,
      }),
      async execute({ id, patch }) {
        const { error } = await supabase
          .from("watches")
          .update(patch)
          .eq("id", id);
        return error ? { error: error.message } : { ok: true };
      },
    }),

    set_watch_status: tool({
      description: "Pause or resume a watch.",
      inputSchema: z.object({
        id: z.string(),
        status: z.enum(["active", "paused"]),
      }),
      async execute({ id, status }) {
        const { error } = await supabase
          .from("watches")
          .update({ status })
          .eq("id", id);
        return error ? { error: error.message } : { ok: true };
      },
    }),

    delete_watch: tool({
      description: "Delete a watch by id.",
      inputSchema: z.object({ id: z.string() }),
      async execute({ id }) {
        const { error } = await supabase.from("watches").delete().eq("id", id);
        return error ? { error: error.message } : { ok: true };
      },
    }),
  };
}
