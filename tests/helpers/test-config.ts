import path from "path";
import os from "os";

// Overridable: on shared dev boxes 3005 may already belong to another service.
export const TEST_PORT = Number(process.env.TEST_PORT) || 3005;
export const BASE_URL = `http://localhost:${TEST_PORT}`;
export const TEST_DB_PATH = path.join(os.tmpdir(), "spielwoerter-test.db");

// Test emails — never sent to real mailboxes (no MAILGUN_API_KEY in test env)
export const TEST_USER_EMAIL = "testuser@example.test";
export const TEST_MOD_EMAIL = "moderator@example.test";
export const TEST_ADMIN_EMAIL = "admin@example.test";
export const TEST_USER2_EMAIL = "testuser2@example.test";
