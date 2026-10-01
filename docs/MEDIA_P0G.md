# P0-g Real Internet Media Hardening

Status: **candidate hardened one-to-one internet media rung**

Wire schema: `p0-g.1`  
Storage schema: `p0-g.1`

P0-g keeps Commonline's room semantics intact while making the first human-to-human WebRTC path more credible outside friendly local networks.

## Governing separation

```text
MEDIA CONNECTIVITY
      ≠
ROOM AUTHORITY
```

STUN and TURN help packets find or traverse a path. They do not become participants, receive room grants, gain room history, or enter durable Commonline state.

## Authenticated ICE configuration

ICE configuration is requested only after:

```text
identity proof
    ↓
room join
    ↓
rtc_config_request
    ↓
rtc_config
```

The server may return:

- STUN URLs
- TURN URLs
- ICE transport policy
- credential mode
- optional credential expiry

RTC configuration is ephemeral transport state and is not persisted as a room event.

## TURN credential modes

### Ephemeral REST credentials

Preferred deployment mode with coturn-compatible REST authentication:

```text
COMMONLINE_TURN_SHARED_SECRET
COMMONLINE_TURN_CREDENTIAL_TTL_SECONDS
```

For each authenticated participant the Commonline server creates:

```text
username   = <unix-expiry>:<participant-id>
credential = base64(HMAC-SHA1(shared-secret, username))
```

The shared secret never leaves the Commonline server.

The client refreshes expiring ICE configuration before credential expiry.

### Static credentials

```text
COMMONLINE_TURN_USERNAME
COMMONLINE_TURN_CREDENTIAL
```

are supported only as a local/demo fallback. Long-lived static TURN credentials are not the intended public deployment model.

## ICE transport policy

Default:

```text
COMMONLINE_ICE_TRANSPORT_POLICY=all
```

This permits direct host/server-reflexive paths with TURN fallback.

For relay verification:

```text
COMMONLINE_ICE_TRANSPORT_POLICY=relay
```

The server refuses relay-only mode unless TURN is actually configured.

## Secure transport defaults

Commonline permits plain `ws://` only on loopback development hosts.

A deployed room requires:

- HTTPS page context
- WSS signaling
- secure microphone context

This is especially important because the signaling connection also carries identity challenge traffic and may carry recovery secrets during a recovery operation.

P0-g does not ship TLS termination inside the Node room service. A deployed server should sit behind a TLS-capable reverse proxy or platform ingress.

## Call lifecycle hardening

P0-g adds:

- 20 second call-setup timeout
- 30 second unanswered incoming-call timeout
- 10 second disconnect recovery grace period
- immediate cleanup on ICE or peer-connection failure
- local microphone-ended cleanup
- remote failure/hangup cleanup
- call timers and stats polling cleanup on room disconnect/unmount

The purpose is to avoid phantom calls and orphaned microphone tracks after network failure.

## Call diagnostics

The browser exposes local runtime diagnostics:

- browser online/offline state
- secure media-context status
- signaling state
- ICE gathering state
- ICE connection state
- peer connection state
- selected route: direct / relay / unknown
- local candidate type
- remote candidate type
- selected protocol
- relay protocol when available
- RTT
- jitter
- packets received / lost
- bytes sent / received
- most recent ICE candidate error

Diagnostics are observational and ephemeral. They are not persisted to SQLite or added to resume history.

## Network interpretation

Typical selected candidate types:

| Candidate | Meaning |
|---|---|
| `host` | local interface candidate |
| `srflx` | server-reflexive candidate discovered through STUN |
| `prflx` | peer-reflexive candidate |
| `relay` | TURN relay candidate |

If either side of the selected candidate pair is `relay`, Commonline labels the route **relay**. Otherwise a known selected pair is labeled **direct**.

## Configuration

```text
COMMONLINE_STUN_URLS=
COMMONLINE_TURN_URLS=
COMMONLINE_TURN_SHARED_SECRET=
COMMONLINE_TURN_CREDENTIAL_TTL_SECONDS=3600
COMMONLINE_TURN_USERNAME=
COMMONLINE_TURN_CREDENTIAL=
COMMONLINE_ICE_TRANSPORT_POLICY=all
```

Multiple STUN/TURN URLs are comma-separated.

## Proof suite

P0-g tests:

1. STUN-only configuration stays non-relay
2. coturn REST credentials are generated deterministically
3. relay-only policy works only with TURN
4. TURN configuration without credentials fails closed
5. insecure non-local signaling is refused
6. HTTPS deployments require WSS
7. selected relay candidate pairs are classified as relay
8. RTT/jitter/loss/byte metrics are extracted from WebRTC stats
9. P0-f storage metadata migrates explicitly to P0-g

## Still deferred

P0-g does not yet add:

- multi-party SFU media
- agent listening
- agent speech
- recording
- transcription
- call-history persistence
- SIP/PSTN
- public account enrollment
- automatic TURN server provisioning

Those are different authority, privacy, or infrastructure problems and should remain different rungs.
