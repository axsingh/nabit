// Generic "custom-url" source: monitor any page the user provides.
// Extraction modes (criteria.mode): "selector" | "regex" | "llm".
//  - selector: CSS-ish — we fetch HTML and pull the FIRST match of a simple
//    text/regex hint near the target. (No DOM lib; regex-based, deterministic.)
//  - regex: user/agent supplies a regex with a capture group for the value.
//  - llm: send stripped page text + extraction_prompt to Groq -> JSON.
//
// To conserve the shared Groq free tier, the executor passes the previous
// content hash; if unchanged we skip extraction entirely (handled in
// executor via last_result.hash + this module's `hash`).

import { createHash } from "node:crypto";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export function pageHash(s) {
  return createHash("sha1").update(s).digest("hex");
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(s) {
  if (s == null) return null;
  const m = String(s).replace(/,/g, "").match(/(\d+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1]) : null;
}

// Detect obvious anti-bot / block responses so we can report honestly.
export function looksBlocked(status, text) {
  if (status === 403 || status === 429 || status === 503) return true;
  const t = text.slice(0, 4000).toLowerCase();
  return (
    /captcha|are you a robot|access denied|unusual traffic|enable javascript to/i.test(
      t
    ) && t.length < 1500
  );
}

async function extractLLM(text, prompt) {
  const key = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  if (!key) return { error: "no GROQ_API_KEY for llm extraction" };
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
            "Extract structured data from page text. Respond ONLY with a JSON object " +
            'like {"price": number|null, "inStock": boolean|null, "title": string|null}. ' +
            "Use null when unknown. " +
            (prompt ? "User goal: " + prompt : ""),
        },
        { role: "user", content: text.slice(0, 8000) },
      ],
    }),
  });
  if (!res.ok) return { error: `groq ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const j = await res.json();
  try {
    return { data: JSON.parse(j.choices[0].message.content), llmCalls: 1 };
  } catch {
    return { error: "llm returned non-JSON", llmCalls: 1 };
  }
}

// criteria: { url, mode, regex?, extraction_prompt?, priceBelow?, mustInclude?, requireInStock? }
// opts: { prevHash } -> if page unchanged, returns { unchanged:true }
export async function runCustomUrl(criteria, opts = {}) {
  const url = criteria.url;
  if (!url) throw new Error("custom-url watch missing criteria.url");

  const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  const raw = await res.text();
  const text = stripHtml(raw);
  const hash = pageHash(raw);

  if (looksBlocked(res.status, raw)) {
    return { blocked: true, status: res.status, hash, scanned: 1, matches: [], llmCalls: 0 };
  }
  if (opts.prevHash && opts.prevHash === hash) {
    return { unchanged: true, hash, scanned: 1, matches: [], llmCalls: 0 };
  }

  // --- extract ---
  let extracted = {};
  let llmCalls = 0;
  const mode = criteria.mode || "llm";
  if (mode === "regex" && criteria.regex) {
    try {
      const m = raw.match(new RegExp(criteria.regex, "i"));
      extracted.price = parsePrice(m?.[1] ?? m?.[0]);
      extracted.raw = m?.[1] ?? m?.[0] ?? null;
    } catch (e) {
      return { error: `bad regex: ${e.message}`, hash, scanned: 1, matches: [], llmCalls };
    }
  } else if (mode === "selector" && criteria.regex) {
    // selector hint reuses regex field as a loose price-context pattern
    const m = text.match(new RegExp(criteria.regex, "i"));
    extracted.price = parsePrice(m?.[0]);
    extracted.raw = m?.[0] ?? null;
  } else {
    const r = await extractLLM(text, criteria.extraction_prompt);
    llmCalls = r.llmCalls || 0;
    if (r.error) return { error: r.error, hash, scanned: 1, matches: [], llmCalls };
    extracted = r.data || {};
  }

  // --- match ---
  const reasons = [];
  let ok = true;
  if (criteria.priceBelow != null) {
    const p = extracted.price;
    if (!(Number.isFinite(p) && p < criteria.priceBelow)) ok = false;
    else reasons.push(`price $${p} < $${criteria.priceBelow}`);
  }
  if (criteria.mustInclude) {
    if (!text.toLowerCase().includes(String(criteria.mustInclude).toLowerCase()))
      ok = false;
    else reasons.push(`contains "${criteria.mustInclude}"`);
  }
  if (criteria.requireInStock) {
    if (extracted.inStock === false) ok = false;
    else if (extracted.inStock === true) reasons.push("in stock");
  }
  // require at least one positive condition so an empty criteria never alerts
  const hasCondition =
    criteria.priceBelow != null || criteria.mustInclude || criteria.requireInStock;
  if (!hasCondition) ok = false;

  const matches = ok
    ? [
        {
          title: extracted.title || criteria.label || url,
          price: extracted.price ?? null,
          url,
          savings: null,
          dedupeKey: `${url}@${extracted.price ?? extracted.raw ?? reasons.join("|")}`,
        },
      ]
    : [];

  return { scanned: 1, matches, hash, llmCalls, extracted };
}
