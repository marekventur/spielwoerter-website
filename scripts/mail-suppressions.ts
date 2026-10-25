import "dotenv/config";
import { getDb } from "../lib/db.js";
import {
  applyPermanentFailures,
  suppressAddress,
  unsuppressAddress,
} from "../lib/mail-limits.js";
import { fetchPermanentFailures } from "../server/mailgun.js";

/**
 * The mail suppression list (lib/mail-limits.ts), by hand. Run on the server:
 *
 *   npm run mail:suppressions -- list
 *   npm run mail:suppressions -- pull [days]      # Mailgun permanent failures → list
 *   npm run mail:suppressions -- add <email> [reason]
 *   npm run mail:suppressions -- remove <email>
 *
 * `pull` is what the hourly job does with days=7; run it once with a longer
 * window (as far back as the Mailgun plan keeps events) to seed the list.
 */
const [command, arg, ...rest] = process.argv.slice(2);
const db = getDb();

switch (command) {
  case "list": {
    const rows = db
      .prepare("SELECT email, source, reason, created_at FROM mail_suppressions ORDER BY created_at")
      .all() as { email: string; source: string; reason: string | null; created_at: string }[];
    for (const r of rows) console.log(`${r.created_at}  ${r.source.padEnd(7)}  ${r.email}  ${r.reason ?? ""}`);
    console.log(`${rows.length} suppressed`);
    break;
  }
  case "pull": {
    const failures = await fetchPermanentFailures(Number(arg) || 7);
    const added = applyPermanentFailures(db, failures);
    console.log(`${failures.length} permanent failure(s) read, ${added} address(es) newly suppressed`);
    break;
  }
  case "add":
    if (!arg) usage();
    console.log(suppressAddress(db, arg, rest.join(" ") || null, "manual") ? "added" : "already suppressed");
    break;
  case "remove":
    if (!arg) usage();
    // The hourly pull re-adds it while Mailgun still has the failures (7 days).
    console.log(unsuppressAddress(db, arg) ? "removed" : "not suppressed");
    break;
  default:
    usage();
}

function usage(): never {
  console.error("usage: mail-suppressions list | pull [days] | add <email> [reason] | remove <email>");
  process.exit(1);
}
