import { useState } from "react";
import { Badge, Button, Card, SectionTitle } from "@commonline/ui";
import { useCommonlineRoom } from "./useCommonlineRoom";

export function App() {
  const {
    clientId,
    name,
    setName,
    room,
    connection,
    resumeDelta,
    lastEvent,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptArtifact
  } = useCommonlineRoom();

  const [taskText, setTaskText] = useState(
    "Compare two approaches and return the trade-offs as a compact artifact."
  );

  const me = room?.participants.find((participant) => participant.id === clientId);
  const canAccept = room?.grants.some(
    (grant) =>
      grant.principalId === clientId &&
      grant.capability === "ACCEPT_OUTCOME" &&
      grant.allowed
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">COMMONLINE · P0-b</div>
          <h1>{room?.purpose ?? "Server-authoritative shared room"}</h1>
        </div>
        <div className="status-row">
          <Badge>{connection.toUpperCase()}</Badge>
          {room && <Badge>ROOM v{room.version}</Badge>}
        </div>
      </header>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Join the live episode</SectionTitle>
          <p className="muted">
            Each browser session gets its own temporary principal ID. Authentication is deliberately
            not claimed in this rung.
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
              <Button onClick={disconnect} disabled={connection === "connecting"}>
                Leave episode
              </Button>
            )}
          </div>
          {notice && <p className="notice">{notice}</p>}
          <div className="muted small">Session principal: {clientId}</div>
        </Card>

        <Card>
          <SectionTitle>Authority boundary</SectionTitle>
          <div className="grant-grid">
            <Badge>AGENT READ SELECTED CONTEXT ✓</Badge>
            <Badge>AGENT WRITE DRAFT ✓</Badge>
            <Badge>AGENT SPEAK ✕</Badge>
            <Badge>AGENT EXECUTE ✕</Badge>
          </div>
          {me && (
            <p className="muted small">
              You are <strong>{me.role}</strong>. ACCEPT_OUTCOME: {canAccept ? "✓" : "✕"}.
            </p>
          )}
        </Card>
      </section>

      <section className="hero-grid">
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
                    <strong>{participant.name}</strong>
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
                  <div className="muted small">agent · server-owned mock adapter</div>
                </div>
              </div>
            </div>
          )}
        </Card>

        <Card>
          <SectionTitle>Synchronization</SectionTitle>
          <p className="muted">
            Clients send intents against a base room version. The server validates the version,
            authority, and transition before broadcasting new state.
          </p>
          {lastEvent ? (
            <div className="delta">
              <strong>Latest accepted event</strong>
              <p>{lastEvent.summary}</p>
              <div className="muted small">
                {lastEvent.type} · v{lastEvent.version}
              </div>
            </div>
          ) : (
            <p className="muted small">No synchronized event received yet.</p>
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
            <p className="muted">No missed events since this browser session last acknowledged state.</p>
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
            The delta is event/state based, not a saved transcript.
          </p>
        </Card>
      </section>

      <footer>
        P0-b keeps room state in server memory. Restarting the room service resets it. Real identity,
        durable server storage, WebRTC audio, and model providers remain intentionally outside this rung.
      </footer>
    </main>
  );
}
