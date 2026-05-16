// Throwaway E2E: create a temp user+watch, run the executor twice against
// the real Supabase, assert alert + dedupe + watch_runs, then clean up.
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import ws from "ws";
globalThis.WebSocket ||= ws;
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const EMAIL = "e2e-test@nabit.local";
let userId;

async function cleanup() {
  if (userId) await db.auth.admin.deleteUser(userId); // cascades watches/alerts/runs
}

try {
  // fresh user
  const { data: list } = await db.auth.admin.listUsers();
  const existing = list.users.find((u) => u.email === EMAIL);
  if (existing) await db.auth.admin.deleteUser(existing.id);
  const { data: created, error: cErr } = await db.auth.admin.createUser({
    email: EMAIL,
    email_confirm: true,
  });
  if (cErr) throw cErr;
  userId = created.user.id;
  console.log("test user:", userId);

  const { data: w, error: wErr } = await db
    .from("watches")
    .insert({
      user_id: userId,
      name: "E2E - any 14in MBP",
      source: "apple-refurb",
      category: "macbook-pro",
      criteria: { model: "macbookpro", screensize: "14inch", priceBelow: 9999 },
      channels: ["email"],
      alert_mode: "every_match",
      schedule: { everyMinutes: 10 },
      status: "active",
    })
    .select("id")
    .single();
  if (wErr) throw wErr;
  console.log("test watch:", w.id);

  console.log("\n── RUN 1 (expect matches + new alerts) ──");
  console.log(execSync("node worker/executor.mjs", { cwd: process.cwd() }).toString());

  const a1 = await db.from("alerts").select("id").eq("watch_id", w.id);
  const r1 = await db.from("watch_runs").select("id,status").eq("watch_id", w.id);
  console.log(`alerts after run 1: ${a1.data.length}, watch_runs: ${r1.data.length}`);

  console.log("── RUN 2 (expect dedupe → 0 new alerts) ──");
  // reset last_checked_at so it's due again immediately
  await db.from("watches").update({ last_checked_at: null }).eq("id", w.id);
  console.log(execSync("node worker/executor.mjs", { cwd: process.cwd() }).toString());

  const a2 = await db.from("alerts").select("id").eq("watch_id", w.id);
  const r2 = await db.from("watch_runs").select("id").eq("watch_id", w.id);
  console.log(`alerts after run 2: ${a2.data.length} (should equal run 1), watch_runs: ${r2.data.length}`);

  const pass =
    a1.data.length > 0 &&
    a2.data.length === a1.data.length &&
    r2.data.length >= 2;
  console.log("\nE2E RESULT:", pass ? "PASS ✅" : "FAIL ❌");
  await cleanup();
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error("E2E ERROR:", e.message);
  await cleanup();
  process.exit(1);
}
