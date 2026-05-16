// Nabit watch executor — runs on GitHub Actions cron (every 10 min) or
// locally via `npm run watch:once`.
//
// Reads ACTIVE, due watches from Supabase (service-role, RLS-bypass), runs
// the matching source adapter, dedupes via the alerts unique index
// (watch_id, dedupe_key), dispatches notifications, applies alert_mode,
// and logs every run to watch_runs.

import { readFileSync } from "node:fs";
import ws from "ws";
// supabase-js inits a realtime client needing global WebSocket (Node < 22).
globalThis.WebSocket ||= ws;
import { createClient } from "@supabase/supabase-js";
import { runAppleRefurb } from "./sources/apple-refurb.mjs";
import { notify } from "./notify.mjs";

// Local dev: load .env if vars not already in the environment (CI sets them).
if (!process.env.SUPABASE_URL) {
  try {
    for (const line of readFileSync(
      new URL("../.env", import.meta.url),
      "utf8"
    ).split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("FATAL: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// adapter registry: source -> fn(watch) -> { scanned, matches:[{...,dedupeKey}] }
const SOURCES = {
  "apple-refurb": (w) =>
    runAppleRefurb({ category: w.category, criteria: w.criteria }),
};

function isDue(w) {
  if (!w.last_checked_at) return true;
  const everyMin = w.schedule?.everyMinutes ?? 10;
  return Date.now() - new Date(w.last_checked_at).getTime() >= everyMin * 60_000;
}

async function ownerEmail(userId) {
  const { data } = await db
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .single();
  return data?.email ?? process.env.ALERT_TO_EMAIL ?? null;
}

async function runWatch(w) {
  const started = Date.now();
  const log = (status, error = null) =>
    db.from("watch_runs").insert({
      user_id: w.user_id,
      watch_id: w.id,
      status,
      duration_ms: Date.now() - started,
      llm_calls: 0, // structured source: no LLM
      error,
    });

  const runner = SOURCES[w.source];
  if (!runner) {
    console.log(`  skip "${w.name}": source "${w.source}" not auto-checked yet`);
    await log("no_match", `unsupported source ${w.source}`);
    await db
      .from("watches")
      .update({ last_checked_at: new Date().toISOString() })
      .eq("id", w.id);
    return 0;
  }

  let result;
  try {
    result = await runner(w);
  } catch (e) {
    const fail = (w.fail_count ?? 0) + 1;
    const patch = { fail_count: fail, last_checked_at: new Date().toISOString() };
    if (fail >= 5) patch.status = "paused"; // source-breakage guard
    await db.from("watches").update(patch).eq("id", w.id);
    await log("fetch_error", String(e));
    console.error(
      `  "${w.name}" error: ${e.message}${fail >= 5 ? " (auto-paused)" : ""}`
    );
    return 0;
  }

  let sent = 0;
  const to = await ownerEmail(w.user_id);
  for (const m of result.matches) {
    // Dedupe via unique index (watch_id, dedupe_key): insert, ignore conflict.
    const { error: insErr } = await db.from("alerts").insert({
      user_id: w.user_id,
      watch_id: w.id,
      dedupe_key: m.dedupeKey,
      payload: {
        title: m.title,
        price: m.price,
        url: m.url,
        savings: m.savings,
      },
    });
    if (insErr) continue; // duplicate (already alerted) — skip notification
    await notify({ ...w, notifyEmail: to }, m);
    sent++;
  }

  const patch = {
    last_checked_at: new Date().toISOString(),
    fail_count: 0,
    last_result: { count: result.matches.length, at: new Date().toISOString() },
  };
  if (sent > 0 && w.alert_mode === "once_then_pause") patch.status = "paused";
  await db.from("watches").update(patch).eq("id", w.id);
  await log(sent > 0 ? "match" : "no_match");
  console.log(
    `  "${w.name}": scanned ${result.scanned}, ${result.matches.length} match, ${sent} new alert(s)`
  );
  return sent;
}

async function main() {
  const { data: watches, error } = await db
    .from("watches")
    .select("*")
    .eq("status", "active");
  if (error) {
    console.error("FATAL: could not load watches:", error.message);
    process.exit(1);
  }
  const due = (watches ?? []).filter(isDue);
  console.log(`${watches?.length ?? 0} active watch(es), ${due.length} due.`);

  let total = 0;
  for (const w of due) {
    console.log(
      `── "${w.name}" [${w.source}${w.category ? "/" + w.category : ""}]`
    );
    total += await runWatch(w);
  }
  console.log(`\nDone. ${total} alert(s) dispatched.`);
}

main().catch((e) => {
  console.error("EXECUTOR FAILED:", e.message);
  process.exit(1);
});
