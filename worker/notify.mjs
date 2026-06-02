// Notification dispatch. Phase 1 supports dry-run (console) and email (Resend).
// Web Push + SMS are added in later phases. Channel selection is per-watch.

// Evaluated at CALL time, not module-load — ESM imports are hoisted, so a
// module-load const would read env before the executor loads .env locally.
function isDryRun() {
  return process.env.DRY_RUN === "1" || !process.env.RESEND_API_KEY;
}

function renderText(watch, match) {
  return [
    `🟢 Nabit match: ${watch.name}`,
    ``,
    `${match.title}`,
    `Price: $${match.price}${match.savings ? ` (${match.savings})` : ""}`,
    `Specs: ${match.memoryGb}GB RAM / ${match.storageGb}GB storage`,
    `Buy: ${match.url}`,
  ].join("\n");
}

async function sendEmail(to, subject, text) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.ALERT_FROM_EMAIL || "onboarding@resend.dev",
      to,
      subject,
      text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Resend failed: HTTP ${res.status} ${await res.text()}`);
  }
}

// watch.channels e.g. ["email"]; watch.notifyEmail = recipient (Phase 1: env)
export async function notify(watch, match) {
  const text = renderText(watch, match);
  const subject = `Nabit: ${watch.name} — $${match.price}`;

  if (isDryRun()) {
    console.log("\n[DRY-RUN] would send alert:\n" + text + "\n");
    return { dryRun: true };
  }

  const sent = [];
  for (const ch of watch.channels || ["email"]) {
    if (ch === "email") {
      const to = watch.notifyEmail || process.env.ALERT_TO_EMAIL;
      if (!to) throw new Error("no recipient email configured");
      await sendEmail(to, subject, text);
      sent.push("email");
    }
    // web-push / sms added in later phases
  }
  return { sent };
}
