# Packaging the stack for handoff: a runnable archive, not a data dump

Companion to the pool skill. Use when the owner asks for «скинь всю обвязку» —
the scripts, the registry, the sandbox, the portal, the profiles — as an
archive that someone else (or a later session on another box) can pick up.

## What the deliverable is

A ZIP containing the source and restorable state; it becomes runnable only after the recipient installs the required runtimes, re-enters omitted secrets, and re-authenticates browser sessions. Never call it self-contained when those are excluded. Two constraints shape
it: the owner usually wants to move it through a chat (so there is a file-size
ceiling), and the archive must not carry the pool's live credentials or live
session cookies.

## Order of work

1. **Inventory by size first, not by list.** Walk the roots and print each
   directory's size and file count; the big blocks are always the same
   (browser caches, the anti-detect browser binary, extension folders, log
   archives, database snapshots, downloaded media) and they are the bulk of the
   archive.
2. **Split the tree into INCLUDE and EXCLUDE by rule, not by hand.** Write the
   exclusion rules into the packer (cache directory names, `node_modules`,
   `.git`, media extensions, log files) so the same command produces the same
   archive next week.
3. **Mask secrets by value across every included member.** Collect sensitive
   values from env files without printing them, and inspect source/config files
   for hardcoded credentials and opaque secret-like settings (including a
   random value under a generic `key` field). Replace exact values in staged
   text/config/SQL and re-scan the finished archive contents; excluding `.env`
   by filename alone is insufficient. If a source file hardcodes a DB/API
   credential, change only the staged copy to read an environment variable and
   include a launcher that actually loads the local `.env`. Generate
   `.env.example` from variable names only. Treat DB snapshots as confidential
   even after credentials are removed: they contain business/customer data.
4. **Take consistent runtime snapshots.** Use the database's online snapshot
   mechanism (`mysqldump --single-transaction` for InnoDB; SQLite's backup API
   for a live SQLite DB) rather than copying open DB/WAL files. The registry DB
   is business state: without it the order history, statuses and dedup state
   are lost. Ship it and prove the extracted copy opens and answers a query.
5. **Write a manifest**: what each top-level directory is, the commands that
   start the contour, the ports, the env variable names to fill in, and the two
   facts a reader must not assume (profiles may carry live sessions; the
   registry is the source of truth).
6. **Verify before shipping** (below).

## Size discipline

A chat file ceiling is real: an archive above it cannot be delivered in one
message and gets split into parts the reader then has to stitch. Exclude the
heavy blocks first and measure; if the result is still too big, the next
candidates are media and the browser binary — never the code and never the DB.

When the owner says «без медиа», that is a directive about the archive's
CONTENTS, not just about its size: a picture of every card is not part of the
deliverable.

Splitting a ZIP into parts is mechanical, but the parts are useless without
the stitch command in the message, and a ZIP split before compression is not a
ZIP. Compress first, then split the compressed file, and say how to join it.

## Verification checklist (all four, before shipping)

- `testzip()` on the finished archive returns clean.
- Each SQLite snapshot extracted from the archive passes `PRAGMA integrity_check` and answers a query; the MariaDB dump contains the expected table definitions and data statements.
- When the DB account permits it, rehearse a restore into an isolated temporary schema, query table counts, then drop and verify that schema is gone. If `CREATE DATABASE` is denied, do not elevate privileges or restore over live data; report that the dump was structurally checked but not restore-tested.
- Every known secret value is absent from every archive member (scan decompressed CONTENTS, not names); include env-derived values plus hardcoded/config secrets such as opaque generic `key` fields.
- `testzip()` is clean and the top-level directory list matches the manifest.

## What stays out by default

- **Media** — card screenshots, order attachments, generated photos.
- **Live session material** — anti-detect profile cookies and local storage:
  these are the account's own access, and an archive that leaves the machine
  should not carry them unless the owner explicitly asks for a profile
  snapshot.
- **The browser binary and caches** — reinstallable, and they dominate the size.
- **Session exports** (a JSON dump of a logged-in session) — same reason as
  cookies.
- **Credentials of any kind** — tokens, API keys, passwords. The env files
  themselves are replaced by `.env.example`.
