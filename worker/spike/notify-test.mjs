import { readFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url),"utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].trim();}
import { notify } from "../notify.mjs";
const watch = { name:"E2E notify test", channels:["email"], notifyEmail:"singh.ashutosh@gmail.com" };
const match = { title:"TEST — Refurb 14-inch MacBook Pro M4 Pro 24GB/1TB", price:1799, savings:"Save $300", url:"https://www.apple.com/shop/refurbished/mac" };
const r = await notify(watch, match);
console.log("notify result:", JSON.stringify(r));
console.log(r.sent?.includes("email") ? "NOTIFY E2E: PASS ✅ (real email sent)" : "NOTIFY E2E: FAIL ❌");
process.exit(r.sent?.includes("email")?0:1);
