// Apple Refurbished source adapter (TS, used by the app's test_watch).
// Mirrors worker/sources/apple-refurb.mjs. Knows HOW to fetch/parse only;
// the WHAT (criteria) is always user-provided.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type AppleCriteria = {
  model?: string; // e.g. "macbookpro"
  screensize?: string; // e.g. "14inch"
  chipMatches?: string; // regex source, e.g. "M(4|5)\\s*Pro"
  minMemoryGb?: number;
  minStorageGb?: number;
  priceBelow?: number;
};

export type AppleProduct = {
  title: string;
  partNumber: string;
  url: string;
  price: number;
  savings: string | null;
  model: string | null;
  screensize: string | null;
  memoryGb: number | null;
  storageGb: number | null;
  dedupeKey: string;
};

function parseGb(s: unknown): number | null {
  if (!s) return null;
  const m = String(s).toLowerCase().match(/([\d.]+)\s*(tb|gb)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === "tb" ? n * 1000 : n;
}

export async function fetchAppleProducts(
  category: string
): Promise<AppleProduct[]> {
  const res = await fetch(
    `https://www.apple.com/shop/refurbished/mac/${category}`,
    { headers: { "User-Agent": UA } }
  );
  if (!res.ok) throw new Error(`Apple fetch failed: HTTP ${res.status}`);
  const html = await res.text();
  const m = html.match(/window\.REFURB_GRID_BOOTSTRAP\s*=\s*(\{[\s\S]*?\});/);
  if (!m) throw new Error("REFURB_GRID_BOOTSTRAP not found — structure changed");
  const data = JSON.parse(m[1]) as { tiles?: unknown[] };
  if (!Array.isArray(data.tiles)) throw new Error("tiles[] missing");

  return data.tiles.map((t) => {
    const tile = t as Record<string, any>;
    const d = tile.filters?.dimensions ?? {};
    const price = parseFloat(tile.price?.currentPrice?.raw_amount ?? "NaN");
    return {
      title: tile.title,
      partNumber: tile.partNumber,
      url: "https://www.apple.com" + (tile.productDetailsUrl || ""),
      price,
      savings: tile.price?.savings ?? null,
      model: d.refurbClearModel ?? null,
      screensize: d.dimensionScreensize ?? null,
      memoryGb: parseGb(d.tsMemorySize),
      storageGb: parseGb(d.dimensionCapacity),
      dedupeKey: `${tile.partNumber}@${price}`,
    };
  });
}

export function matchApple(p: AppleProduct, c: AppleCriteria): boolean {
  if (c.model && p.model !== c.model) return false;
  if (c.screensize && p.screensize !== c.screensize) return false;
  if (c.chipMatches && !new RegExp(c.chipMatches, "i").test(p.title))
    return false;
  if (c.minMemoryGb != null && !(Number(p.memoryGb) >= c.minMemoryGb))
    return false;
  if (c.minStorageGb != null && !(Number(p.storageGb) >= c.minStorageGb))
    return false;
  if (
    c.priceBelow != null &&
    !(Number.isFinite(p.price) && p.price < c.priceBelow)
  )
    return false;
  return true;
}

export async function runAppleRefurb(category: string, criteria: AppleCriteria) {
  const products = await fetchAppleProducts(category || "macbook-pro");
  const matches = products.filter((p) => matchApple(p, criteria));
  return { scanned: products.length, matches };
}
