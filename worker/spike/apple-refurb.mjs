// Phase 0/1 Apple Refurbished adapter.
//
// PRINCIPLE: nothing about WHAT to look for is hardcoded here. This file only
// knows HOW to fetch + parse Apple's refurb store. The WHAT (model, specs,
// price ceiling) comes entirely from user-owned watch definitions, read from
// a config file now and from the database (agent-created) later.
//
// Run: node spike/apple-refurb.mjs [path-to-watches.json]
//   defaults to ./watches.json, falls back to ./watches.example.json

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Adapter knows source categories → URLs. It does NOT know targets.
const CATEGORY_URL = (cat) =>
  `https://www.apple.com/shop/refurbished/mac/${cat}`;

function loadWatches() {
  const explicit = process.argv[2];
  const candidates = explicit
    ? [explicit]
    : [join(ROOT, "watches.json"), join(ROOT, "watches.example.json")];
  for (const p of candidates) {
    try {
      const cfg = JSON.parse(readFileSync(p, "utf8"));
      console.log(`Loaded watch definitions from: ${p}\n`);
      return cfg.watches.filter((w) => w.source === "apple-refurb");
    } catch {}
  }
  throw new Error("No watches config found (watches.json / watches.example.json)");
}

function parseGb(s) {
  if (!s) return null;
  const m = String(s).toLowerCase().match(/([\d.]+)\s*(tb|gb)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === "tb" ? n * 1000 : n;
}

async function fetchTiles(category) {
  const res = await fetch(CATEGORY_URL(category), {
    headers: { "User-Agent": UA },
  });
  if (!res.ok) throw new Error(`fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/window\.REFURB_GRID_BOOTSTRAP\s*=\s*(\{[\s\S]*?\});/);
  if (!m) throw new Error("REFURB_GRID_BOOTSTRAP not found — structure changed");
  const data = JSON.parse(m[1]);
  if (!Array.isArray(data.tiles)) throw new Error("tiles[] missing");
  return data.tiles;
}

function normalize(tile) {
  const d = tile.filters?.dimensions ?? {};
  return {
    title: tile.title,
    partNumber: tile.partNumber,
    url: "https://www.apple.com" + (tile.productDetailsUrl || ""),
    price: parseFloat(tile.price?.currentPrice?.raw_amount ?? "NaN"),
    savings: tile.price?.savings ?? null,
    model: d.refurbClearModel ?? null,
    screensize: d.dimensionScreensize ?? null,
    memoryGb: parseGb(d.tsMemorySize),
    storageGb: parseGb(d.dimensionCapacity),
  };
}

// Generic predicate driven entirely by the user's criteria object.
function matches(p, c) {
  if (c.model && p.model !== c.model) return false;
  if (c.screensize && p.screensize !== c.screensize) return false;
  if (c.chipMatches && !new RegExp(c.chipMatches, "i").test(p.title)) return false;
  if (c.minMemoryGb != null && !(p.memoryGb >= c.minMemoryGb)) return false;
  if (c.minStorageGb != null && !(p.storageGb >= c.minStorageGb)) return false;
  if (c.priceBelow != null && !(Number.isFinite(p.price) && p.price < c.priceBelow))
    return false;
  return true;
}

(async () => {
  const watches = loadWatches();
  if (watches.length === 0) {
    console.log("No apple-refurb watches defined. Add one to watches.json.");
    return;
  }
  for (const w of watches) {
    console.log(`── Watch: "${w.name}" (${w.category}) ──`);
    const tiles = await fetchTiles(w.category);
    const products = tiles.map(normalize);
    const hits = products.filter((p) => matches(p, w.criteria));
    console.log(`  Scanned ${tiles.length} refurb units.`);
    if (hits.length === 0) {
      console.log(`  No match for your criteria right now.\n`);
    } else {
      for (const p of hits) {
        console.log(
          `  MATCH → $${p.price} (${p.savings}) ${p.memoryGb}GB/${p.storageGb}GB`
        );
        console.log(`    ${p.title}\n    ${p.url}\n`);
      }
    }
  }
})().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
