import { defineConfig } from "@playwright/test";
import { TEST_DB_PATH, TEST_PORT } from "./helpers/test-config";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 1, // Retry once for cold-start / timing flakes
  workers: 1, // SQLite can't handle concurrent writers from multiple workers
  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "on-first-retry",
  },
  expect: {
    // Allow more time for assertions — cold Vite SSR compilation can be slow
    timeout: 15_000,
  },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  webServer: {
    command: `cross-env DATABASE_PATH=${TEST_DB_PATH} PORT=${TEST_PORT} NODE_ENV=development node server.js`,
    cwd: new URL("..", import.meta.url).pathname,
    port: TEST_PORT,
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      DATABASE_PATH: TEST_DB_PATH,
      PORT: String(TEST_PORT),
      NODE_ENV: "development",
      // Override to empty string so dotenv doesn't load the real key from .env
      // (empty string is falsy → server falls back to console.log for OTP codes)
      MAILGUN_API_KEY: "",
      // Same for the enrichment LLM: tests must be offline/deterministic
      // (empty key → enrichWord returns the algorithmic fallback, no variants)
      DEEPSEEK_API_KEY_SUGGESTIONS: "",
      // Inbound mail endpoint: the path secret the tests post to.
      INBOUND_SECRET: "test-inbound-secret",
      MAILGUN_DOMAIN: "mail.test",
      DISKUSSION_ADDRESS: "moderatoren-test@mail.test",
    },
  },
});
