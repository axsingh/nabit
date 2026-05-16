// Source adapter: Apple Refurbished store.
// Knows HOW to fetch/parse. Knows NOTHING about what to look for —
// criteria come from the user-owned watch passed in.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CATEGORY_URL = (cat) =>
  `https://www.apple.com/shop/refurbished/mac/${cat}`;

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
  if (!res.ok) throw new Error(`Apple fetch failed: HTTP ${res.status}`);
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
  if (
    c.priceBelow != null &&
    !(Number.isFinite(p.price) && p.price < c.priceBelow)
  )
    return false;
  return true;
}

// Stable per-item key for dedupe. Price included so a price change re-alerts.
function dedupeKey(p) {
  return `${p.partNumber}@${p.price}`;
}

// Returns { scanned, matches:[{...product, dedupeKey}] }
export async function runAppleRefurb(watch) {
  const tiles = await fetchTiles(watch.category);
  const products = tiles.map(normalize);
  const hits = products
    .filter((p) => matches(p, watch.criteria))
    .map((p) => ({ ...p, dedupeKey: dedupeKey(p) }));
  return { scanned: tiles.length, matches: hits };
}
