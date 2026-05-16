# Nabit — Plan & Spec

> A conversational agent that creates and runs arbitrary "deal watches." You
> chat with it in natural language; it figures out where to look, what to
> extract, how often to check, and alerts you the moment a match appears.
> Multi-tenant, invite-only (admin approval), fully free to run.

Status: **DRAFT — pending architect review and owner approval**
Owner: Ashutosh Singh (`axsingh`)
Repo (planned): `github.com/axsingh/nabit`
Local: `~/Documents/ClaudeProjects/nabit`

---

## 1. Problem & Goal

Ashutosh repeatedly misses good deals (recently a refurb MacBook Pro) because
he forgets to check and existing tools are use-case-specific. He wants a
**flexible agent** he can talk to: "watch for X under $Y from these sources,
alert me on channel Z." Up to 5 users (wife, brother, +slots), each with
**fully private** watches.

Non-goals (now): shared watches, public signup, mobile apps, auto-buy
(deferred to a later optional phase with hard safety rails).

---

## 1a. Non-Negotiable Principles

- **No hardcoded searches, ever.** Search criteria are *always* user-provided.
  The agent must ask the user what they're looking for (product, specs, price
  ceiling, sources, cadence, channels) and create the watch from their answer.
  Code contains *adapters* (how to fetch/parse a source) — never *what* to look
  for. The "what" lives in user-owned watch rows.
- **Elicit, don't assume.** When a request is ambiguous ("watch for a MacBook"),
  the agent asks clarifying questions before creating a watch.
- **Flexible by default.** Users define any number of watches for anything;
  the system must not be specialized to MacBooks/flights in its core.

## 2. Core Concept

```
User chats with Nabit
   → Agent calls tools to create/edit "watches"
      → Background worker runs each watch on a schedule
         → Fetch source(s) → LLM extracts structured data
            → Evaluate match criteria → send alert on chosen channel(s)
               → Log to alert history; optionally auto-pause
```

A **watch** is generic. Whether it's a refurb MacBook, a business-class fare,
an RSS feed, or any URL, it's the same row type: sources + extraction prompt +
match criteria + schedule + channels.

---

## 3. Tech Stack (all free tier)

| Component | Choice | Notes |
|---|---|---|
| App | Next.js (App Router) on Vercel free tier | Chat UI + dashboard + agent only — **not** the watch executor |
| LLM | Google Gemini 2.0 Flash via Vercel AI SDK | 1,500 req/day free, pooled. **Extraction only**, never matching |
| DB + Auth | Supabase (Postgres + Auth + RLS) free tier | 500MB, multi-tenant |
| Cron + executor | GitHub Actions scheduled workflow runs a **Node job** that does all watch execution itself (Supabase + Gemini directly) | ~6h/job budget, real concurrency; Vercel functions are the wrong place for this |
| Browser scrape | Playwright inside the GitHub Actions job — only when HTTP fetch insufficient | Free runner minutes |
| Notifications | **Email (Resend free)** + **Web Push (PWA, free)** + Twilio SMS (opt-in) | Per-watch channel selection. **No Telegram.** |
| Free SMS fallback | Mint→T-Mobile gateway `<num>@tmomail.net` | Flaky; not primary |

**Notification design (no Telegram — most people don't use it):**
- **Email** — universal default, zero setup (login email), Resend free tier.
- **Web Push** — the web app sends push notifications to phone/desktop lock
  screen via the Web Push API (VAPID keys, free). This is the instant-urgent
  channel. iOS requires "Add to Home Screen" (PWA, iOS 16.4+); one-time step.
- **SMS (Twilio)** — opt-in per watch, ~$0.008/alert, for critical only.
- **Mint→T-Mobile gateway** — free SMS fallback, unreliable, not primary.

Cost target: **$0/mo** (Twilio only if a user explicitly enables SMS — pennies).

---

## 4. Data Model (Supabase Postgres)

All tables have `user_id uuid` FK → `auth.users`. **Row-Level Security on
every table**: a user can only read/write rows where `user_id = auth.uid()`.
Admin (owner) has a bypass policy for the admin page.

```
profiles
  id (uuid, = auth.users.id, PK)
  email text
  display_name text
  role text default 'user'         -- 'user' | 'admin'
  status text default 'pending'    -- 'pending' | 'approved' | 'disabled'
  push_subscription jsonb null     -- Web Push (VAPID) subscription object
  phone_e164 text null             -- for Twilio SMS (opt-in)
  created_at timestamptz

watches
  id uuid PK
  user_id uuid FK
  name text
  description text                 -- natural-language intent (source of truth)
  type text                        -- 'product' | 'flight' | 'hotel' | 'rss' | 'custom'
  sources jsonb                    -- [{kind:'url'|'rss'|'api', target, method:'fetch'|'playwright'}]
  extraction_prompt text           -- LLM instructions to pull structured data
  match_criteria text              -- natural-language match rule
  threshold jsonb null             -- {price_below:1899, ...} optional structured fast-path
  schedule jsonb                   -- {every_minutes:10}
  channels text[]                  -- ['email','telegram','sms']
  alert_mode text                  -- 'once_then_pause' | 'every_match' | 'daily_digest'
  status text default 'active'     -- 'active' | 'paused'
  last_checked_at timestamptz null
  last_result jsonb null           -- last extracted snapshot (for diffing)
  created_at timestamptz

alerts
  id uuid PK
  user_id uuid FK
  watch_id uuid FK
  matched_at timestamptz
  dedupe_key text                  -- stable per-item key (e.g. sku+price, flight hash)
  payload jsonb                    -- what matched (price, url, summary)
  channels_sent text[]
  delivery_status jsonb
  -- UNIQUE partial index on (watch_id, dedupe_key) prevents re-alerting same item

watch_runs                          -- observability / debugging / Gemini burn tracking
  id uuid PK
  watch_id uuid FK
  ran_at timestamptz
  status text                      -- 'ok' | 'no_match' | 'match' | 'fetch_error' | 'extract_error'
  duration_ms int
  llm_calls int
  error text null

conversations / messages
  standard chat history per user (for the agent UI), user-scoped
```

`watches.last_result` also stores a **content hash** of the last fetched body
so an unchanged page skips the LLM call entirely. Dedupe is per-item via
`alerts.dedupe_key`, not a coarse whole-snapshot diff.

`description` + `match_criteria` (natural language) are the source of truth so
the agent can re-derive sources if a site changes. `threshold` is an optional
structured fast-path so trivial checks (price < N) don't need an LLM call.

---

## 5. Agent Design

Model: Gemini 2.0 Flash via Vercel AI SDK `streamText` with tool calling.

**System prompt (essence):** "You are Nabit, a deal-watching agent. Convert the
user's natural-language request into a concrete watch: identify sources (search
the web if needed), write an extraction prompt, write match criteria, propose a
schedule and channels. Always confirm the plan and offer a test run before
saving. Be explicit about what you can't reliably watch (anti-bot, paywalls)."

**Tools exposed to the agent:**

| Tool | Purpose |
|---|---|
| `web_search(query)` | Find candidate source URLs / RSS / APIs |
| `fetch_page(url, method)` | Pull a sample to verify extraction works |
| `create_watch(...)` | Persist a new watch (user-scoped) |
| `list_watches()` | Show user's current watches |
| `update_watch(id, patch)` | Edit fields |
| `pause_watch(id)` / `resume_watch(id)` / `delete_watch(id)` | Lifecycle |
| `test_watch(id)` | Run the watch once now, return what it would have done (no alert) |

`test_watch` is key UX: when defining a watch with the user, run it live so
they see real extracted data before committing.

---

## 5a. Watch-Creation Dialog (in-product, agent-run)

The defining feature. When a user wants to track something, **the agent runs
this conversation inside the app** — not the developer, not a config file, not
a one-time setup. It happens every time, per user, adapting to the request.

Flow the agent follows:
1. User states intent in free text ("track a 14-inch MacBook Pro refurb").
2. Agent identifies candidate source(s) (web_search if unknown) and the
   **source-specific filter dimensions actually available** (e.g. Apple refurb
   exposes chip/RAM/storage/screen/year; a flight source exposes
   origin/dest/cabin/date-window — different questions entirely).
3. Agent asks the user to fill those dimensions + price/threshold + cadence +
   channel(s) + alert mode. Questions are **derived from the source**, never a
   fixed list. Unknowns are asked, not assumed.
4. Agent runs `test_watch` live, shows current real results, lets the user
   tweak criteria, then saves the watch to their account.

This means the same product handles "MacBook with M4/M5 Pro, ≥24GB, ≥1TB, under
$X" and "business class SFO→Tokyo next 5–10 days under $Y" through the *same*
dialog — the agent adapts the questions to the source. No criteria are ever
hardcoded or pre-seeded by the developer.

> `watches.example.json` is a **test fixture only** (drives the Phase-0/1
> adapter spike). It is never a real user watch and ships nowhere near prod.

## 6. Watch Executor (background worker)

**The executor IS the GitHub Actions job** (a Node script in the repo), not a
Vercel function. It connects to Supabase (service-role key) and Gemini
directly. Vercel only serves the UI + agent chat. This avoids the 60s
function timeout and gives real concurrency.

For each `active` watch due to run (`last_checked_at` older than
`schedule.every_minutes`):

1. **Fetch** each source. Plain HTTP by default; Playwright (in the runner)
   only when JS-rendered.
2. **Content-hash** the body. If unchanged vs `last_result` hash → skip,
   log `no_match`, **zero LLM calls**.
3. **Parse**:
   - Structured source (API / RSS / JSON) → deterministic parser, **no LLM**.
   - Unstructured HTML → **one** Gemini call to extract *normalized JSON*
     (`{items:[{title,price,url,...}]}`). Extraction only.
4. **Match in code, not LLM.** A JS predicate evaluates `threshold` /
   normalized criteria against the extracted items. No second LLM call.
5. **Dedupe** each candidate by `dedupe_key`; skip any already in `alerts`.
6. **On new match**: insert `alerts` row, send to `channels[]`, apply
   `alert_mode` (e.g. flip `status='paused'` for `once_then_pause`).
7. Update `last_checked_at`, `last_result` (hash + snapshot); write a
   `watch_runs` row (status, ms, llm_calls).
8. **Source-breakage guard:** N consecutive `extract_error`/empty runs →
   auto-pause the watch + notify the owner.

Net effect: LLM fires only on changed unstructured pages, ~1 call each,
keeping well inside Gemini's 1,500/day even with 5 users.

**Source-specific helpers** (the agent picks the right one):
- Apple Refurbished: **✅ VERIFIED (Phase 0).** Plain `fetch` (browser UA) of
  `/shop/refurbished/mac/macbook-pro` returns HTTP 200 in ~0.3s, no anti-bot.
  Product grid is embedded as JSON in `window.REFURB_GRID_BOOTSTRAP` →
  `data.tiles[]` (98 items). Each tile has `title`, `partNumber`,
  `productDetailsUrl`, `price.currentPrice.raw_amount`,
  `price.previousPrice.raw_amount`, `price.savings`, and **structured specs**
  in `filters.dimensions` (`tsMemorySize`, `dimensionCapacity`,
  `refurbClearModel`, `dimensionScreensize`, `dimensionRelYear`). Filtering is
  fully deterministic JS — **zero LLM, zero browser**. Reference adapter:
  `spike/apple-refurb.mjs`. (Other refurb categories use the same
  `/shop/refurbished/mac/<category>` pattern + same JSON shape.)
- Amazon: Keepa-style via page fetch or simple scrape (noisy; diff carefully)
- Best Buy: open-box / product API where possible
- Flights (biz class, last-minute): Amadeus Self-Service API (free 2k/mo),
  rolling-window query on home airports (SFO/SJC) → user-named destinations
- RSS deal feeds: TheFlightDeal, SecretFlying, r/flightdeals (free, low-effort)

---

## 7. Multi-Tenancy, Auth, Admin

- **Supabase Auth**, magic-link email login.
- **Signup = admin approval.** New users land `status='pending'`, see a "waiting
  for approval" screen, no agent access. Owner approves in `/admin`.
- **RLS everywhere, kept dumb.** Every policy is exactly
  `user_id = auth.uid()` — **no admin branch in RLS** (a role-check policy on
  `profiles` causes recursive RLS evaluation). Admin/service operations run in
  a **server-only route using the Supabase service-role key**, which bypasses
  RLS by design. Service-role key is server-only, never client-exposed.
- **Admin page** (`/admin`, owner only): list users, approve/disable, see watch
  counts + LLM burn (from `watch_runs`), global pause. Backed by service-role
  route, not RLS.
- **Fully private:** no cross-user visibility. Share-a-watch deferred.
- Designed to comfortably hold ~25 users on free tiers without changes.

**Notification setup per user:**
- Email: their signup email — automatic, no setup.
- Web Push: in-app "Enable notifications" button → browser prompts → store the
  VAPID subscription on their profile. iOS users prompted to Add to Home Screen.
- SMS (opt-in): user enters their own phone (E.164); Twilio sends from one
  shared number.

---

## 8. Phases

| Phase | Scope | Est | Done when |
|---|---|---|---|
| **0** | ~~Spike: confirm Apple Refurb fetch+parse~~ **✅ DONE** — see result below | 0.5h | ✅ Real refurb data parsed (`spike/apple-refurb.mjs`) |
| 1 | **Vertical slice:** Apple-refurb adapter (criteria from config, not hardcoded) end-to-end (fetch → code match → **email** alert) on GitHub Actions cron | 2h | A real refurb match fires a real email — "never miss again" achieved |
| 2 | Scaffold the app: Next.js, Supabase Auth + RLS, admin approval gate, chat UI, dashboard, Web Push enable | 3h | You log in (approved), chat, see dashboard, enable Web Push |
| 3 | Generalize: agent tools (web_search, fetch_page, create/list/update/pause/delete/test_watch); persist watches | 2h | Create + test any watch via chat |
| 4 | Wire the Phase-1 executor to DB-driven watches; email + SMS delivery; dedupe + watch_runs + breakage guard | 2h | Any chat-created watch fires correctly |
| 5 | Admin page (user list, approve/disable, usage) | 1h | You can approve wife/brother |
| 6 | **You** use the live chat agent to create your own watches (it asks you the source-derived questions, you answer, it saves). Nothing pre-filled by the developer. | 0.5h | You created watches yourself via the product |

Auto-buy (payment automation) is **out of scope** — not a day-of-work item;
revisit separately later with hard safety rails.

E2E UI test after each phase (per dev process), fix, then push. Phases 0–1 are
the riskiest assumptions — proving them first means the rest builds on solid
ground.

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Anti-bot on travel/retail sites | Prefer APIs/RSS; Playwright in runner only as last resort; agent tells user when a source is unreliable |
| Gemini free-tier limits | LLM = extraction only (matching is code); skip LLM on structured sources and unchanged pages (content hash); daily-digest mode for noisy watches |
| Duplicate alerts | Per-item `dedupe_key` with unique index, not coarse snapshot diff; `once_then_pause` default for high-urgency |
| Source structurally changes | N consecutive failed/empty extractions → auto-pause + notify owner; `watch_runs` log surfaces silent breakage |
| Cron auth | Static bearer secret, **fail-closed** if env unset; stored as GitHub repo secret, never in workflow YAML |
| Mint/T-Mobile SMS gateway flaky | Not primary; Web Push is the free urgent channel, email is the reliable baseline |
| Vercel function timeout | Executor runs in GitHub Actions Node job, not Vercel functions — timeout is a non-issue |
| Secrets leakage | All keys in env / GitHub secrets; never in repo; Supabase service-role key server/runner-only |

---

## 10. Owner Decisions (resolved)

1. **Deploy:** local dev until Phase 4; then deploy UI to owner's Vercel.
   (The GitHub Actions executor runs regardless — it's a standalone Node
   script, independent of the Vercel UI deploy.)
2. **Email:** Resend free tier (100/day), GitHub login. Not Gmail SMTP.
3. **Cadence:** urgent watches (refurb) every **10 min**; flights every **2 h**.
