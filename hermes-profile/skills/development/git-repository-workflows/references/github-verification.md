# GitHub access and push verification

## SSH auth probe

`ssh -i ~/.ssh/id_ed25519 -o StrictHostKeyChecking=accept-new -o BatchMode=yes -T git@github.com`

- `Hi <user>! You've successfully authenticated, but GitHub does not provide shell access.` with exit 1 means success.
- Port reachability check: `timeout 15 bash -c 'cat < /dev/null > /dev/tcp/github.com/22'`.
- With several keys in `~/.ssh`, a plain probe only proves *some* key works. Force the intended one: `GIT_SSH_COMMAND="ssh -i ~/.ssh/id_ed25519 -o IdentitiesOnly=yes" git ls-remote <url>`. Without `IdentitiesOnly=yes` the agent may offer a different key first, so the probe says nothing about the key you plan to use.

## Repo metadata

- `GET https://api.github.com/repos/{owner}/{repo}` → `ssh_url`, `default_branch`, `private`, `size`.
- `GET https://api.github.com/users/{username}` → numeric `id` for the no-reply email `{id}+{username}@users.noreply.github.com`.
- Empty repo: API returns HTTP 200 with `size: 0`, and `git ls-remote <url>` returns no refs with exit 0.

## Push verification

- `git ls-remote origin refs/heads/main` must equal `git rev-parse HEAD` exactly.
- `GET https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1` → count entries with `type == "blob"`, require `truncated: false`, compare with local `git ls-files | wc -l`.
- The top-level `size` field can remain 0 after a successful push; use the tree count as the source of truth.
