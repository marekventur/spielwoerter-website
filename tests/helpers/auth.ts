import type { Page } from "@playwright/test";
import { getTestDb } from "./db";
import { BASE_URL } from "./test-config";

/** Read the latest OTP code for an email directly from the test DB. */
export function getOtpCode(email: string): string {
  const row = getTestDb()
    .prepare(
      "SELECT code FROM otp_codes WHERE email = ? ORDER BY id DESC LIMIT 1"
    )
    .get(email) as { code: string } | undefined;
  if (!row) throw new Error(`No OTP code found for ${email}`);
  return row.code;
}

/**
 * Full UI login: navigate to /login, fill email, read OTP from DB, fill code, submit.
 * Waits for the redirect to complete.
 */
export async function loginAs(
  page: Page,
  email: string,
  redirectTo = "/"
): Promise<void> {
  await page.goto(`/login?from=${encodeURIComponent(redirectTo)}`);
  // Wait for React hydration before interacting — without this the click can hit
  // the pre-hydration DOM and trigger a native form submit (page reload) instead
  // of the React onSubmit handler.
  await page.waitForLoadState("networkidle");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByRole("button", { name: "Code senden" }).click();
  await page.getByText("Code eingeben").waitFor();

  const code = getOtpCode(email);
  await page.getByLabel("6-stelliger Code").fill(code);

  // Start listening BEFORE clicking so we don't miss the navigation event
  const navDone = page.waitForURL(
    (url) => !url.pathname.startsWith("/login"),
    { timeout: 20_000 }
  );
  await page.getByRole("button", { name: "Anmelden" }).click();
  await navDone;
}

/**
 * API-level login — faster for tests that don't exercise the login UI.
 * Returns the session cookie value.
 */
export async function loginViaApi(email: string): Promise<string> {
  await fetch(`${BASE_URL}/api/auth/request-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });

  const code = getOtpCode(email);

  const res = await fetch(`${BASE_URL}/api/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, code }),
  });

  if (!res.ok) throw new Error(`verify-code failed: ${res.status}`);

  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/session=([^;]+)/);
  if (!match) throw new Error("No session cookie in response");
  return match[1];
}

/** Inject a session cookie into the page context (use after loginViaApi). */
export async function setSessionCookie(
  page: Page,
  sessionId: string
): Promise<void> {
  await page.context().addCookies([
    {
      name: "session",
      value: sessionId,
      domain: "localhost",
      path: "/",
    },
  ]);
}
