// TS port of the custom-url source for the app's test_watch tool.
// Mirrors worker/sources/custom-url.mjs (selector/regex/llm extraction).

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type CustomCriteria = {
  url?: string;
  mode?: "selector" | "regex" | "llm";
  regex?: string;
  extraction_prompt?: string;
  label?: string;
  priceBelow?: number;
  mustInclude?: string;
  requireInStock?: boolean;
};

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(s: unknown): number | null {
  if (s == null) return null;
  const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : null;
}

function looksBlocked(status: number, text: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const t = text.slice(0, 4000).toLowerCase();
  return (
    /captcha|are you a robot|access denied|unusual traffic|enable javascript to/i.test(
      t
    ) && t.length < 1500
  );
}

async function extractLLM(text: string, prompt?: string) {
  const key = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  if (!key) return { error: "no GROQ_API_KEY" };
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'Extract from page text. Respond ONLY with JSON {"price":number|null,"inStock":boolean|null,"title":string|null}. ' +
            (prompt ? "Goal: " + prompt : ""),
        },
        { role: "user", content: text.slice(0, 8000) },
      ],
    }),
  });
  if (!res.ok) return { error: `groq ${res.status}` };
  const j = await res.json();
  try {
    return { data: JSON.parse(j.choices[0].message.content) };
  } catch {
    return { error: "llm non-JSON" };
  }
}

export async function runCustomUrl(c: CustomCriteria) {
  if (!c.url) return { error: "missing url", scanned: 0, matches: [] };
  const res = await fetch(c.url, { headers: { "User-Agent": UA }, redirect: "follow" });
  const raw = await res.text();
  const text = stripHtml(raw);

  if (looksBlocked(res.status, raw))
    return { blocked: true, status: res.status, scanned: 1, matches: [] };

  let extracted: Record<string, unknown> = {};
  const mode = c.mode || "llm";
  if ((mode === "regex" || mode === "selector") && c.regex) {
    try {
      const m = (mode === "regex" ? raw : text).match(new RegExp(c.regex, "i"));
      extracted.price = parsePrice(m?.[1] ?? m?.[0]);
      extracted.raw = m?.[1] ?? m?.[0] ?? null;
    } catch (e) {
      return { error: `bad regex: ${(e as Error).message}`, scanned: 1, matches: [] };
    }
  } else {
    const r = await extractLLM(text, c.extraction_prompt);
    if ("error" in r) return { error: r.error, scanned: 1, matches: [] };
    extracted = r.data || {};
  }

  const reasons: string[] = [];
  let ok = c.priceBelow != null || !!c.mustInclude || !!c.requireInStock;
  if (c.priceBelow != null) {
    const p = extracted.price as number;
    if (!(Number.isFinite(p) && p < c.priceBelow)) ok = false;
    else reasons.push(`price $${p} < $${c.priceBelow}`);
  }
  if (c.mustInclude && !text.toLowerCase().includes(c.mustInclude.toLowerCase()))
    ok = false;
  if (c.requireInStock && extracted.inStock === false) ok = false;

  const matches = ok
    ? [
        {
          title: (extracted.title as string) || c.label || c.url,
          price: (extracted.price as number) ?? null,
          url: c.url,
          reasons,
        },
      ]
    : [];
  return { scanned: 1, matches, extracted };
}
