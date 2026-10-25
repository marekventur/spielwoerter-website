/**
 * Mail abuse guards (lib/mail-limits.ts): the login-code caps behind
 * /api/auth/request-code, the once-a-day owner alert, and the hard-bounce
 * suppression list. Nothing is mailed: the test server has no Mailgun key.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedUser } from "../helpers/seed";
import { getOtpCode } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import { TEST_USER_EMAIL } from "../helpers/test-config";
import {
  OTP_NEW_ADDRESSES_PER_DAY,
  OTP_PER_ADDRESS_PER_DAY,
  applyPermanentFailures,
  claimDailyAlert,
  isSuppressed,
  maskEmail,
  otpAddressKey,
  recordOtpRequest,
  suppressAddress,
  unsuppressAddress,
} from "../../lib/mail-limits";

test.beforeEach(() => {
  cleanDb();
});

const outcomes = () =>
  (getTestDb().prepare("SELECT outcome FROM otp_requests ORDER BY id").all() as { outcome: string }[]).map(
    (r) => r.outcome
  );

const otpRowCount = (email: string) =>
  (getTestDb().prepare("SELECT COUNT(*) AS n FROM otp_codes WHERE email = ?").get(email) as { n: number }).n;

/** Fill today's budget for new addresses without going through the API. */
function useUpNewAddressBudget(createdAt = "datetime('now')") {
  const insert = getTestDb().prepare(
    `INSERT INTO otp_requests (email_key, has_account, outcome, created_at)
     VALUES (?, 0, 'sent', ${createdAt})`
  );
  for (let i = 0; i < OTP_NEW_ADDRESSES_PER_DAY; i++) insert.run(`bot${i}@example.test`);
}

// ── Per-address cap ─────────────────────────────────────────────────────────

test("per-address cap: the 6th code in 24 h is not sent, but the response is identical", async ({
  request,
}) => {
  const bodies: unknown[] = [];
  for (let i = 0; i < OTP_PER_ADDRESS_PER_DAY; i++) {
    const res = await request.post("/api/auth/request-code", { data: { email: TEST_USER_EMAIL } });
    expect(res.status()).toBe(200);
    bodies.push(await res.json());
  }
  const lastCode = getOtpCode(TEST_USER_EMAIL);

  const capped = await request.post("/api/auth/request-code", { data: { email: TEST_USER_EMAIL } });
  expect(capped.status()).toBe(200);
  expect(await capped.json()).toEqual(bodies[0]);

  expect(outcomes()).toEqual([...Array(OTP_PER_ADDRESS_PER_DAY).fill("sent"), "address_cap"]);
  // No new code was issued, and the last real one still works.
  expect(getOtpCode(TEST_USER_EMAIL)).toBe(lastCode);
});

test("per-address cap: case and +tag variants share one budget", async () => {
  const db = getTestDb();
  expect(otpAddressKey(" Foo+Spam1@Example.TEST")).toBe("foo@example.test");
  for (let i = 0; i < OTP_PER_ADDRESS_PER_DAY; i++) {
    expect(recordOtpRequest(db, `foo+${i}@example.test`)).toBe("sent");
  }
  expect(recordOtpRequest(db, "FOO@example.test")).toBe("address_cap");
  expect(recordOtpRequest(db, "other@example.test")).toBe("sent");
});

test("per-address cap: the window is a rolling 24 h, and capped requests don't extend it", async () => {
  const db = getTestDb();
  const insert = db.prepare(
    `INSERT INTO otp_requests (email_key, has_account, outcome, created_at)
     VALUES ('foo@example.test', 0, ?, datetime('now', ?))`
  );
  for (let i = 0; i < OTP_PER_ADDRESS_PER_DAY; i++) insert.run("sent", "-25 hours");
  insert.run("address_cap", "-1 hours");
  expect(recordOtpRequest(db, "foo@example.test")).toBe("sent");
});

// ── Global cap on new addresses ─────────────────────────────────────────────

test("global cap: unknown addresses get nothing once today's budget is used, with the same response", async ({
  request,
}) => {
  useUpNewAddressBudget();
  const res = await request.post("/api/auth/request-code", { data: { email: "stranger@example.test" } });
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
  expect(otpRowCount("stranger@example.test")).toBe(0);
  expect(outcomes().at(-1)).toBe("global_cap");

  // The alert is claimed once for the day, not once per blocked request.
  await request.post("/api/auth/request-code", { data: { email: "stranger2@example.test" } });
  const alerts = getTestDb().prepare("SELECT kind FROM daily_alerts").all();
  expect(alerts).toEqual([{ kind: "otp_global_cap" }]);
});

test("global cap: existing accounts can still log in", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  useUpNewAddressBudget();
  const res = await request.post("/api/auth/request-code", {
    // Different case on purpose: the account lookup must not be fooled by it.
    data: { email: TEST_USER_EMAIL.toUpperCase() },
  });
  expect(res.status()).toBe(200);
  expect(otpRowCount(TEST_USER_EMAIL.toUpperCase())).toBe(1);
  expect(outcomes().at(-1)).toBe("sent");
});

test("global cap: resets at midnight UTC", async () => {
  useUpNewAddressBudget("datetime(date('now'), '-1 seconds')");
  expect(recordOtpRequest(getTestDb(), "stranger@example.test")).toBe("sent");
});

test("old request rows are pruned after 7 days", async () => {
  const db = getTestDb();
  db.prepare(
    `INSERT INTO otp_requests (email_key, has_account, outcome, created_at)
     VALUES ('old@example.test', 0, 'sent', datetime('now', '-8 days'))`
  ).run();
  recordOtpRequest(db, "new@example.test");
  expect(db.prepare("SELECT email_key FROM otp_requests").all()).toEqual([
    { email_key: "new@example.test" },
  ]);
});

test("claimDailyAlert is true once per kind and day", () => {
  const db = getTestDb();
  expect(claimDailyAlert(db, "otp_global_cap")).toBe(true);
  expect(claimDailyAlert(db, "otp_global_cap")).toBe(false);
  expect(claimDailyAlert(db, "something_else")).toBe(true);
  db.prepare("UPDATE daily_alerts SET day = date('now', '-1 day')").run();
  expect(claimDailyAlert(db, "otp_global_cap")).toBe(true);
});

test("maskEmail keeps the first letter and the domain only", () => {
  expect(maskEmail("marek@example.test")).toBe("m***@example.test");
  expect(maskEmail("nonsense")).toBe("***");
});

// ── Suppression list ────────────────────────────────────────────────────────

test("suppression is case-insensitive and reversible", () => {
  const db = getTestDb();
  expect(suppressAddress(db, "Bounce@Example.test", "550", "manual")).toBe(true);
  expect(suppressAddress(db, "bounce@example.test", "550", "manual")).toBe(false);
  expect(isSuppressed(db, "BOUNCE@example.test")).toBe(true);
  expect(isSuppressed(db, "other@example.test")).toBe(false);
  expect(unsuppressAddress(db, "bounce@example.test")).toBe(true);
  expect(isSuppressed(db, "bounce@example.test")).toBe(false);
});

test("permanent failures: a bounce suppresses at once, anything else needs two messages", () => {
  const db = getTestDb();
  const fail = (recipient: string, reason: string, messageId: string) => ({
    recipient,
    reason,
    messageId,
    description: "550 5.7.1 Relaying denied",
  });
  const added = applyPermanentFailures(db, [
    fail("gone@example.test", "bounce", "m1"),
    fail("known-bounce@example.test", "suppress-bounce", "m2"),
    // Same message reported twice is still one message.
    fail("once@example.test", "generic", "m3"),
    fail("once@example.test", "generic", "m3"),
    fail("Twice@Example.test", "generic", "m4"),
    fail("twice@example.test", "generic", "m5"),
  ]);
  expect(added).toBe(3);
  expect(isSuppressed(db, "gone@example.test")).toBe(true);
  expect(isSuppressed(db, "known-bounce@example.test")).toBe(true);
  expect(isSuppressed(db, "once@example.test")).toBe(false);
  expect(isSuppressed(db, "twice@example.test")).toBe(true);

  // The hourly poll sees the same events again: nothing new, nothing duplicated.
  expect(applyPermanentFailures(db, [fail("gone@example.test", "bounce", "m1")])).toBe(0);
  const row = db.prepare("SELECT source, reason FROM mail_suppressions WHERE email = 'twice@example.test'").get();
  expect(row).toEqual({ source: "mailgun", reason: "generic: 550 5.7.1 Relaying denied" });
});
