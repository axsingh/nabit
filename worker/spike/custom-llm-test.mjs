import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url),"utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim();}
import { runCustomUrl } from "../sources/custom-url.mjs";

console.log("=== LLM extraction mode on a real Apple product page ===");
const url = "https://www.apple.com/shop/buy-mac/macbook-air";
const r = await runCustomUrl({ url, mode:"llm", extraction_prompt:"the starting price of MacBook Air", mustInclude:"MacBook Air" });
console.log("extracted:", JSON.stringify(r.extracted)?.slice(0,200));
console.log("llmCalls:", r.llmCalls, "| matches:", r.matches.length, "| error:", r.error||"none");
const pass = !r.error && r.llmCalls===1;
console.log("\nLLM-MODE:", pass ? "PASS ✅ (extraction returned JSON, 1 call)" : "FAIL ❌");
process.exit(pass?0:1);
