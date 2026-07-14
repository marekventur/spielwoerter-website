import { test, expect } from "@playwright/test";
import { cleanDb, seedWords } from "../helpers/seed";
import { loginAs, loginViaApi, setSessionCookie, getOtpCode } from "../helpers/auth";
import { TEST_USER_EMAIL } from "../helpers/test-config";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

test("full OTP login flow via UI", async ({ page }) => {
  await loginAs(page, TEST_USER_EMAIL);
  // After login, nav shows the user dropdown (email button) instead of Anmelden;
  // Abmelden lives inside the dropdown.
  await expect(page.getByRole("button", { name: "Anmelden" })).not.toBeVisible();
  await page.getByRole("button", { name: TEST_USER_EMAIL }).click();
  await expect(page.getByRole("button", { name: "Abmelden" })).toBeVisible();
});

test("login redirects back to originating page", async ({ page }) => {
  await loginAs(page, TEST_USER_EMAIL, "/wort/HUND");
  await expect(page).toHaveURL(/\/wort\/HUND/);
  await expect(page.getByRole("button", { name: TEST_USER_EMAIL })).toBeVisible();
});

test("invalid OTP code shows error message", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(TEST_USER_EMAIL);
  await page.getByRole("button", { name: "Code senden" }).click();
  await page.getByText("Code eingeben").waitFor();

  // Enter a definitely-wrong code
  await page.getByLabel("6-stelliger Code").fill("000000");
  await page.getByRole("button", { name: "Anmelden" }).click();

  await expect(
    page.getByText("Ungültiger oder abgelaufener Code")
  ).toBeVisible();
});

test("logout clears session and shows Anmelden", async ({ page }) => {
  await loginAs(page, TEST_USER_EMAIL);
  // Abmelden is inside the nav user dropdown
  await page.getByRole("button", { name: TEST_USER_EMAIL }).click();
  // window.location.reload() is used — wait for the nav button to reflect logged-out state
  await page.getByRole("button", { name: "Abmelden" }).click();
  await expect(page.getByRole("link", { name: "Anmelden" }).or(page.getByRole("button", { name: "Anmelden" }))).toBeVisible({ timeout: 10_000 });
});

test("already-logged-in user is redirected from /login", async ({ page }) => {
  const sessionId = await loginViaApi(TEST_USER_EMAIL);
  await setSessionCookie(page, sessionId);
  await page.goto("/login");
  // Loader redirects immediately to /
  await expect(page).toHaveURL("/");
});

test("already-logged-in user with ?from is redirected to that page", async ({
  page,
}) => {
  const sessionId = await loginViaApi(TEST_USER_EMAIL);
  await setSessionCookie(page, sessionId);
  await page.goto("/login?from=/wort/HUND");
  await expect(page).toHaveURL(/\/wort\/HUND/);
});

test("session cookie is httpOnly (set by server, not visible in document.cookie)", async ({
  page,
}) => {
  // Use page.request so the browser context receives the Set-Cookie header
  await page.request.post("/api/auth/request-code", {
    data: { email: TEST_USER_EMAIL },
  });
  const code = getOtpCode(TEST_USER_EMAIL);
  await page.request.post("/api/auth/verify-code", {
    data: { email: TEST_USER_EMAIL, code },
  });

  // Inspect the cookie flags stored in the browser context
  const cookies = await page.context().cookies("http://localhost");
  const sessionCookie = cookies.find((c) => c.name === "session");
  expect(sessionCookie).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
});

test("invalid email rejected at request-code", async ({ request }) => {
  const res = await request.post("/api/auth/request-code", {
    data: { email: "notanemail" },
  });
  expect(res.status()).toBe(400);
});
