---
name: git-repository-workflows
description: Use when cloning or importing a git repo to a new remote.
---

# Git repository workflows

This user writes in Russian; reply in Russian for these tasks unless they switch language.

## Always-on rules

- Clarify an ambiguous "repo / SSH" request before acting: public key to register, new key, remote setup, or clone URL. One clarify call with concrete choices beats guessing.
- Never ask for or paste tokens, passwords, or card data in chat. Prefer SSH keys; if an API token is unavoidable, use the vault or have the user create the empty remote and push over SSH.
- Preserve upstream `LICENSE` and `NOTICE` in every import, and credit the source URL in the initial commit body.
- Do not trust the GitHub API `size` field immediately after a push; it can stay stale at 0. Verify with refs and tree counts (see `references/github-verification.md`).

## Procedure: clean independent copy of an existing repo

1. **Probe** before changing anything:
   - `curl -s https://api.github.com/repos/<owner>/<repo>` → existence, `private`, `size`, `default_branch`, `ssh_url`.
   - `ssh -i ~/.ssh/id_ed25519 -o BatchMode=yes -T git@github.com` → auth identity; exit 1 with "successfully authenticated" is normal.
   - Search `$HOME` for an existing local copy and check free disk space.

2. **Clone shallow** when a clean history is wanted: `git clone --depth 1 <url>`. A shallow clone has no upstream history by construction. Use a full clone only for a true GitHub Fork.

3. **Save the upstream file manifest** before touching `.git`: `git ls-files | sort > <tmp>`. Re-adding with `git add -A` drops upstream-tracked files that match `.gitignore`.

4. **Re-init clean**:
   ```
   rm -rf .git
   git init -b main
   git config user.name "<Name>"
   git config user.email "<id>+<username>@users.noreply.github.com"
   git add -A
   comm -23 <saved_manifest> <(git diff --cached --name-only | sort)   # list dropped files
   git add -f <dropped paths>
   git commit -m "Initial import of <project>" -m "Imported from <source URL>. Original LICENSE and NOTICE preserved."
   ```
   Derive `<id>` from `GET https://api.github.com/users/<username>` when no git identity is configured; the no-reply form avoids exposing a private address.

5. **Publish**: `git remote add origin <ssh_url>` then `git push -u origin main`. The remote must already exist and be empty — GitHub cannot auto-create it over git/ssh.

6. **Verify** all three:
   - `git ls-remote origin refs/heads/main` equals `git rev-parse HEAD`.
   - `git status --porcelain` is empty.
   - trees API recursive blob count equals local `git ls-files | wc -l`, with `truncated: false`.

7. **If the target must have exactly one commit**, squash before final verification: `git reset --soft HEAD~1 && git commit --amend --no-edit && git push --force-with-lease origin main`. Force-push only on a repo just created for this purpose.

## Pitfalls

- Capture the upstream tracked-file list before deleting `.git`; `git add -A` silently omits ignored-but-tracked fixtures, producing an incomplete import that still looks clean locally.
- Force-add a small known set of ignored fixtures with explicit `git add -f <paths>`; avoid pipe-based pathspec tricks tied to newer git options.
- Compare staged paths against the saved manifest — a clean `git status` on the fresh repo says nothing about files that were never added.
- Confirm the target remote is empty before pushing; a remote that already has commits makes a clean single-commit result impossible without a forced rewrite.
- When the user says "fork" but chooses a clean history, do not add an `upstream` remote; treat it as an independent repo and offer the upstream link separately.

## References

- `references/github-verification.md` — API endpoints, no-reply identity, and why `size` is stale.
