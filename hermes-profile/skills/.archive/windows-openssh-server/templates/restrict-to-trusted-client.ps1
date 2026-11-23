#Requires -RunAsAdministrator
param(
    [Parameter(Mandatory = $true)][string]$TrustedClientIPv4,
    [Parameter(Mandatory = $true)][string]$PublicKey
)

$ErrorActionPreference = 'Stop'
$ip = [System.Net.IPAddress]::Parse($TrustedClientIPv4)
if ($ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'Provide one exact public IPv4 address; do not use Any or an unspecified label.'
}
if ($PublicKey -notmatch '^ssh-(ed25519|rsa|ecdsa-sha2-[^ ]+)\s+\S+') {
    throw 'PublicKey must be a valid OpenSSH public-key line. Never pass a private key.'
}

$sshDir = Join-Path $env:ProgramData 'ssh'
$sshdExe = Join-Path $env:WINDIR 'System32\OpenSSH\sshd.exe'
$service = Get-Service -Name sshd -ErrorAction SilentlyContinue
if (-not (Test-Path $sshdExe) -or -not $service) {
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
    $service = Get-Service -Name sshd -ErrorAction SilentlyContinue
}
if (-not (Test-Path $sshdExe) -or -not $service) { throw 'OpenSSH Server is not installed.' }

$keyFile = Join-Path $sshDir 'administrators_authorized_keys'
New-Item -ItemType Directory -Path $sshDir -Force | Out-Null
$lines = @()
if (Test-Path $keyFile) { $lines = [System.IO.File]::ReadAllLines($keyFile) }
if ($lines -notcontains $PublicKey) { $lines = @($lines | Where-Object { $_ }) + $PublicKey }
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllLines($keyFile, $lines, $utf8NoBom)
& icacls.exe $keyFile /inheritance:r /grant:r '*S-1-5-32-544:(F)' '*S-1-5-18:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to set administrators_authorized_keys ACL.' }

& $sshdExe -t
if ($LASTEXITCODE -ne 0) { throw 'sshd_config validation failed.' }

# Replace an existing rule of this script's name, then disable the broad default rule.
$ruleName = 'OpenSSH-Server-In-TCP-TrustedClient'
Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
New-NetFirewallRule -Name $ruleName `
    -DisplayName "OpenSSH from trusted client ($TrustedClientIPv4)" `
    -Enabled True -Direction Inbound -Protocol TCP -LocalPort 22 `
    -RemoteAddress $TrustedClientIPv4 -Action Allow -Profile Any | Out-Null
$legacy = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
if ($legacy) { Disable-NetFirewallRule -Name $legacy.Name }

$active = Get-NetFirewallRule -Name $ruleName
$remote = @($active | Get-NetFirewallAddressFilter | Select-Object -ExpandProperty RemoteAddress)
$ports = $active | Get-NetFirewallPortFilter
if ($remote.Count -ne 1 -or $remote[0] -ne $TrustedClientIPv4 -or $ports.Protocol -ne 'TCP' -or $ports.LocalPort -ne '22') {
    throw 'Firewall read-back did not match the requested source IP and TCP/22.'
}

Set-Service -Name sshd -StartupType Automatic
Restart-Service -Name sshd -Force
if ((Get-Service -Name sshd).Status -ne 'Running') { throw 'sshd failed to reach Running state.' }
if (-not (Get-NetTCPConnection -State Listen -LocalPort 22 -ErrorAction SilentlyContinue)) {
    throw 'sshd is running but no TCP/22 listener is present.'
}
Write-Host "sshd running; inbound TCP/22 restricted to $TrustedClientIPv4."
Write-Host 'Password authentication was left unchanged; test key login before disabling it.'
