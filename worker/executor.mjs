// Phase 1 watch executor. Runs on GitHub Actions cron (every 10 min) or
// locally via `npm run watch:dry`. Reads user-owned watch definitions,
// runs the matching source adapter, dedupes, dispatches alerts.
//
// Dedupe state persists in .state/alerted.json (gitignored; persisted across
// GitHub Actions runs via the actions/cache step in the workflow).
//
// Phases 2–4 replace the JSON config + state file with Supabase.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runAppleRefurb } from "./sources/apple-refurb.mjs";
import { notify } from "./notify.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = join(ROOT, ".state");
const STATE_FILE = join(STATE_DIR, "alerted.json");

const SOURCES = { "apple-refurb": runAppleRefurb };

function loadWatches() {
  for (const p of [join(ROOT, "watches.json"), join(ROOT, "watches.example.json")]) {
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      console.log(`Watches: ${p}`);
      return cfg.watches || [];
    } catch {}
  }
  throw new Error("No watches config found");
}

function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {}; // { [watchId]: { alertedKeys: [], paused: false } }
  }
}

function saveState(state) {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  const watches = loadWatches();
  const state = loadState();
  let alertsSent = 0;

  for (const w of watches) {
    const runner = SOURCES[w.source];
    if (!runner) {
      console.log(`  skip "${w.name}": unknown source "${w.source}"`);
      continue;
    }
    const st = (state[w.id] ||= { alertedKeys: [], paused: false });
    if (st.paused) {
      console.log(`── "${w.name}": paused (already alerted, once_then_pause)`);
      continue;
    }

    console.log(`── "${w.name}" [${w.source}/${w.category}]`);
    let result;
    try {
      result = await runner(w);
    } catch (e) {
      console.error(`  fetch/parse error: ${e.message}`);
      st.failCount = (st.failCount || 0) + 1;
      if (st.failCount >= 5) {
        st.paused = true;
        console.error(`  auto-paused after 5 consecutive failures`);
      }
      continue;
    }
    st.failCount = 0;
    console.log(`  scanned ${result.scanned}, matched ${result.matches.length}`);

    const fresh = result.matches.filter(
      (m) => !st.alertedKeys.includes(m.dedupeKey)
    );
    if (fresh.length === 0) {
      console.log(`  nothing new`);
      continue;
    }

    for (const m of fresh) {
      await notify(w, m);
      st.alertedKeys.push(m.dedupeKey);
      alertsSent++;
    }
    if (w.alertMode === "once_then_pause") {
      st.paused = true;
      console.log(`  alerted ${fresh.length}, watch paused (once_then_pause)`);
    } else {
      console.log(`  alerted ${fresh.length}`);
    }
  }

  saveState(state);
  console.log(`\nDone. ${alertsSent} alert(s) dispatched.`);
}

main().catch((e) => {
  console.error("EXECUTOR FAILED:", e.message);
  process.exit(1);
});
