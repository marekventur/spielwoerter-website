"""Run on vps3, read-only: prints every moderator decision as one JSON line.
   ssh vps3 'sudo python3 -I -' < scripts/groundtruth/export_decisions.py > decisions.jsonl"""
import json
import sqlite3

db = sqlite3.connect("file:/var/www/spielwoerter.de/data/app.db?mode=ro", uri=True)
db.row_factory = sqlite3.Row
for r in db.execute(
    "SELECT id, word, action, payload, status, created_at FROM suggestions"
    " WHERE status IN ('moderator_approved', 'moderator_rejected')"
):
    print(json.dumps(dict(r), ensure_ascii=False))
