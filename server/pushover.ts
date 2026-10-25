/**
 * Push notification to the site owner's phone (pushover.net).
 *
 * Production only, like every other outward-facing job: the dev box runs with
 * the production .env, and an alert from dev would be a false alarm. Silently
 * skipped when PUSHOVER_TOKEN / PUSHOVER_USER are unset. Never throws — an
 * alert must not break the request that triggered it.
 */
export async function pushover(message: string, title = "Spielwörter"): Promise<void> {
  const token = process.env.PUSHOVER_TOKEN;
  const user = process.env.PUSHOVER_USER;
  if (process.env.NODE_ENV !== "production" || !token || !user) {
    console.log(`[pushover] Skipped (not production or not configured): ${message}`);
    return;
  }

  try {
    const response = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, user, title, message }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      console.error(`[pushover] Failed: ${response.status} ${await response.text()}`);
    }
  } catch (err) {
    console.error("[pushover] Error:", err instanceof Error ? err.message : err);
  }
}
