# Destructive portal controls: backup and proof recipe

Use when adding or repairing a one-click data-wipe control in a FastAPI + reverse-proxy portal.

## Implementation shape
- Snapshot every affected table to a timestamped JSON under the app's `backups/` directory before deleting; clear only the pipeline/funnel tables. Preserve skill catalogs, profile templates/skills, and settings.
- Return a machine-readable result with the backup path and per-table counts so the UI can show the backup location.
- When the owner asks for a button without extra confirmations, remove both the text confirm field and the server-side confirm check; the backup is the safety net.

## Pitfalls
- A global `DictCursor` connection default breaks helpers that index `fetchone()[0]`; open `conn.cursor(pymysql.cursors.Cursor)` explicitly for tuple-style counts. On the default cursor use `COUNT(*) AS n` and read `row['n']`.
- The page may build API URLs from a different base than the app registers (`api2 = /api/mll2` on the scoring page). Register the endpoint at that exact path and verify through the public `/portal/...` URL with its basic auth — a bare `/api/...` route behind nginx returns 404 and the UI shows a generic failure.
- Deleting a confirmation input but leaving `inp.value=''` in the success branch yields a ReferenceError after the wipe, so the UI reports failure although the data is gone. Extract the rendered `<script>` and `node --check` it after every UI edit.

## End-to-end proof without leaving the database empty
1. Full JSON backup of all tables; record row counts.
2. Call the real endpoint through the public path; assert success and zero counts.
3. Restore from the JSON with `INSERT IGNORE` — a background collector can insert a fresh row between wipe and restore, so a plain INSERT raises a duplicate key.
4. Re-check counts and statuses against the pre-wipe snapshot and report the backup path.
