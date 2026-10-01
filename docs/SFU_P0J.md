# P0-j Governed mediasoup SFU

Status: candidate real SFU enforcement rung

Wire schema: p0-j.1
Storage schema metadata: p0-j.1

P0-j replaces the cooperative P0-i three-browser media mesh with a real mediasoup selective forwarding unit while preserving Commonline's existing participant, grant, source, and subscription authority model.

## Governing boundary

Commonline decides participant identity, group membership, SPEAK authority, RECEIVE_MEDIA authority, source identity, and directed subscriptions. Mediasoup enforces Producer creation, Consumer creation, and RTP forwarding. The SFU is infrastructure, not a Commonline participant.

## Scope

- maximum three human participants
- microphone audio only
- Opus router codec
- one governed microphone source per human
- explicit directed subscriptions
- no video, recording, transcription, agent listening, agent speech, or PSTN

## Producer authorization

A mediasoup Producer is created only when the authenticated participant belongs to the current group generation, still has SPEAK, and owns the already-published Commonline microphone source ID.

## Consumer authorization

A mediasoup Consumer is created only when the authenticated participant belongs to the current group generation, still has RECEIVE_MEDIA, the source exists, and Commonline contains an explicit directed subscription from that participant to that source. Router capability checks must also pass.

Knowing a source ID is therefore not permission to receive it. Joining group media is not permission to receive it. RECEIVE_MEDIA alone is not a subscription.

## Browser flow

The browser loads mediasoup-client Device from server router RTP capabilities. Send and receive transports are created lazily, DTLS parameters travel through authenticated Commonline signaling, a published microphone becomes a Producer, and an explicit subscription becomes a Consumer. Consumers are created paused server-side and resumed after the browser constructs the matching consumer.

## Reconciliation and cleanup

Removing a subscription closes the corresponding Consumer. Unpublishing a source closes its Producer and dependent Consumers. Leaving group media closes that participant's SFU resources. Ending the final group session closes the Router.

## Network configuration

Local development defaults to COMMONLINE_SFU_LISTEN_IP=127.0.0.1 and COMMONLINE_SFU_PORT=44444. A wildcard deployment bind requires COMMONLINE_SFU_ANNOUNCED_ADDRESS so browsers receive a reachable ICE address. The listener exposes UDP and TCP and prefers UDP.

The P0-g STUN/TURN settings remain for the separate P0-h one-to-one path. P0-j group media uses mediasoup's server-facing ICE transport.

## Persistence boundary

No SFU Worker, Router, WebRtcServer, Transport, Producer, Consumer, RTP parameter, ICE parameter, DTLS parameter, or audio packet is stored in SQLite. A process restart ends live group media but preserves the durable undertaking.

## Acceptance

CI must prove the native mediasoup worker can boot and create an Opus Router. The final P0-j acceptance test remains a live three-browser run: Alice publishes; Bob subscribes; Charlie does not. Bob should hear Alice and Charlie should not receive Alice. Adding Charlie's subscription should then create Charlie's Consumer without altering room authority.