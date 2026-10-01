import { useEffect, useMemo, useRef, useState } from "react";
import type { Capability } from "@commonline/protocol";
import { Badge, Button, Card, SectionTitle } from "@commonline/ui";
import { useCommonlineRoom } from "./useCommonlineRoom";
import { useListeningShareCapture } from "./useListeningShareCapture";
import { useSfuGroupAudio } from "./useSfuGroupAudio";
import { usePeerAudio } from "./usePeerAudio";
import { buildResumptionBrief } from "./resumptionBrief";

function GroupRemoteAudio({
  stream,
  label
}: {
  stream: MediaStream;
  label: string;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = stream;
    void ref.current.play().catch(() => {
      // Browser autoplay policy may require a participant gesture.
    });
  }, [stream]);

  return (
    <div className="delta">
      <strong>{label}</strong>
      <audio ref={ref} autoPlay playsInline controls className="remote-audio">
        Remote group audio playback is not supported by this browser.
      </audio>
    </div>
  );
}

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
    lastVoiceAuthorityBootstrap,
    lastAgentVoiceGrant,
    lastAgentVoiceRevocation,
    lastAgentVoiceUtteranceStatus,
    attentionLease,
    lastAgentTurnStatus,
    listeningShareLease,
    lastListeningShareStatus,
    lastListeningShareResult,
    lastExchangeResponseStatus,
    agentStatuses,
    rtcInbox,
    rtcSessionInbox,
    groupMediaState,
    rtcConfig,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptOutcome,
    transferAcceptAuthority,
    bootstrapAgentVoiceAuthority,
    grantAgentVoice,
    revokeAgentVoice,
    grantListeningShare,
    revokeListeningShare,
    submitListeningShare,
    requestExchangeResponse,
    grantAttentionLease,
    revokeAttentionLease,
    requestAgentTurn,
    requestAgentVoiceUtterance,
    openRtcCall,
    sendRtcSignal,
    joinGroupMedia,
    leaveGroupMedia,
    publishGroupSource,
    unpublishGroupSource,
    subscribeGroupSource,
    unsubscribeGroupSource,
    requestSfu,
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

  const group = useSfuGroupAudio({
    participantId,
    roomConnected: connection === "connected",
    groupState: groupMediaState,
    requestSfu,
    joinGroup: joinGroupMedia,
    leaveGroup: leaveGroupMedia,
    publishSource: publishGroupSource,
    unpublishSource: unpublishGroupSource,
    subscribeSource: subscribeGroupSource,
    unsubscribeSource: unsubscribeGroupSource
  });

  const listeningCapture = useListeningShareCapture({
    lease: listeningShareLease,
    agentParticipantId: "agent-vessie",
    submit: submitListeningShare
  });

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [taskText, setTaskText] = useState(
    "Compare two approaches and return the trade-offs as a compact artifact."
  );
  const [agentTurnPrompt, setAgentTurnPrompt] = useState(
    "Give me one bounded response confirming the attention lease was consumed."
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
  const voiceManagerGrant = activeGrant("MANAGE_AGENT_VOICE");
  const canManageAgentVoice = Boolean(voiceManagerGrant);
  const canSpeak = Boolean(activeGrant("SPEAK"));
  const canReceiveMedia = Boolean(activeGrant("RECEIVE_MEDIA"));

  const activeVessieVoiceGrant = room?.agentVoiceGrants.find(
    (grant) =>
      grant.agentParticipantId === "agent-vessie" &&
      !room.agentVoiceRevocations.some(
        (revocation) => revocation.voiceGrantId === grant.voiceGrantId
      ) &&
      (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now())
  );

  const activeVessieVoiceSource = groupMediaState?.sources.find(
    (source) =>
      source.ownerParticipantId === "agent-vessie" &&
      source.kind === "agent-voice"
  );

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

  const resumptionBrief = useMemo(
    () => (room ? buildResumptionBrief(room, resumeDelta) : null),
    [room, resumeDelta]
  );

  function leaveEpisode() {
    if (audio.state !== "idle") audio.hangup();
    if (group.joined) group.leave();
    disconnect();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">COMMONLINE · P0-t END-TO-END EXPERIENCE PROOF</div>
          <h1>{room?.purpose ?? "Let Vessie hear one bounded clip and reply only after a separate attention grant"}</h1>
        </div>
        <div className="status-row">
          <Badge>{connection.toUpperCase()}</Badge>
          <Badge>IDENTITY {identityState.toUpperCase()}</Badge>
          <Badge>AUDIO {audio.state.toUpperCase()}</Badge>
          <Badge>ROUTE {audio.diagnostics.metrics.route.toUpperCase()}</Badge>
          {audio.callSession && (
            <Badge>CALL g{audio.callSession.generation}</Badge>
          )}
          {group.joined && (
            <Badge>GROUP {group.routerMode?.toUpperCase() ?? "MEDIA"}</Badge>
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
              <Button
                data-testid="authenticate-join"
                onClick={connect}
                disabled={!name.trim()}
              >
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
            <Badge>MANAGE AGENT VOICE {canManageAgentVoice ? "✓" : "✕"}</Badge>
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
          <SectionTitle>Agent voice authority</SectionTitle>
          {!room ? (
            <p className="muted">Join the room to inspect agent voice authority.</p>
          ) : room.voiceAuthorityBootstraps.length === 0 ? (
            <>
              <p className="muted">
                No participant can grant agent voice yet. P0-m requires one explicit,
                durable bootstrap from the current ACCEPT_OUTCOME holder before
                MANAGE_AGENT_VOICE exists.
              </p>
              <Button
                data-testid="bootstrap-voice-authority"
                onClick={() => {
                  if (acceptGrant) {
                    bootstrapAgentVoiceAuthority(acceptGrant.grantId);
                  }
                }}
                disabled={!acceptGrant || connection !== "connected"}
              >
                Bootstrap voice authority
              </Button>
            </>
          ) : !canManageAgentVoice ? (
            <p className="muted">
              Voice management was already bootstrapped to another authority holder.
              Identity and ordinary SPEAK do not imply permission to manage agent voice.
            </p>
          ) : activeVessieVoiceGrant ? (
            <>
              <div className="delta">
                <strong>Vessie voice grant active</strong>
                <p>
                  voice <code>{activeVessieVoiceGrant.voiceId}</code>
                </p>
                <div className="muted small">
                  grant {activeVessieVoiceGrant.voiceGrantId}
                  <br />
                  audience {activeVessieVoiceGrant.audienceMode}
                  <br />
                  room v{activeVessieVoiceGrant.committedVersion}
                </div>
              </div>
              <div className="button-row">
                <Button
                  data-testid="request-vessie-voice"
                  onClick={() => {
                    if (voiceManagerGrant) {
                      requestAgentVoiceUtterance(
                        "agent-vessie",
                        activeVessieVoiceGrant.voiceGrantId,
                        voiceManagerGrant.grantId
                      );
                    }
                  }}
                  disabled={
                    !voiceManagerGrant ||
                    connection !== "connected" ||
                    !group.joined ||
                    !activeVessieVoiceSource ||
                    lastAgentVoiceUtteranceStatus?.state === "rendering" ||
                    lastAgentVoiceUtteranceStatus?.state === "speaking"
                  }
                >
                  Ask Vessie to speak proof
                </Button>
                <Button
                  data-testid="revoke-vessie-voice"
                  onClick={() => {
                    if (voiceManagerGrant) {
                      revokeAgentVoice(
                        activeVessieVoiceGrant.voiceGrantId,
                        voiceManagerGrant.grantId
                      );
                    }
                  }}
                  disabled={!voiceManagerGrant || connection !== "connected"}
                >
                  Revoke Vessie voice
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                You hold MANAGE_AGENT_VOICE, but Vessie has no active voice grant.
                Granting the voice binds one stable voice ID and explicit-subscription
                audience policy. It still does not activate a TTS renderer.
              </p>
              <Button
                data-testid="grant-vessie-voice"
                onClick={() => {
                  if (voiceManagerGrant) {
                    grantAgentVoice(
                      "agent-vessie",
                      "vessie-local-v1",
                      voiceManagerGrant.grantId
                    );
                  }
                }}
                disabled={!voiceManagerGrant || connection !== "connected"}
              >
                Grant Vessie local voice
              </Button>
            </>
          )}

          {lastVoiceAuthorityBootstrap && (
            <div className="delta">
              <strong>Voice authority bootstrap receipt</strong>
              <div className="muted small">
                issued {lastVoiceAuthorityBootstrap.issuedGrantId}
                <br />
                from ACCEPT {lastVoiceAuthorityBootstrap.acceptAuthorityGrantId}
                <br />
                room v{lastVoiceAuthorityBootstrap.committedVersion}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Voice renderer boundary</SectionTitle>
          <div className="grant-grid">
            <Badge>VESSIE PARTICIPANT ✓</Badge>
            <Badge>
              VOICE GRANT {activeVessieVoiceGrant ? "✓" : "✕"}
            </Badge>
            <Badge>LOCAL RENDERER ADAPTER ✓</Badge>
            <Badge>
              AGENT SOURCE {activeVessieVoiceSource ? "✓" : "✕"}
            </Badge>
            <Badge>
              UTTERANCE {lastAgentVoiceUtteranceStatus?.state?.toUpperCase() ?? "IDLE"}
            </Badge>
          </div>
          <p className="muted">
            P0-n can render Vessie's bounded proof through the configured local
            renderer. The server checks the active voice grant again before rendering,
            publishes an agent-owned source through mediasoup DirectTransport, and still
            requires each listener to subscribe explicitly.
          </p>
          {activeVessieVoiceGrant && !group.joined && (
            <p className="notice">
              Join group media before requesting live agent speech.
            </p>
          )}
          {activeVessieVoiceGrant && group.joined && !activeVessieVoiceSource && (
            <p className="notice">
              The voice grant is valid, but no local renderer-backed agent source is
              available. Check the server renderer configuration.
            </p>
          )}
          {lastAgentVoiceUtteranceStatus && (
            <div
              className="delta"
              data-testid="agent-voice-utterance-status"
              data-utterance-state={lastAgentVoiceUtteranceStatus.state}
            >
              <strong>Latest Vessie utterance</strong>
              <div className="muted small">
                {lastAgentVoiceUtteranceStatus.state}
                <br />
                voice {lastAgentVoiceUtteranceStatus.voiceId}
                {lastAgentVoiceUtteranceStatus.sourceId && (
                  <>
                    <br />
                    source {lastAgentVoiceUtteranceStatus.sourceId}
                  </>
                )}
              </div>
            </div>
          )}
          {lastAgentVoiceGrant && (
            <div className="delta">
              <strong>Latest agent-voice grant receipt</strong>
              <div className="muted small">
                {lastAgentVoiceGrant.agentParticipantId}
                <br />
                voice {lastAgentVoiceGrant.voiceId}
                <br />
                grant {lastAgentVoiceGrant.voiceGrantId}
              </div>
            </div>
          )}
          {lastAgentVoiceRevocation && (
            <div className="delta">
              <strong>Latest voice revocation receipt</strong>
              <div className="muted small">
                revoked {lastAgentVoiceRevocation.voiceGrantId}
                <br />
                receipt {lastAgentVoiceRevocation.voiceRevocationId}
                <br />
                room v{lastAgentVoiceRevocation.committedVersion}
              </div>
            </div>
          )}
        </Card>
      </section>

      <section className="hero-grid">
        <Card>
          <SectionTitle>One-turn attention lease</SectionTitle>
          <p className="muted">
            P0-o separates voice authority from permission to take the floor.
            A lease is ephemeral, belongs to the human who granted it, expires,
            and can be consumed exactly once.
          </p>

          {!group.joined || !activeVessieVoiceGrant || !activeVessieVoiceSource ? (
            <p className="notice">
              Join group media and activate Vessie's governed voice before granting attention.
            </p>
          ) : attentionLease?.state === "active" ? (
            <>
              <div
                className="delta"
                data-testid="attention-lease-state"
                data-attention-state={attentionLease.state}
                data-attention-lease-id={attentionLease.leaseId}
              >
                <strong>Attention lease active</strong>
                <div className="muted small">
                  mode {attentionLease.mode}
                  <br />
                  turns {attentionLease.turnsConsumed}/{attentionLease.maxTurns}
                  <br />
                  expires {attentionLease.expiresAt}
                </div>
              </div>

              <textarea
                className="text-input"
                aria-label="Directed agent turn prompt"
                data-testid="agent-turn-prompt"
                value={agentTurnPrompt}
                maxLength={240}
                onChange={(event) => setAgentTurnPrompt(event.target.value)}
              />

              <div className="button-row">
                <Button
                  data-testid="request-agent-turn"
                  onClick={() =>
                    requestAgentTurn(
                      "agent-vessie",
                      attentionLease.leaseId,
                      agentTurnPrompt
                    )
                  }
                  disabled={
                    !agentTurnPrompt.trim() ||
                    lastAgentTurnStatus?.state === "thinking" ||
                    lastAgentTurnStatus?.state === "rendering" ||
                    lastAgentTurnStatus?.state === "speaking"
                  }
                >
                  Give Vessie this one turn
                </Button>
                <Button
                  data-testid="revoke-attention-lease"
                  onClick={() => revokeAttentionLease(attentionLease.leaseId)}
                >
                  Revoke attention lease
                </Button>
              </div>
            </>
          ) : (
            <>
              {attentionLease && (
                <div
                  className="delta"
                  data-testid="attention-lease-state"
                  data-attention-state={attentionLease.state}
                  data-attention-lease-id={attentionLease.leaseId}
                >
                  <strong>Previous lease {attentionLease.state}</strong>
                  <div className="muted small">
                    turns {attentionLease.turnsConsumed}/{attentionLease.maxTurns}
                  </div>
                </div>
              )}
              <Button
                data-testid="grant-attention-lease"
                onClick={() => grantAttentionLease("agent-vessie")}
                disabled={
                  !group.joined ||
                  !activeVessieVoiceGrant ||
                  !activeVessieVoiceSource
                }
              >
                Grant Vessie one turn
              </Button>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle>Agent turn state</SectionTitle>
          <div className="grant-grid">
            <Badge>VOICE GRANT {activeVessieVoiceGrant ? "✓" : "✕"}</Badge>
            <Badge>
              ATTENTION {attentionLease?.state?.toUpperCase() ?? "NONE"}
            </Badge>
            <Badge>
              TURN {lastAgentTurnStatus?.state?.toUpperCase() ?? "IDLE"}
            </Badge>
          </div>
          <p className="muted">
            The directed prompt is ephemeral in P0-o. Commonline broadcasts only
            content-free turn status; it does not add the prompt or reply text to
            durable room history.
          </p>
          {lastAgentTurnStatus && (
            <div
              className="delta"
              data-testid="agent-turn-status"
              data-turn-state={lastAgentTurnStatus.state}
              data-attention-lease-id={lastAgentTurnStatus.attentionLeaseId}
            >
              <strong>Latest directed turn</strong>
              <div className="muted small">
                {lastAgentTurnStatus.state}
                <br />
                request {lastAgentTurnStatus.turnRequestId}
                <br />
                lease {lastAgentTurnStatus.attentionLeaseId}
                {lastAgentTurnStatus.sourceId && (
                  <>
                    <br />
                    source {lastAgentTurnStatus.sourceId}
                  </>
                )}
              </div>
            </div>
          )}
          <div className="delta">
            <strong>CAN SPEAK ≠ MAY TAKE THE FLOOR</strong>
            <p className="muted small">
              The durable voice grant authorizes Vessie's voice identity. The
              ephemeral attention lease authorizes one human-requested turn.
            </p>
          </div>
        </Card>
      </section>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Push-to-share listening</SectionTitle>
          <p className="muted">
            P0-p does not subscribe Vessie to your microphone. You explicitly grant
            one short listening share, capture at most five seconds, and send that
            bounded PCM segment to a local recognizer as selected context.
          </p>

          {!group.joined ? (
            <p className="notice">
              Join group media before sharing a bounded microphone segment with Vessie.
            </p>
          ) : listeningShareLease?.state === "active" ? (
            <>
              <div
                className="delta"
                data-testid="listening-lease-state"
                data-listening-state={listeningShareLease.state}
                data-listening-lease-id={listeningShareLease.leaseId}
              >
                <strong>Listening share armed</strong>
                <div className="muted small">
                  target {listeningShareLease.agentParticipantId}
                  <br />
                  max {listeningShareLease.maxDurationMs} ms
                  <br />
                  expires {listeningShareLease.expiresAt}
                </div>
              </div>

              <div className="grant-grid">
                <Badge>
                  CAPTURE {listeningCapture.state.toUpperCase()}
                </Badge>
                <Badge>
                  {Math.min(
                    listeningCapture.elapsedMs,
                    listeningShareLease.maxDurationMs
                  )} ms
                </Badge>
              </div>

              <div className="button-row">
                {!listeningCapture.capturing ? (
                  <Button
                    data-testid="start-listening-share"
                    onClick={() => void listeningCapture.start()}
                    disabled={
                      listeningCapture.state === "encoding" ||
                      listeningCapture.state === "submitted"
                    }
                  >
                    Start bounded share
                  </Button>
                ) : (
                  <Button
                    data-testid="stop-listening-share"
                    onClick={() => void listeningCapture.stopAndSubmit()}
                  >
                    Stop + share with Vessie
                  </Button>
                )}
                <Button
                  data-testid="revoke-listening-share"
                  onClick={() => {
                    void listeningCapture.cancel();
                    revokeListeningShare(listeningShareLease.leaseId);
                  }}
                  disabled={listeningCapture.state === "encoding"}
                >
                  Revoke listening share
                </Button>
              </div>

              {listeningCapture.error && (
                <p className="notice">{listeningCapture.error}</p>
              )}
            </>
          ) : (
            <>
              {listeningShareLease && (
                <div
                  className="delta"
                  data-testid="listening-lease-state"
                  data-listening-state={listeningShareLease.state}
                  data-listening-lease-id={listeningShareLease.leaseId}
                >
                  <strong>
                    Previous listening share {listeningShareLease.state}
                  </strong>
                </div>
              )}
              <Button
                data-testid="grant-listening-share"
                onClick={() => grantListeningShare("agent-vessie")}
                disabled={!group.joined || connection !== "connected"}
              >
                Let Vessie hear one short clip
              </Button>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle>Listening transparency</SectionTitle>
          <div className="grant-grid">
            <Badge>AMBIENT LISTENING ✕</Badge>
            <Badge>AGENT SFU CONSUMER ✕</Badge>
            <Badge>
              SHARE {lastListeningShareStatus?.state?.toUpperCase() ?? "IDLE"}
            </Badge>
          </div>
          <p className="muted">
            Share status is visible without broadcasting transcript content. The
            transcript result is returned only to the human who submitted the clip,
            and neither audio nor transcript is added to durable room history.
          </p>

          {lastListeningShareStatus && (
            <div
              className="delta"
              data-testid="listening-share-status"
              data-listening-status={lastListeningShareStatus.state}
            >
              <strong>Bounded listening activity</strong>
              <div className="muted small">
                {lastListeningShareStatus.state}
                <br />
                human {lastListeningShareStatus.humanParticipantId}
                <br />
                target {lastListeningShareStatus.agentParticipantId}
                <br />
                share {lastListeningShareStatus.shareId}
              </div>
            </div>
          )}

          {lastListeningShareResult && (
            <div
              className="delta"
              data-testid="listening-share-result"
              data-stt-engine={lastListeningShareResult.engine}
              data-sample-count={lastListeningShareResult.sampleCount}
              data-duration-ms={lastListeningShareResult.durationMs}
              data-exchange-id={lastListeningShareResult.exchange.exchangeId}
              data-exchange-state={lastListeningShareResult.exchange.state}
            >
              <strong>Ephemeral transcript returned to you</strong>
              <p>{lastListeningShareResult.transcript}</p>
              <div className="muted small">
                engine {lastListeningShareResult.engine}
                <br />
                {lastListeningShareResult.sampleCount} samples ·{" "}
                {lastListeningShareResult.durationMs} ms
                <br />
                exchange {lastListeningShareResult.exchange.exchangeId}
                <br />
                reply state {lastListeningShareResult.exchange.state}
              </div>
            </div>
          )}

          <div className="delta">
            <strong>AGENT PARTICIPANT ≠ AGENT MAY LISTEN</strong>
            <p className="muted small">
              Vessie receives only the transcript derived from the explicitly shared
              clip. She is never added as a microphone subscriber in this rung.
            </p>
          </div>
        </Card>
      </section>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Heard exchange ≠ reply authority</SectionTitle>
          <p className="muted">
            P0-q binds one heard listening share to one possible reply, but hearing
            does not authorize speech. The same human must separately grant a fresh
            one-turn attention lease before Vessie may answer that exact exchange.
          </p>

          {!lastListeningShareResult ? (
            <p className="notice">
              Share one bounded clip with Vessie to create an ephemeral heard exchange.
            </p>
          ) : (
            <>
              <div
                className="delta"
                data-testid="conversation-exchange"
                data-exchange-id={lastListeningShareResult.exchange.exchangeId}
                data-exchange-state={lastListeningShareResult.exchange.state}
              >
                <strong>
                  Exchange {lastListeningShareResult.exchange.state}
                </strong>
                <div className="muted small">
                  {lastListeningShareResult.exchange.exchangeId}
                  <br />
                  from share {lastListeningShareResult.exchange.listeningShareId}
                  <br />
                  expires {lastListeningShareResult.exchange.expiresAt}
                </div>
              </div>

              {lastListeningShareResult.exchange.state === "heard" &&
              attentionLease?.state !== "active" ? (
                <Button
                  data-testid="grant-exchange-attention"
                  onClick={() => grantAttentionLease("agent-vessie")}
                  disabled={
                    !group.joined ||
                    !activeVessieVoiceGrant ||
                    !activeVessieVoiceSource
                  }
                >
                  Grant one reply turn
                </Button>
              ) : lastListeningShareResult.exchange.state === "heard" &&
                attentionLease?.state === "active" ? (
                <Button
                  data-testid="authorize-exchange-response"
                  onClick={() =>
                    requestExchangeResponse(
                      "agent-vessie",
                      lastListeningShareResult.exchange.exchangeId,
                      attentionLease.leaseId
                    )
                  }
                  disabled={
                    lastExchangeResponseStatus?.state === "thinking" ||
                    lastExchangeResponseStatus?.state === "rendering" ||
                    lastExchangeResponseStatus?.state === "speaking"
                  }
                >
                  Authorize reply to this heard clip
                </Button>
              ) : (
                <p className="notice">
                  This exchange cannot authorize another reply.
                </p>
              )}
            </>
          )}
        </Card>

        <Card>
          <SectionTitle>Exchange response state</SectionTitle>
          <div className="grant-grid">
            <Badge>
              HEARD {lastListeningShareResult?.exchange ? "✓" : "✕"}
            </Badge>
            <Badge>
              ATTENTION {attentionLease?.state?.toUpperCase() ?? "NONE"}
            </Badge>
            <Badge>
              RESPONSE {lastExchangeResponseStatus?.state?.toUpperCase() ?? "NONE"}
            </Badge>
          </div>

          {lastExchangeResponseStatus && (
            <div
              className="delta"
              data-testid="exchange-response-status"
              data-response-state={lastExchangeResponseStatus.state}
              data-exchange-id={lastExchangeResponseStatus.exchangeId}
              data-exchange-state={
                lastExchangeResponseStatus.exchange?.state ?? "unknown"
              }
            >
              <strong>Exchange-bound reply</strong>
              <div className="muted small">
                {lastExchangeResponseStatus.state}
                <br />
                exchange {lastExchangeResponseStatus.exchangeId}
                <br />
                attention {lastExchangeResponseStatus.attentionLeaseId}
                {lastExchangeResponseStatus.sourceId && (
                  <>
                    <br />
                    source {lastExchangeResponseStatus.sourceId}
                  </>
                )}
              </div>
            </div>
          )}

          <div className="delta">
            <strong>HEARD CONTEXT ≠ AUTOMATIC RESPONSE</strong>
            <p className="muted small">
              Listening created the exchange. Voice authority supplies the mouth.
              Attention supplies one floor turn. All three must line up before RTP
              is injected.
            </p>
          </div>
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
                        !audio.rtcReady ||
                        group.joined
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
                        status: {agentStatus?.state ?? "idle"} · voice authority {" "}
                        {activeVessieVoiceGrant ? activeVessieVoiceGrant.voiceId : "none"}
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
          <SectionTitle>Three-human live acceptance surface</SectionTitle>
          {!group.joined ? (
            <>
              <p className="muted">
                P0-n keeps the packet-level acceptance surface and adds an agent-owned
                voice source when a valid voice grant meets an available local renderer.
                Humans still join explicitly and subscribe source-by-source.
              </p>
              <Button
                data-testid="join-group-media"
                onClick={group.join}
                disabled={
                  connection !== "connected" ||
                  audio.state !== "idle" ||
                  (!canSpeak && !canReceiveMedia)
                }
              >
                Join group media
              </Button>
            </>
          ) : (
            <>
              <div className="grant-grid">
                <Badge>
                  PARTICIPANTS {groupMediaState?.participants.length ?? 0}/
                  {groupMediaState?.maxParticipants ?? 3}
                </Badge>
                <Badge>
                  ROUTER {group.routerMode?.toUpperCase() ?? "UNKNOWN"}
                </Badge>
                <Badge>
                  MIC {group.microphoneSource ? (group.muted ? "MUTED" : "PUBLISHED") : "OFF"}
                </Badge>
                <Badge>
                  FX {group.soundEffectSource ? (group.soundEffectReady ? "READY" : "STARTING") : "OFF"}
                </Badge>
                <Badge>SFU {group.sfuReady ? "READY" : "LOADING"}</Badge>
                <Badge>SEND {group.sendState.toUpperCase()}</Badge>
                <Badge>RECV {group.recvState.toUpperCase()}</Badge>
                <Badge>CONSUMERS {group.consumerCount}</Badge>
              </div>

              <div className="button-row">
                {!group.microphoneSource ? (
                  <Button
                    data-testid="publish-microphone"
                    onClick={() => void group.enableMicrophone()}
                    disabled={!canSpeak || !group.sfuReady}
                  >
                    Publish microphone
                  </Button>
                ) : (
                  <>
                    <Button onClick={group.toggleMute}>
                      {group.muted ? "Unmute mic" : "Mute mic"}
                    </Button>
                    <Button onClick={group.disableMicrophone}>
                      Stop publishing mic
                    </Button>
                  </>
                )}

                {!group.soundEffectSource ? (
                  <Button
                    data-testid="publish-sound-effects"
                    onClick={() => void group.enableSoundEffects()}
                    disabled={!canSpeak || !group.sfuReady}
                  >
                    Publish sound FX
                  </Button>
                ) : (
                  <>
                    <Button
                      data-testid="trigger-sound-effect"
                      onClick={() => void group.triggerSoundEffect()}
                      disabled={!group.soundEffectReady}
                    >
                      Trigger governed cue
                    </Button>
                    <Button onClick={group.disableSoundEffects}>
                      Stop sound FX
                    </Button>
                  </>
                )}

                <Button onClick={group.leave}>Leave group media</Button>
              </div>

              {group.error && <p className="notice">{group.error}</p>}
              <p className="muted small">
                Joining publishes nothing. Each source kind is separately registered,
                policy-checked, produced, and subscribed. The demo cue is generated
                locally with Web Audio and travels through the same governed SFU path.
              </p>
            </>
          )}
        </Card>

        <Card>
          <SectionTitle>Identified sources + subscriptions</SectionTitle>
          {!group.joined || !groupMediaState ? (
            <p className="muted">Join group media to see ephemeral sources.</p>
          ) : groupMediaState.sources.length === 0 ? (
            <p className="muted">No governed media sources are published yet.</p>
          ) : (
            <div className="participant-list">
              {groupMediaState.sources.map((source) => {
                const owner = room?.participants.find(
                  (participant) => participant.id === source.ownerParticipantId
                );
                const mine = source.ownerParticipantId === participantId;
                const subscribed = groupMediaState.subscriptions.some(
                  (subscription) =>
                    subscription.subscriberParticipantId === participantId &&
                    subscription.sourceId === source.sourceId
                );

                return (
                  <div
                    className="call-peer"
                    key={source.sourceId}
                    data-acceptance-source="true"
                    data-source-id={source.sourceId}
                    data-source-kind={source.kind}
                    data-owner-id={source.ownerParticipantId}
                    data-owner-name={owner?.name ?? source.ownerParticipantId}
                  >
                    <div>
                      <strong>
                        {source.label}
                        {mine ? " (yours)" : ""}
                      </strong>
                      <div className="muted small">
                        {owner?.name ?? source.ownerParticipantId} · {source.kind}
                        <br />
                        policy {source.policyId}
                        <br />
                        {source.sourceId}
                      </div>
                    </div>
                    {!mine && (
                      <Button
                        data-acceptance-subscription="true"
                        data-source-id={source.sourceId}
                        data-source-kind={source.kind}
                        data-owner-name={owner?.name ?? source.ownerParticipantId}
                        data-subscription-state={subscribed ? "subscribed" : "unsubscribed"}
                        onClick={() =>
                          subscribed
                            ? group.unsubscribeSource(source.sourceId)
                            : group.subscribeSource(source.sourceId)
                        }
                        disabled={!canReceiveMedia}
                      >
                        {subscribed ? "Unsubscribe" : "Subscribe"}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </section>

      {group.joined && group.sourcePolicies.length > 0 && (
        <section className="hero-grid">
          <Card>
            <SectionTitle>Media source policy catalog</SectionTitle>
            <div className="participant-list">
              {group.sourcePolicies.map((policy) => (
                <div className="call-peer" key={policy.policyId}>
                  <div>
                    <strong>{policy.kind}</strong>
                    <div className="muted small">
                      {policy.executionState} · requires {policy.requiredAuthority}
                      <br />
                      publishers: {policy.allowedPublisherKinds.join(", ")}
                      <br />
                      audience: {policy.audienceMode} · retention: {policy.retention}
                      <br />
                      recording default: {policy.recordingDefault}
                    </div>
                  </div>
                  <Badge>{policy.executionState.toUpperCase()}</Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <SectionTitle>Source law</SectionTitle>
            <div className="delta">
              <strong>Presence is not a source.</strong>
              <p className="muted small">
                Joining group media creates no microphone, effect, music bed,
                agent voice, or system tone.
              </p>
            </div>
            <div className="delta">
              <strong>Source authority is necessary, not sufficient.</strong>
              <p className="muted small">
                Human sources require SPEAK; agent voice requires its own voice grant.
                Principal kind, execution state, source limits, and explicit subscriptions
                still apply independently.
              </p>
            </div>
          </Card>
        </section>
      )}

      {group.joined && Object.keys(group.remoteStreams).length > 0 && (
        <section className="hero-grid">
          {Object.entries(group.remoteStreams).map(([sourceId, stream]) => {
            const source = groupMediaState?.sources.find(
              (candidate) => candidate.sourceId === sourceId
            );
            const participant = room?.participants.find(
              (candidate) =>
                candidate.id === source?.ownerParticipantId
            );
            return (
              <Card
                key={sourceId}
                data-acceptance-consumer="true"
                data-source-id={sourceId}
                data-source-kind={source?.kind ?? "unknown"}
                data-owner-name={participant?.name ?? source?.ownerParticipantId ?? sourceId}
                data-bytes-received={group.consumerEvidence[sourceId]?.bytesReceived ?? 0}
                data-packets-received={group.consumerEvidence[sourceId]?.packetsReceived ?? 0}
                data-track-state={group.consumerEvidence[sourceId]?.trackState ?? "pending"}
              >
                <SectionTitle>
                  SFU audio · {participant?.name ?? source?.ownerParticipantId ?? sourceId}
                </SectionTitle>
                <GroupRemoteAudio
                  stream={stream}
                  label={`governed source ${sourceId}`}
                />
                <div className="muted small" data-testid="consumer-evidence">
                  packets {group.consumerEvidence[sourceId]?.packetsReceived ?? 0}
                  {" · "}bytes {group.consumerEvidence[sourceId]?.bytesReceived ?? 0}
                  {" · "}track {group.consumerEvidence[sourceId]?.trackState ?? "pending"}
                </div>
              </Card>
            );
          })}
        </section>
      )}

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
            data-testid="submit-governed-work"
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
                <div
                  className="timeline-item"
                  key={item.id}
                  data-testid="work-item"
                  data-work-id={item.id}
                  data-work-status={item.status}
                >
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
                  <article
                    className="artifact"
                    key={artifact.id}
                    data-testid="proposal-artifact"
                    data-artifact-id={artifact.id}
                    data-artifact-status={artifact.status}
                    data-work-id={artifact.sourceWorkId}
                  >
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
                        data-testid="accept-proposal"
                        data-artifact-id={artifact.id}
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
            <div className="delta" data-testid="latest-acceptance">
              <strong>Latest acceptance</strong>
              <p>{lastAcceptance.receiptId}</p>
              <div className="muted small">
                authority grant {lastAcceptance.authorityGrantId}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Selective resumption brief</SectionTitle>
          {!resumptionBrief ? (
            <p className="muted">Join the room to derive continuity from durable state.</p>
          ) : (
            <div data-testid="resumption-brief">
              <div className="grant-grid">
                <Badge>ACCEPTED {resumptionBrief.acceptedWork.length}</Badge>
                <Badge>UNRESOLVED {resumptionBrief.unresolvedWork.length}</Badge>
                <Badge>MISSED {resumptionBrief.missedDurableEvents.length}</Badge>
              </div>

              <div className="delta" data-testid="resumption-next-action">
                <strong>Next action</strong>
                <p>{resumptionBrief.nextAction.summary}</p>
                <div className="muted small">
                  derived at room v{resumptionBrief.roomVersion} · {resumptionBrief.nextAction.kind}
                </div>
              </div>

              <div className="timeline" data-testid="resumption-accepted-work">
                <strong>Accepted work</strong>
                {resumptionBrief.acceptedWork.length === 0 ? (
                  <p className="muted small">No accepted artifacts yet.</p>
                ) : (
                  resumptionBrief.acceptedWork.map((item) => (
                    <div className="timeline-item" key={item.artifactId}>
                      <strong>ACCEPTED</strong>
                      <span>{item.title}</span>
                      <span className="muted small">
                        work {item.workItemId} · artifact {item.artifactId}
                      </span>
                    </div>
                  ))
                )}
              </div>

              <div className="timeline" data-testid="resumption-unresolved-work">
                <strong>Unresolved work</strong>
                {resumptionBrief.unresolvedWork.length === 0 ? (
                  <p className="muted small">No unresolved bounded work.</p>
                ) : (
                  resumptionBrief.unresolvedWork.map((item) => (
                    <div className="timeline-item" key={item.workItemId}>
                      <strong>{item.status.toUpperCase()}</strong>
                      <span>{item.prompt}</span>
                      {item.proposedArtifactTitles.length > 0 && (
                        <span className="muted small">
                          proposal {item.proposedArtifactTitles.join(", ")}
                        </span>
                      )}
                    </div>
                  ))
                )}
              </div>

              <div className="timeline" data-testid="resumption-missed-events">
                <strong>Missed durable events</strong>
                {resumptionBrief.missedDurableEvents.length === 0 ? (
                  <p className="muted small">
                    No missed durable events since this session last acknowledged state.
                  </p>
                ) : (
                  resumptionBrief.missedDurableEvents.map((event) => (
                    <div className="timeline-item" key={event.id}>
                      <strong>ROOM v{event.version}</strong>
                      <span>{event.summary}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          <p className="muted small">
            P0-r derives this view only from durable room state and the server-authorized resume delta.
            P0-s now blocks pre-membership event replay on first join and prevents reconnect
            acknowledgement from rewinding below the identity's durable membership floor.
            Audio, listening transcripts, generated replies, attention leases, scratch,
            sessions, signaling, private keys, and recovery secrets are not inputs.
          </p>
        </Card>
      </section>

      <footer>
        P0-t proves the existing P0 pieces as one executable experience chain: two humans keep live
        governed media flowing, bounded silent work completes during the episode, explicit acceptance
        creates the durable outcome, and a later reconnect resumes from selected room state rather
        than reconstructed speech. Human-value comparison against a voice + notes baseline remains a
        separate pilot question, not something CI can manufacture.
      </footer>
    </main>
  );
}
