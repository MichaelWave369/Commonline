import { useEffect, useMemo, useRef, useState } from "react";
import type { Capability } from "@commonline/protocol";
import { Badge, Button, Card, SectionTitle } from "@commonline/ui";
import { useCommonlineRoom } from "./useCommonlineRoom";
import { usePeerAudio } from "./usePeerAudio";

export function App() {
  const roomSession = useCommonlineRoom();
  const {
    participantId,
    sessionId,
    identityState,
    recoveryCode,
    clearRecoveryCode,
    recoverIdentity,
    name,
    setName,
    requestedRole,
    setRequestedRole,
    room,
    connection,
    resumeDelta,
    lastEvent,
    lastAcceptance,
    lastAuthorityTransfer,
    agentStatuses,
    rtcInbox,
    rtcSessionInbox,
    rtcConfig,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptOutcome,
    transferAcceptAuthority,
    openRtcCall,
    sendRtcSignal,
    consumeRtcSession,
    consumeRtcSignal
  } = roomSession;

  const audio = usePeerAudio({
    roomConnected: connection === "connected",
    rtcConfig,
    rtcSessionInbox,
    rtcInbox,
    consumeRtcSession,
    consumeRtcSignal,
    openRtcCall,
    sendRtcSignal
  });

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [taskText, setTaskText] = useState(
    "Compare two approaches and return the trade-offs as a compact artifact."
  );
  const [recoverParticipantId, setRecoverParticipantId] = useState(participantId);
  const [recoverCodeInput, setRecoverCodeInput] = useState("");

  useEffect(() => {
    if (!remoteAudioRef.current) return;
    remoteAudioRef.current.srcObject = audio.remoteStream;
    if (audio.remoteStream) {
      void remoteAudioRef.current.play().catch(() => {
        // Browser autoplay policy may require an explicit play gesture.
      });
    }
  }, [audio.remoteStream]);

  useEffect(() => {
    setRecoverParticipantId(participantId);
  }, [participantId]);

  const me = room?.participants.find(
    (participant) => participant.id === participantId
  );

  const grantIsRevoked = (grantId: string) =>
    room?.grantRevocations.some(
      (revocation) => revocation.grantId === grantId
    ) ?? false;

  const activeGrant = (
    capability: Capability,
    subjectId = participantId
  ) =>
    room?.grants.find(
      (grant) =>
        grant.subjectParticipantId === subjectId &&
        grant.capability === capability &&
        !grant.revokedAt &&
        !grantIsRevoked(grant.grantId) &&
        (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now())
    );

  const acceptGrant = activeGrant("ACCEPT_OUTCOME");
  const canAccept = Boolean(acceptGrant);
  const canSpeak = Boolean(activeGrant("SPEAK"));
  const canReceiveMedia = Boolean(activeGrant("RECEIVE_MEDIA"));

  const transferTargets =
    room?.participants.filter(
      (participant) =>
        participant.id !== participantId &&
        participant.kind === "human" &&
        participant.role !== "observer"
    ) ?? [];

  const peers =
    room?.participants.filter(
      (participant) =>
        participant.id !== participantId &&
        participant.kind === "human" &&
        participant.presence === "online" &&
        Boolean(activeGrant("RECEIVE_MEDIA", participant.id))
    ) ?? [];

  const peer = room?.participants.find(
    (participant) => participant.id === audio.peerId
  );

  const packetLossPercent = useMemo(() => {
    const lost = audio.diagnostics.metrics.packetsLost;
    const received = audio.diagnostics.metrics.packetsReceived;
    if (
      lost === undefined ||
      received === undefined ||
      lost + received <= 0
    ) {
      return undefined;
    }
    return ((lost / (lost + received)) * 100).toFixed(2);
  }, [
    audio.diagnostics.metrics.packetsLost,
    audio.diagnostics.metrics.packetsReceived
  ]);

  const hasTurn =
    rtcConfig?.iceServers.some((server) =>
      server.urls.some(
        (url) => url.startsWith("turn:") || url.startsWith("turns:")
      )
    ) ?? false;

  const agentStatus = useMemo(() => {
    const statuses = Object.values(agentStatuses).filter(
      (status) => status.participantId === "agent-vessie"
    );
    return statuses.at(-1) ?? null;
  }, [agentStatuses]);

  function leaveEpisode() {
    if (audio.state !== "idle") audio.hangup();
    disconnect();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">COMMONLINE · P0-h MEDIA SESSION + PERFECT NEGOTIATION</div>
          <h1>{room?.purpose ?? "Make each call an exact ephemeral object"}</h1>
        </div>
        <div className="status-row">
          <Badge>{connection.toUpperCase()}</Badge>
          <Badge>IDENTITY {identityState.toUpperCase()}</Badge>
          <Badge>AUDIO {audio.state.toUpperCase()}</Badge>
          <Badge>ROUTE {audio.diagnostics.metrics.route.toUpperCase()}</Badge>
          {audio.callSession && (
            <Badge>CALL g{audio.callSession.generation}</Badge>
          )}
          {room && <Badge>{room.schemaVersion}</Badge>}
          {room && <Badge>ROOM v{room.version}</Badge>}
        </div>
      </header>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Cryptographic participant identity</SectionTitle>
          <p className="muted">
            Commonline now proves possession of a local P-256 private key before this session
            may claim your participant ID. The private key stays in browser IndexedDB.
          </p>
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={connection !== "disconnected"}
            aria-label="Display name"
          />
          <select
            className="text-input"
            value={requestedRole}
            onChange={(event) =>
              setRequestedRole(
                event.target.value === "observer" ? "observer" : "participant"
              )
            }
            disabled={connection !== "disconnected"}
            aria-label="Requested room role"
          >
            <option value="participant">Participant</option>
            <option value="observer">Observer (read-only)</option>
          </select>
          <div className="button-row">
            {connection === "disconnected" ? (
              <Button onClick={connect} disabled={!name.trim()}>
                Authenticate + join
              </Button>
            ) : (
              <Button onClick={leaveEpisode} disabled={connection === "connecting"}>
                Leave episode
              </Button>
            )}
          </div>
          {notice && <p className="notice">{notice}</p>}
          <div className="muted small">Participant: {participantId}</div>
          <div className="muted small">Session: {sessionId}</div>
        </Card>

        <Card>
          <SectionTitle>Recovery</SectionTitle>
          {recoveryCode ? (
            <div className="delta">
              <strong>Save this recovery code now</strong>
              <p className="muted small">
                Commonline stores only its hash. This code is shown after enrollment or
                recovery rotation and cannot be reconstructed by the server.
              </p>
              <code>{recoveryCode}</code>
              <div className="button-row" style={{ marginTop: 12 }}>
                <Button onClick={clearRecoveryCode}>I saved it</Button>
              </div>
            </div>
          ) : (
            <p className="muted">
              If this browser loses its private key, use your participant ID and recovery code
              to rotate to a new key without becoming a new logical person.
            </p>
          )}
          <input
            className="text-input"
            value={recoverParticipantId}
            onChange={(event) => setRecoverParticipantId(event.target.value)}
            placeholder="participant id"
            aria-label="Recovery participant ID"
            disabled={connection === "connected"}
          />
          <input
            className="text-input"
            value={recoverCodeInput}
            onChange={(event) => setRecoverCodeInput(event.target.value)}
            placeholder="recovery code"
            aria-label="Recovery code"
            type="password"
            disabled={connection === "connected"}
          />
          <Button
            onClick={() => {
              void recoverIdentity(recoverParticipantId, recoverCodeInput);
              setRecoverCodeInput("");
            }}
            disabled={
              connection === "connected" ||
              !recoverParticipantId.trim() ||
              !recoverCodeInput.trim()
            }
          >
            Recover identity + rotate key
          </Button>
          <p className="muted small">
            P0-f enrollment is trust-on-first-use. Remote recovery must use localhost or WSS;
            a recovery secret should never cross plain internet WebSocket transport.
          </p>
        </Card>
      </section>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Identity ≠ authority</SectionTitle>
          <div className="grant-grid">
            <Badge>IDENTITY PROVED {identityState === "authenticated" ? "✓" : "✕"}</Badge>
            <Badge>READ ROOM {activeGrant("READ_ROOM_STATE") ? "✓" : "✕"}</Badge>
            <Badge>SUBMIT {activeGrant("SUBMIT_WORK") ? "✓" : "✕"}</Badge>
            <Badge>SPEAK {canSpeak ? "✓" : "✕"}</Badge>
            <Badge>ACCEPT {canAccept ? "✓" : "✕"}</Badge>
          </div>
          {me && (
            <p className="muted small">
              Role: <strong>{me.role}</strong>. Authentication establishes who you are.
              Grant receipts establish what you may do.
            </p>
          )}
          {acceptGrant && (
            <div className="muted small">Active ACCEPT grant: {acceptGrant.grantId}</div>
          )}
        </Card>

        <Card>
          <SectionTitle>Transfer ACCEPT_OUTCOME authority</SectionTitle>
          {!canAccept ? (
            <p className="muted">
              This participant does not hold the active ACCEPT_OUTCOME grant.
            </p>
          ) : transferTargets.length === 0 ? (
            <p className="muted">
              Another non-observer human participant must exist before authority can be handed off.
            </p>
          ) : (
            <div className="participant-list">
              {transferTargets.map((participant) => (
                <div className="call-peer" key={participant.id}>
                  <div>
                    <strong>{participant.name}</strong>
                    <div className="muted small">
                      {participant.role} · {participant.presence}
                    </div>
                  </div>
                  <Button
                    onClick={() => transferAcceptAuthority(participant.id)}
                    disabled={connection !== "connected"}
                  >
                    Transfer authority
                  </Button>
                </div>
              ))}
            </div>
          )}
          {lastAuthorityTransfer && (
            <div className="delta">
              <strong>Latest authority-transfer receipt</strong>
              <p>
                {lastAuthorityTransfer.fromParticipantId} →{" "}
                {lastAuthorityTransfer.toParticipantId}
              </p>
              <div className="muted small">
                revoked {lastAuthorityTransfer.revokedGrantId}
                <br />
                issued {lastAuthorityTransfer.issuedGrantId}
                <br />
                room v{lastAuthorityTransfer.committedVersion}
              </div>
            </div>
          )}
        </Card>
      </section>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Live audio</SectionTitle>
          {audio.incomingOffer ? (
            <div className="call-panel">
              <strong>
                Incoming audio call from {peer?.name ?? "another room participant"}
              </strong>
              <p className="muted small">
                Your microphone is not opened until you choose Answer.
              </p>
              <div className="button-row">
                <Button onClick={audio.answerCall} disabled={!audio.rtcReady}>
                  Answer
                </Button>
                <Button onClick={audio.declineCall}>Decline</Button>
              </div>
            </div>
          ) : audio.state === "idle" ? (
            peers.length === 0 ? (
              <p className="muted">No media-authorized human peer is online.</p>
            ) : (
              <div className="call-list">
                {peers.map((participant) => (
                  <div className="call-peer" key={participant.id}>
                    <div>
                      <strong>{participant.name}</strong>
                      <div className="muted small">{participant.role}</div>
                    </div>
                    <Button
                      onClick={() => audio.startCall(participant.id)}
                      disabled={
                        !canSpeak ||
                        !canReceiveMedia ||
                        !audio.rtcReady
                      }
                    >
                      Call
                    </Button>
                  </div>
                ))}
              </div>
            )
          ) : (
            <div className="call-panel">
              <strong>
                {audio.state === "connected" ? "Connected with" : "Connecting to"}{" "}
                {peer?.name ?? "peer"}
              </strong>
              <div className="button-row">
                <Button onClick={audio.toggleMute}>
                  {audio.muted ? "Unmute" : "Mute"}
                </Button>
                <Button onClick={audio.hangup}>End call</Button>
              </div>
            </div>
          )}
          {!audio.rtcReady && connection === "connected" && (
            <p className="notice">
              Waiting for usable ICE configuration from the authenticated room service.
            </p>
          )}
          {audio.error && <p className="notice">{audio.error}</p>}
          <audio ref={remoteAudioRef} autoPlay playsInline controls className="remote-audio">
            Remote audio playback is not supported by this browser.
          </audio>
        </Card>

        <Card>
          <SectionTitle>Participants</SectionTitle>
          {!room ? (
            <p className="muted">Authenticate and join to receive room state.</p>
          ) : (
            <div className="participant-list">
              {room.participants.map((participant) => (
                <div
                  className={participant.kind === "agent" ? "participant agent" : "participant"}
                  key={participant.id}
                >
                  <span
                    className={
                      participant.presence === "online"
                        ? "presence-dot"
                        : "presence-dot offline"
                    }
                  />
                  <div>
                    <strong>
                      {participant.name}
                      {participant.id === participantId ? " (you)" : ""}
                    </strong>
                    <div className="muted small">
                      {participant.kind} · {participant.role} · {participant.presence}
                    </div>
                    {participant.id === "agent-vessie" && (
                      <div className="muted small">
                        status: {agentStatus?.state ?? "idle"} · no live media grant
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Call path diagnostics</SectionTitle>
          <div className="grant-grid">
            <Badge>NETWORK {audio.diagnostics.networkOnline ? "ONLINE" : "OFFLINE"}</Badge>
            <Badge>CONTEXT {audio.diagnostics.mediaContext.toUpperCase()}</Badge>
            <Badge>ICE {audio.diagnostics.iceConnectionState.toUpperCase()}</Badge>
            <Badge>PEER {audio.diagnostics.connectionState.toUpperCase()}</Badge>
            <Badge>ROUTE {audio.diagnostics.metrics.route.toUpperCase()}</Badge>
            <Badge>POLICY {audio.diagnostics.iceTransportPolicy.toUpperCase()}</Badge>
          </div>

          {audio.callSession && (
            <div className="delta">
              <strong>Ephemeral media session</strong>
              <p>{audio.callSession.callId}</p>
              <div className="muted small">
                generation {audio.callSession.generation}
                {" · "}
                {audio.callSession.polite ? "polite peer" : "impolite peer"}
                <br />
                peer {audio.callSession.peerParticipantId}
              </div>
            </div>
          )}

          <div className="delta">
            <strong>Selected path</strong>
            <p>
              {audio.diagnostics.metrics.localCandidateType} →{" "}
              {audio.diagnostics.metrics.remoteCandidateType}
            </p>
            <div className="muted small">
              transport {audio.diagnostics.metrics.protocol ?? "unknown"}
              {audio.diagnostics.metrics.relayProtocol
                ? ` · relay ${audio.diagnostics.metrics.relayProtocol}`
                : ""}
              <br />
              RTT{" "}
              {audio.diagnostics.metrics.currentRoundTripTimeMs === undefined
                ? "—"
                : `${audio.diagnostics.metrics.currentRoundTripTimeMs} ms`}
              {" · "}jitter{" "}
              {audio.diagnostics.metrics.jitterMs === undefined
                ? "—"
                : `${audio.diagnostics.metrics.jitterMs} ms`}
              {" · "}packet loss{" "}
              {packetLossPercent === undefined ? "—" : `${packetLossPercent}%`}
            </div>
          </div>

          {audio.diagnostics.lastIceError && (
            <p className="notice">
              ICE diagnostic: {audio.diagnostics.lastIceError}
            </p>
          )}
          {audio.diagnostics.failureReason && (
            <p className="notice">
              Last call failure: {audio.diagnostics.failureReason}
            </p>
          )}
          <p className="muted small">
            Diagnostics are local runtime observations. They are not room events and are not
            written to SQLite.
          </p>
        </Card>

        <Card>
          <SectionTitle>ICE / TURN boundary</SectionTitle>
          {!rtcConfig ? (
            <p className="muted">ICE configuration has not arrived yet.</p>
          ) : (
            <>
              <div className="grant-grid">
                <Badge>STUN/TURN SERVERS {rtcConfig.iceServers.length}</Badge>
                <Badge>TURN {hasTurn ? "CONFIGURED" : "ABSENT"}</Badge>
                <Badge>CREDENTIALS {rtcConfig.credentialMode.toUpperCase()}</Badge>
                <Badge>ICE POLICY {rtcConfig.iceTransportPolicy.toUpperCase()}</Badge>
              </div>
              <p className="muted small">
                TURN relays media connectivity only. It is not a room participant, receives
                no Commonline grants, and does not become durable room history.
              </p>
              {rtcConfig.expiresAt && (
                <div className="muted small">
                  Ephemeral TURN credential expiry: {rtcConfig.expiresAt}
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      <section className="work-grid">
        <Card>
          <SectionTitle>Bounded silent work</SectionTitle>
          <textarea
            value={taskText}
            onChange={(event) => setTaskText(event.target.value)}
            rows={6}
            aria-label="Agent task"
          />
          <Button
            onClick={() => submitWork(taskText)}
            disabled={
              connection !== "connected" ||
              identityState !== "authenticated" ||
              !taskText.trim() ||
              !activeGrant("SUBMIT_WORK")
            }
          >
            Send governed task
          </Button>
          <div className="timeline">
            {room?.workItems
              .slice()
              .reverse()
              .map((item) => (
                <div className="timeline-item" key={item.id}>
                  <strong>{item.status.toUpperCase()}</strong>
                  <span>{item.prompt}</span>
                  <span className="muted small">{item.id}</span>
                </div>
              ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Proposal inbox</SectionTitle>
          {!room || room.artifacts.length === 0 ? (
            <p className="muted">No room-visible proposals yet.</p>
          ) : (
            room.artifacts
              .slice()
              .reverse()
              .map((artifact) => {
                const acceptance = room.acceptances.find(
                  (receipt) => receipt.artifactId === artifact.id
                );
                return (
                  <article className="artifact" key={artifact.id}>
                    <div className="artifact-head">
                      <strong>{artifact.title}</strong>
                      <Badge>{artifact.status}</Badge>
                    </div>
                    <p>{artifact.body}</p>
                    <div className="muted small">
                      Produced by {artifact.producedBy} · work {artifact.sourceWorkId}
                    </div>
                    {artifact.status === "proposed" && (
                      <Button
                        onClick={() =>
                          acceptOutcome(artifact.sourceWorkId, artifact.id)
                        }
                        disabled={!canAccept || connection !== "connected"}
                      >
                        {canAccept
                          ? "Accept outcome with receipt"
                          : "ACCEPT_OUTCOME grant required"}
                      </Button>
                    )}
                    {acceptance && (
                      <div className="muted small">
                        receipt {acceptance.receiptId} · grant {acceptance.authorityGrantId}
                      </div>
                    )}
                  </article>
                );
              })
          )}
        </Card>
      </section>

      <section className="work-grid">
        <Card>
          <SectionTitle>Durable authority history</SectionTitle>
          {!room || room.authorityTransfers.length === 0 ? (
            <p className="muted">No ACCEPT_OUTCOME handoff has occurred yet.</p>
          ) : (
            <ul>
              {room.authorityTransfers.map((receipt) => (
                <li key={receipt.transferReceiptId}>
                  {receipt.fromParticipantId} → {receipt.toParticipantId} at room v
                  {receipt.committedVersion}
                </li>
              ))}
            </ul>
          )}
          {lastAcceptance && (
            <div className="delta">
              <strong>Latest acceptance</strong>
              <p>{lastAcceptance.receiptId}</p>
              <div className="muted small">
                authority grant {lastAcceptance.authorityGrantId}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Resume delta</SectionTitle>
          {resumeDelta.length === 0 ? (
            <p className="muted">No missed durable events since this session last acknowledged state.</p>
          ) : (
            <ul>
              {resumeDelta.map((event) => (
                <li key={event.id}>
                  v{event.version}: {event.summary}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            Authentication challenges, private keys, recovery secrets, sessions, scratch,
            WebRTC signaling, and audio are not room-event history.
          </p>
        </Card>
      </section>

      <footer>
        P0-h makes each one-to-one call an exact ephemeral media session with a call ID,
        generation, deterministic polite/impolite roles, perfect-negotiation glare handling,
        and stale-signal rejection. Media sessions remain outside durable room history.
      </footer>
    </main>
  );
}
