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
    name,
    setName,
    requestedRole,
    setRequestedRole,
    room,
    connection,
    resumeDelta,
    lastEvent,
    lastAcceptance,
    agentStatuses,
    rtcInbox,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptOutcome,
    sendRtcSignal,
    consumeRtcSignal
  } = roomSession;

  const audio = usePeerAudio({
    roomConnected: connection === "connected",
    rtcInbox,
    consumeRtcSignal,
    sendRtcSignal
  });

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const [taskText, setTaskText] = useState(
    "Compare two approaches and return the trade-offs as a compact artifact."
  );

  useEffect(() => {
    if (!remoteAudioRef.current) return;
    remoteAudioRef.current.srcObject = audio.remoteStream;
    if (audio.remoteStream) {
      void remoteAudioRef.current.play().catch(() => {
        // Browser autoplay policy may require the participant to press play.
      });
    }
  }, [audio.remoteStream]);

  const me = room?.participants.find(
    (participant) => participant.id === participantId
  );

  const activeGrant = (capability: Capability, subjectId = participantId) =>
    room?.grants.find(
      (grant) =>
        grant.subjectParticipantId === subjectId &&
        grant.capability === capability &&
        !grant.revokedAt &&
        (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.now())
    );

  const acceptGrant = activeGrant("ACCEPT_OUTCOME");
  const canAccept = Boolean(acceptGrant);
  const canSpeak = Boolean(activeGrant("SPEAK"));
  const canReceiveMedia = Boolean(activeGrant("RECEIVE_MEDIA"));

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
          <div className="eyebrow">COMMONLINE · P0-d WIRE FREEZE</div>
          <h1>{room?.purpose ?? "Identity, authority, scratch, propose, accept"}</h1>
        </div>
        <div className="status-row">
          <Badge>{connection.toUpperCase()}</Badge>
          <Badge>AUDIO {audio.state.toUpperCase()}</Badge>
          {room && <Badge>{room.schemaVersion}</Badge>}
          {room && <Badge>ROOM v{room.version}</Badge>}
        </div>
      </header>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Participant ≠ session</SectionTitle>
          <p className="muted">
            Your participant identity survives reconnects. This tab has a separate ephemeral
            session identity, so a reconnect replaces transport instead of inventing another person.
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
            <option value="observer">Observer (read-only stub)</option>
          </select>
          <div className="button-row">
            {connection === "disconnected" ? (
              <Button onClick={connect} disabled={!name.trim()}>
                Join room
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
          <SectionTitle>Grant receipts</SectionTitle>
          <div className="grant-grid">
            <Badge>READ ROOM {activeGrant("READ_ROOM_STATE") ? "✓" : "✕"}</Badge>
            <Badge>SUBMIT {activeGrant("SUBMIT_WORK") ? "✓" : "✕"}</Badge>
            <Badge>SPEAK {canSpeak ? "✓" : "✕"}</Badge>
            <Badge>RECEIVE MEDIA {canReceiveMedia ? "✓" : "✕"}</Badge>
            <Badge>ACCEPT {canAccept ? "✓" : "✕"}</Badge>
          </div>
          {me && (
            <p className="muted small">
              Server role: <strong>{me.role}</strong>. Authority comes from grant receipts,
              not from the role label itself.
            </p>
          )}
          {acceptGrant && (
            <div className="muted small">ACCEPT grant: {acceptGrant.grantId}</div>
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
                <Button onClick={audio.answerCall}>Answer</Button>
                <Button onClick={audio.declineCall}>Decline</Button>
              </div>
            </div>
          ) : audio.state === "idle" ? (
            <>
              {peers.length === 0 ? (
                <p className="muted">
                  No media-authorized human peer is online. Observers are intentionally not callable.
                </p>
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
                        disabled={!canSpeak || !canReceiveMedia}
                      >
                        Call
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </>
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

          {audio.error && <p className="notice">{audio.error}</p>}

          <audio ref={remoteAudioRef} autoPlay playsInline controls className="remote-audio">
            Remote audio playback is not supported by this browser.
          </audio>

          <p className="muted small">
            Human WebRTC media remains ephemeral. Vessie has no SPEAK or RECEIVE_MEDIA grant.
          </p>
        </Card>

        <Card>
          <SectionTitle>Real participants</SectionTitle>
          {!room ? (
            <p className="muted">Join to receive the authoritative participant set.</p>
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
                        status: {agentStatus?.state ?? "idle"} · scratch content private
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
          <SectionTitle>Backstage ≠ stage</SectionTitle>
          <p className="muted">
            Silent-agent work now has an explicit ephemeral scratch plane. Humans can see
            content-free status, but scratch never enters RoomSnapshot, RoomEvent, resume delta,
            or acceptance receipts.
          </p>
          <div className="grant-grid">
            <Badge>SCRATCH PRIVATE</Badge>
            <Badge>STATUS VISIBLE</Badge>
            <Badge>PROPOSAL ROOM-VISIBLE</Badge>
            <Badge>ACCEPTANCE DURABLE</Badge>
          </div>
          {agentStatus && (
            <div className="delta">
              <strong>Vessie status</strong>
              <p>
                {agentStatus.state} · work {agentStatus.workItemId}
              </p>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Latest durable event</SectionTitle>
          {lastEvent ? (
            <div className="delta">
              <strong>{lastEvent.type}</strong>
              <p>{lastEvent.summary}</p>
              <div className="muted small">room v{lastEvent.version}</div>
            </div>
          ) : (
            <p className="muted">No synchronized durable event received yet.</p>
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
          <SectionTitle>Canonical accepted outcomes</SectionTitle>
          {!room || room.acceptances.length === 0 ? (
            <p className="muted">No work item has a canonical accepted outcome yet.</p>
          ) : (
            <ul>
              {room.acceptances.map((receipt) => {
                const artifact = room.artifacts.find(
                  (candidate) => candidate.id === receipt.artifactId
                );
                return (
                  <li key={receipt.receiptId}>
                    {receipt.workItemId} → {artifact?.title ?? receipt.artifactId}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="muted small">
            P0-d allows one current accepted outcome per work item. Supersession/retraction is
            deliberately deferred, so “accepted” must not be treated as eternal truth.
          </p>
          {lastAcceptance && (
            <div className="delta">
              <strong>Latest acceptance receipt</strong>
              <p>{lastAcceptance.receiptId}</p>
              <div className="muted small">
                accept id {lastAcceptance.acceptId} · committed room v
                {lastAcceptance.committedVersion}
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
            Scratch, agent status changes, WebRTC signaling, and voice are absent by design.
          </p>
        </Card>
      </section>

      <footer>
        P0-d freezes the wire before persistence: participant identity is distinct from session
        transport; authority is grant-receipt based; acceptance is work-bound, idempotent and
        single-writer; observers are read-only; and agent scratch is explicitly non-event state.
      </footer>
    </main>
  );
}
