---
name: windows-openssh-server
description: Use when configuring Windows OpenSSH Server. Restrict SSH.
---

# Windows OpenSSH Server setup

Use for installing or securing inbound SSH on a Windows host, especially when granting administrator access from one trusted client.

## Procedure

Use `templates/restrict-to-trusted-client.ps1` as the idempotent baseline, replacing both required inputs with the exact trusted client's public IPv4 and public key.

1. Confirm the target Windows host and the client's exact public IPv4/CIDR. The firewall remote address is the *client's* egress IP, not the Windows host's public IP. If the user gives only a label such as “169”, stop and ask for the full address.
2. Before changes, check elevation, `sshd.exe`, the `sshd` service, the current sshd configuration, and enabled inbound TCP/22 rules with their remote-address filters. Do not infer that an administrator-named account is running elevated.
3. Install OpenSSH Server only if the binary/service is absent. Validate the configuration with `sshd.exe -t` before restarting the service.
4. Add the supplied public key idempotently to `C:\ProgramData\ssh\administrators_authorized_keys`; do not append duplicates. Apply the Windows OpenSSH ACL: remove inheritance and grant `SYSTEM:F` and `Administrators:F` only.
5. Create or update an inbound TCP/22 firewall rule restricted to the exact trusted client address. Disable or narrow the default `OpenSSH-Server-In-TCP` rule if it allows `RemoteAddress=Any`; a second restricted rule does not neutralize a broad allow rule.
6. Set `sshd` to Automatic, start/restart it, then verify service state, `sshd -t`, TCP/22 listener, authorized-key count/ACL, and effective SSH firewall rule address.
7. Keep password authentication unchanged until the client has successfully connected with the key. Claim key-based access works only after a test from the trusted client; local listening and a firewall rule do not prove end-to-end login.

## Safety pitfalls

- Never expose inbound SSH to `Any` when the user requested a single-source allowlist; open access invites credential attacks and may bypass the intended boundary.
- Inspect existing rules before adding one: Windows Firewall allow rules are cumulative, so an old broad rule can leave the port open even when a new narrow rule exists.
- Make scripts idempotent: compare the exact public-key line before writing and update a named firewall rule instead of accumulating duplicates.
- Do not disable password authentication before a successful key login, or a bad key/ACL can lock out the administrator.
- Do not modify unrelated Windows firewall rules or broadly reset policies to achieve a narrow SSH exception.
- Do not handle or request the client's private key; only the public key belongs in `administrators_authorized_keys`.
