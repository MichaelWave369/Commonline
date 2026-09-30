import { useEffect, useRef, useState } from "react";
import { Badge, Button, Card, SectionTitle } from "@commonline/ui";
import { useCommonlineRoom } from "./useCommonlineRoom";
import { usePeerAudio } from "./usePeerAudio";

export function App() {
  const roomSession = useCommonlineRoom();
  const {
    clientId,
    name,
    setName,
    room,
    connection,
    resumeDelta,
    lastEvent,
    rtcInbox,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptArtifact,
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

  const me = room?.participants.find((participant) => participant.id === clientId);
  const peers =
    room?.participants.filter(
      (participant) =>
        participant.id !== clientId &&
        participant.kind === "human" &&
        participant.presence === "online"
    ) ?? [];
  const peer = room?.participants.find((participant) => participant.id === audio.peerId);
  const canAccept = room?.grants.some(
    (grant) =>
      grant.principalId === clientId &&
      grant.capability === "ACCEPT_OUTCOME" &&
      grant.allowed
  );
  const canSpeak = room?.grants.some(
    (grant) =>
      grant.principalId === clientId &&
      grant.capability === "SPEAK" &&
      grant.allowed
  );
  const canReceiveMedia = room?.grants.some(
    (grant) =>
      grant.principalId === clientId &&
      grant.capability === "RECEIVE_MEDIA" &&
      grant.allowed
  );

  function leaveEpisode() {
    if (audio.state !== "idle") audio.hangup();
    disconnect();
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">COMMONLINE · P0-c</div>
          <h1>{room?.purpose ?? "Human voice inside a governed shared room"}</h1>
        </div>
        <div className="status-row">
          <Badge>{connection.toUpperCase()}</Badge>
          <Badge>AUDIO {audio.state.toUpperCase()}</Badge>
          {room && <Badge>ROOM v{room.version}</Badge>}
        </div>
      </header>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Join the live episode</SectionTitle>
          <p className="muted">
            Room identity is still a temporary browser-session principal. Audio access is requested
            separately when you place or answer a call.
          </p>
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={connection !== "disconnected"}
            aria-label="Display name"
          />
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
          <div className="muted small">Session principal: {clientId}</div>
        </Card>

        <Card>
          <SectionTitle>Media authority</SectionTitle>
          <div className="grant-grid">
            <Badge>YOU RECEIVE MEDIA {canReceiveMedia ? "✓" : "✕"}</Badge>
            <Badge>YOU SPEAK {canSpeak ? "✓" : "✕"}</Badge>
            <Badge>AGENT RECEIVE MEDIA ✕</Badge>
            <Badge>AGENT SPEAK ✕</Badge>
          </div>
          <p className="muted small">
            P0-c does not send microphone audio to the silent worker. WebRTC signaling is ephemeral
            and does not increment room versions or enter the durable event log.
          </p>
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
                <p className="muted">Another human participant must be online before you can call.</p>
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
            This rung is one-to-one audio only. It intentionally does not record, transcribe, mix,
            or persist the media stream.
          </p>
        </Card>

        <Card>
          <SectionTitle>Live participants</SectionTitle>
          {!room ? (
            <p className="muted">Join to receive the authoritative room snapshot.</p>
          ) : (
            <div className="participant-list">
              {room.participants.map((participant) => (
                <div className="participant" key={participant.id}>
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
                      {participant.id === clientId ? " (you)" : ""}
                    </strong>
                    <div className="muted small">
                      {participant.kind} · {participant.role} · {participant.presence}
                    </div>
                  </div>
                </div>
              ))}
              <div className="participant agent">
                <span className="presence-dot" />
                <div>
                  <strong>Vessie (silent worker)</strong>
                  <div className="muted small">agent · text context only · no live media grant</div>
                </div>
              </div>
            </div>
          )}
        </Card>
      </section>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Synchronization</SectionTitle>
          <p className="muted">
            Durable client intents are version-bound. Media signaling uses the same authenticated
            transport connection in the future, but remains outside durable room state.
          </p>
          {lastEvent ? (
            <div className="delta">
              <strong>Latest durable event</strong>
              <p>{lastEvent.summary}</p>
              <div className="muted small">
                {lastEvent.type} · v{lastEvent.version}
              </div>
            </div>
          ) : (
            <p className="muted small">No synchronized durable event received yet.</p>
          )}
        </Card>

        <Card>
          <SectionTitle>Authority boundary</SectionTitle>
          <div className="grant-grid">
            <Badge>AGENT READ SELECTED CONTEXT ✓</Badge>
            <Badge>AGENT WRITE DRAFT ✓</Badge>
            <Badge>AGENT LIVE AUDIO ✕</Badge>
            <Badge>AGENT EXECUTE ✕</Badge>
          </div>
          {me && (
            <p className="muted small">
              You are <strong>{me.role}</strong>. ACCEPT_OUTCOME: {canAccept ? "✓" : "✕"}.
            </p>
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
            disabled={connection !== "connected" || !taskText.trim()}
          >
            Send server-authorized task
          </Button>

          <div className="timeline">
            {room?.workItems
              .slice()
              .reverse()
              .map((item) => (
                <div className="timeline-item" key={item.id}>
                  <strong>{item.status.toUpperCase()}</strong>
                  <span>{item.prompt}</span>
                </div>
              ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Artifact inbox</SectionTitle>
          {!room || room.artifacts.length === 0 ? (
            <p className="muted">No proposed artifacts yet.</p>
          ) : (
            room.artifacts
              .slice()
              .reverse()
              .map((artifact) => (
                <article className="artifact" key={artifact.id}>
                  <div className="artifact-head">
                    <strong>{artifact.title}</strong>
                    <Badge>{artifact.status}</Badge>
                  </div>
                  <p>{artifact.body}</p>
                  <div className="muted small">
                    Produced by {artifact.producedBy} · source {artifact.sourceWorkId}
                  </div>
                  {artifact.status === "proposed" && (
                    <Button
                      onClick={() => acceptArtifact(artifact.id)}
                      disabled={!canAccept || connection !== "connected"}
                    >
                      {canAccept ? "Accept into durable room state" : "Steward approval required"}
                    </Button>
                  )}
                </article>
              ))
          )}
        </Card>
      </section>

      <section className="work-grid">
        <Card>
          <SectionTitle>Durable room state</SectionTitle>
          {!room || room.acceptedArtifactIds.length === 0 ? (
            <p className="muted">Nothing has been accepted yet.</p>
          ) : (
            <ul>
              {room.acceptedArtifactIds.map((id) => {
                const artifact = room.artifacts.find((candidate) => candidate.id === id);
                return <li key={id}>{artifact?.title ?? id}</li>;
              })}
            </ul>
          )}
          <p className="muted small">
            A proposed artifact becomes durable only after an authorized acceptance event.
          </p>
        </Card>

        <Card>
          <SectionTitle>Resume delta</SectionTitle>
          {resumeDelta.length === 0 ? (
            <p className="muted">No missed durable events since this browser last acknowledged state.</p>
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
            Voice is absent by design. The delta represents governed state changes, not recorded speech.
          </p>
        </Card>
      </section>

      <footer>
        P0-c adds one-to-one WebRTC voice while preserving the separation between ephemeral media and
        durable coordination. Server storage remains in-memory and participant identity remains
        unauthenticated in this rung.
      </footer>
    </main>
  );
}
