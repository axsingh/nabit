// Daily heartbeat: once per 24h per user, emails a summary of their active
// watches + any alerts in the last 24h. Throttled via profiles.last_heartbeat_at
// so this is safe to re-run; only users actually due get an email.
//
// Behavior:
// - If any alerts fired in the last 24h → "Here's what we found" + list.
// - Otherwise → "No deals found yet today. Still watching." + per-watch status.
// - DRY-RUN if RESEND_API_KEY is not set (logs to stdout, marks user as
//   heartbeated so we don't spam logs on every cron run).

import { readFileSync } from "node:fs";
import ws from "ws";
globalThis.WebSocket ||= ws;
import { createClient } from "@supabase/supabase-js";

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

const DRY_RUN = !process.env.RESEND_API_KEY;
const FROM = process.env.ALERT_FROM_EMAIL || "onboarding@resend.dev";
const HEARTBEAT_INTERVAL_HOURS = 23; // safe < 24 against cron drift

async function sendEmail(to, subject, text) {
  if (DRY_RUN) {
    console.log(`[DRY-RUN heartbeat -> ${to}]\nSubject: ${subject}\n\n${text}\n`);
    return { dryRun: true };
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  return { sent: true };
}

function render({ email, watches, alerts }) {
  const subject =
    alerts.length > 0
      ? `Nabit daily: ${alerts.length} deal${alerts.length > 1 ? "s" : ""} found`
      : "Nabit daily: still watching, no deals yet";

  const head =
    alerts.length > 0
      ? `Here's what Nabit found for you in the last 24h:\n`
      : `No matching deals in the last 24h. We're still watching everything below.\n`;

  const alertLines = alerts
    .map(
      (a) =>
        `  • $${a.payload?.price ?? "?"} — ${a.payload?.title ?? "match"}` +
        (a.payload?.url ? `\n    ${a.payload.url}` : "")
    )
    .join("\n");

  const watchLines = watches
    .map((w) => {
      const last = w.last_checked_at
        ? new Date(w.last_checked_at).toUTCString().replace(":00 GMT", " UTC")
        : "not yet";
      return `  • [${w.status}] ${w.name}  (${w.source}${w.category ? "/" + w.category : ""}, last checked ${last})`;
    })
    .join("\n");

  const watchBlock = watches.length
    ? `\nYour watches:\n${watchLines}\n`
    : `\nYou have no active watches. Add one in the chat at https://nabit-dun.vercel.app\n`;

  return {
    subject,
    text:
      `Hi${email ? " " + email.split("@")[0] : ""},\n\n` +
      head +
      (alerts.length ? "\n" + alertLines + "\n" : "") +
      watchBlock +
      `\nManage your watches: https://nabit-dun.vercel.app\n`,
  };
}

async function main() {
  const cutoffIso = new Date(
    Date.now() - HEARTBEAT_INTERVAL_HOURS * 3600_000
  ).toISOString();

  const { data: users, error } = await db
    .from("profiles")
    .select("id,email,last_heartbeat_at,daily_digest_enabled,status")
    .eq("status", "approved")
    .eq("daily_digest_enabled", true)
    .or(`last_heartbeat_at.is.null,last_heartbeat_at.lt.${cutoffIso}`);
  if (error) {
    console.error("load profiles failed:", error.message);
    process.exit(1);
  }

  console.log(
    `${users?.length ?? 0} user(s) due for heartbeat (${DRY_RUN ? "dry-run" : "live email"}).`
  );

  const since = new Date(Date.now() - 24 * 3600_000).toISOString();

  for (const u of users ?? []) {
    if (!u.email) continue;
    const [{ data: watches }, { data: alerts }] = await Promise.all([
      db
        .from("watches")
        .select("name,source,category,status,last_checked_at")
        .eq("user_id", u.id)
        .order("created_at", { ascending: false }),
      db
        .from("alerts")
        .select("matched_at,payload")
        .eq("user_id", u.id)
        .gte("matched_at", since)
        .order("matched_at", { ascending: false }),
    ]);

    // No daily email when the user has no ACTIVE watches — a "you have
    // nothing" message every day is pure noise. They get the daily update
    // only once something is actually being watched.
    const activeWatches = (watches ?? []).filter((w) => w.status === "active");
    if (activeWatches.length === 0) {
      console.log(`  ${u.email}: no active watches — skipping heartbeat`);
      continue;
    }

    const { subject, text } = render({
      email: u.email,
      watches: watches ?? [],
      alerts: alerts ?? [],
    });

    try {
      await sendEmail(u.email, subject, text);
      await db
        .from("profiles")
        .update({ last_heartbeat_at: new Date().toISOString() })
        .eq("id", u.id);
      console.log(
        `  ${u.email}: ${(alerts ?? []).length} alert(s) in 24h, ${(watches ?? []).length} watch(es)`
      );
    } catch (e) {
      console.error(`  ${u.email}: heartbeat failed: ${e.message}`);
    }
  }

  console.log("Done.");
}

main().catch((e) => {
  console.error("HEARTBEAT FAILED:", e.message);
  process.exit(1);
});
