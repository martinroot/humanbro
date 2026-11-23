"""Print the domains each Dolphin Anty profile holds cookies for.

Proof of a live session comes from the profile's own data dir, not from the
cabinet's cloud export-cookies endpoint (which can answer 200 with zero
domains for a logged-in profile) and not from the profile list's lastRunAt
(which can read "never run" for a profile that clearly ran).

Usage:
    python check_profile_session.py 900509436 900509445
    python check_profile_session.py --root "C:/Users/me/AppData/Roaming/dolphin_anty" 900509436

Prints host names only. Never prints cookie values.
"""

import argparse
import os
import sqlite3
import sys
import tempfile
import zipfile


def domains_from_cookies_db(blob: bytes) -> list[str]:
    handle, path = tempfile.mkstemp(suffix=".db")
    try:
        with os.fdopen(handle, "wb") as fh:
            fh.write(blob)
        con = sqlite3.connect(path)
        try:
            rows = con.execute("select distinct host_key from cookies").fetchall()
        finally:
            con.close()
        return sorted(r[0] for r in rows if r and r[0])
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def profile_paths(root: str, profile_id: str) -> list[str]:
    base = os.path.join(root, "browser_profiles", profile_id)
    found = []
    archive = os.path.join(base, f"{profile_id}.datadir.zip")
    if os.path.exists(archive):
        found.append(archive)
    live = os.path.join(base, "data_dir", "Default", "Cookies")
    if os.path.exists(live):
        found.append(live)
    return found


def report(root: str, profile_id: str) -> int:
    paths = profile_paths(root, profile_id)
    if not paths:
        print(f"{profile_id}: нет data dir — профиль не запускался")
        return 1
    for path in paths:
        try:
            if path.endswith(".zip"):
                with zipfile.ZipFile(path) as z:
                    names = [n for n in z.namelist() if n.endswith("Default/Cookies")]
                    if not names:
                        print(f"{profile_id}: в архиве нет Default/Cookies")
                        continue
                    hosts = domains_from_cookies_db(z.read(names[0]))
            else:
                with open(path, "rb") as fh:
                    hosts = domains_from_cookies_db(fh.read())
        except (zipfile.BadZipFile, sqlite3.Error, OSError) as exc:
            print(f"{profile_id}: не прочитан ({exc})")
            continue
        mtime = os.path.getmtime(path)
        print(f"{profile_id}: {len(hosts)} домен(ов) · mtime={mtime:.0f} · {os.path.basename(path)}")
        for host in hosts:
            print(f"    {host}")
    return 0


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("profile_ids", nargs="+")
    ap.add_argument(
        "--root",
        default=os.path.join(
            os.environ.get("APPDATA", os.path.expanduser("~/AppData/Roaming")),
            "dolphin_anty",
        ),
    )
    args = ap.parse_args(argv)
    rc = 0
    for profile_id in args.profile_ids:
        rc |= report(args.root, profile_id)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
