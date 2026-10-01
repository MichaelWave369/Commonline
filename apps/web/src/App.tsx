import { useEffect, useMemo, useRef, useState } from "react";
import type { Capability } from "@commonline/protocol";
import { Badge, Button, Card, SectionTitle } from "@commonline/ui";
import { useCommonlineRoom } from "./useCommonlineRoom";
import { useSfuGroupAudio } from "./useSfuGroupAudio";
import { usePeerAudio } from "./usePeerAudio";

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
    if (group.joined) group.leave();
    disconnect();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">COMMONLINE · P0-l LIVE MEDIA ACCEPTANCE</div>
          <h1>{room?.purpose ?? "Prove governed subscriptions against live SFU packet evidence"}</h1>
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
          <SectionTitle>Three-human live acceptance surface</SectionTitle>
          {!group.joined ? (
            <>
              <p className="muted">
                P0-l keeps the P0-k source policy and adds observable acceptance
                evidence. Each live Consumer exposes source identity, track state,
                packet count, and bytes received so selective routing can be tested
                across independent browser contexts.
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
                      {policy.executionState} · requires {policy.requiredCapability}
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
              <strong>SPEAK is necessary, not sufficient.</strong>
              <p className="muted small">
                The source policy also checks principal kind, executable state,
                per-publisher limits, and explicit downstream subscriptions.
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
        P0-l adds a repeatable live-media acceptance harness above P0-k. Browser tests can
        prove source-specific subscription matrices against real mediasoup Consumers and
        packet counters while all acceptance evidence remains observational and ephemeral.
      </footer>
    </main>
  );
}
