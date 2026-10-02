# P0-aa — Secure two-device pilot host

Status: **candidate final infrastructure rung before human pair 01**

P0-aa turns the qualified local CommonLine build into a secure two-device pilot host without weakening the existing HTTPS/WSS transport policy.

It does not create human evidence.

## Why P0-aa exists

Ordinary development serves the web UI on localhost. That is appropriate for one-machine development but not for a real two-human pilot on two independent devices.

CommonLine intentionally refuses insecure non-localhost pages and plain WebSocket signaling outside localhost.

P0-aa preserves that rule.

The pilot host uses one short-lived local certificate for:

- HTTPS web UI on port 5173
- HTTPS health endpoint and WSS signaling on port 8787

The mediasoup SFU remains on port 44444 and announces the detected private LAN address.

Ollama remains loopback-only on the host machine.

## Evidence/runtime binding

The launcher requires:

    pilot-local/registration.launch.json

It validates that registration as launch-ready and derives the live worker configuration from it:

- worker mode
- exact model tag
- local Ollama endpoint
- registered timeout
- frozen numCtx

Immediately before hosting, P0-aa calls local Ollama and requires the installed model digest to equal the digest frozen into the launch registration.

If the digest drifted, the host refuses to start.

## Step 1 — Create the local pilot certificate

From the CommonLine repository on the host Windows PC:

    npm run pilot:p0:create-cert

This creates, under ignored pilot-local/tls:

    commonline-pilot.pfx
    commonline-pilot.cer
    pfx-passphrase.txt

The certificate is valid for:

- the host Windows computer name
- localhost

The script trusts the certificate in the host user's CurrentUser root store.

The PFX contains the private key and stays on the host.

The CER is public and is the only certificate file copied to the second participant PC.

## Step 2 — Allow the pilot ports through Windows Firewall

Run an elevated PowerShell on the host once:

    New-NetFirewallRule -DisplayName "Commonline P0 Web" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private
    New-NetFirewallRule -DisplayName "Commonline P0 Signaling" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8787 -Profile Private
    New-NetFirewallRule -DisplayName "Commonline P0 SFU TCP" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 44444 -Profile Private
    New-NetFirewallRule -DisplayName "Commonline P0 SFU UDP" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 44444 -Profile Private

These rules are scoped to the Windows Private network profile.

Do not expose Ollama port 11434.

## Step 3 — Load the local PFX passphrase

In the ordinary PowerShell that will run CommonLine:

    $env:COMMONLINE_TLS_PFX_PASSPHRASE = Get-Content "pilot-local\tls\pfx-passphrase.txt"

The passphrase file stays under pilot-local and is ignored by Git.

## Step 4 — Start the registration-bound pilot host

Run:

    npm run pilot:p0:host -- pilot-local/registration.launch.json --pfx pilot-local/tls/commonline-pilot.pfx

The launcher:

1. validates the launch registration
2. verifies the live Ollama model digest
3. finds a physical private LAN IPv4 address
4. ignores common VirtualBox, VMware, Hyper-V, WSL, Docker, and Tailscale adapter names when selecting the preferred LAN address
5. configures the P0-w worker from the registration
6. binds Vite HTTPS to 0.0.0.0:5173
7. enables HTTPS/WSS on port 8787
8. binds mediasoup to 0.0.0.0:44444
9. announces the selected LAN IP to WebRTC clients
10. starts the normal CommonLine dev runtime

If automatic LAN detection chooses the wrong interface, stop the host and explicitly provide the correct address:

    npm run pilot:p0:host -- pilot-local/registration.launch.json --pfx pilot-local/tls/commonline-pilot.pfx --lan-ip 192.168.x.x

Only RFC1918 private addresses are accepted.

## Step 5 — Trust the public certificate on participant B

Copy only:

    pilot-local/tls/commonline-pilot.cer

to the second Windows PC.

On that second PC, run PowerShell:

    Import-Certificate -FilePath ".\commonline-pilot.cer" -CertStoreLocation "Cert:\CurrentUser\Root"

Restart the browser after importing if it was already open.

Do not copy:

- commonline-pilot.pfx
- pfx-passphrase.txt

to participant devices.

## Step 6 — Resolve the host computer name

The launcher prints the participant-B URL:

    https://HOSTNAME:5173

From the second PC, first test:

    ping HOSTNAME

If the hostname resolves to the pilot host's LAN IP, continue.

If it does not resolve, add a temporary hosts entry on participant B from elevated PowerShell:

    Add-Content -Path "$env:SystemRoot\System32\drivers\etc\hosts" -Value "192.168.x.x HOSTNAME"

Use the LAN IP printed by the P0-aa launcher and the exact host name printed by the certificate script.

The browser URL must use the certificate hostname rather than the bare IP because the certificate is issued for that hostname.

## Step 7 — Open the two independent participant sessions

Participant A on the host PC:

    https://localhost:5173

Participant B on the second PC:

    https://HOSTNAME:5173

The two browsers must use independent local identities.

Before collecting evidence, both participants should confirm that the CommonLine worker disclosure shows:

- MODE OLLAMA-LOCAL
- PROVIDER OLLAMA
- TOOLS OFF
- CTX 4096
- INPUT WORK-PROMPT-ONLY
- model qwen3.6:latest

The server health surface should report:

    transport: https-wss

## Step 8 — Use the frozen pair packet

For the first human pair use:

    pilot-local/execution/pair-01.assignment.json

Pair 01 is sequence A:

    period 1: CommonLine + task A
    period 2: baseline   + task B

Do not swap tasks or conditions.

The result draft remains incomplete until observations are actually collected.

## Security boundary

P0-aa does not disable CommonLine transport protections.

It does not:

- expose Ollama to the LAN
- permit plain HTTP pilot pages
- permit plain WS signaling
- distribute the server private key
- change authority grants
- change room/storage schemas
- create participant evidence

The TLS certificate is a short-lived local pilot credential, not a production PKI design.

## Cleanup

After the pilot, the Windows firewall rules can be removed from elevated PowerShell:

    Remove-NetFirewallRule -DisplayName "Commonline P0 Web"
    Remove-NetFirewallRule -DisplayName "Commonline P0 Signaling"
    Remove-NetFirewallRule -DisplayName "Commonline P0 SFU TCP"
    Remove-NetFirewallRule -DisplayName "Commonline P0 SFU UDP"

The local pilot certificate can also be removed from the user's certificate stores when the pilot is complete.

P0-aa is intentionally a LAN pilot host, not a public deployment mechanism.
