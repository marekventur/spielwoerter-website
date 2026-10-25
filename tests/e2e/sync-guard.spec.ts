/** lib/sync.ts must never overwrite anything with a broken or short list download. */
import { test, expect } from "@playwright/test";
import { assertPlausibleLists, MIN_ACCEPTED } from "../../lib/sync";

test("lists below the minimum or far smaller than the table are refused", () => {
  expect(() => assertPlausibleLists(0, 0)).toThrow(/only 0 words/);
  expect(() => assertPlausibleLists(MIN_ACCEPTED - 1, 0)).toThrow(/minimum/);
  expect(() => assertPlausibleLists(150_000, 238_000)).toThrow(/shrank/);
});

test("normal syncs pass, including a few hundred removals and an empty table", () => {
  expect(() => assertPlausibleLists(238_000, 0)).not.toThrow();
  expect(() => assertPlausibleLists(237_400, 238_000)).not.toThrow();
  expect(() => assertPlausibleLists(240_000, 238_000)).not.toThrow();
});
