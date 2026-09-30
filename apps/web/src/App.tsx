import { useMemo, useState } from "react";
import { MockSilentAgent } from "@commonline/agent-runtime";
import {
  acceptArtifact,
  createRoom,
  leaveEpisode,
  resumeRoom,
  submitWork,
  type RoomState
} from "@commonline/room-core";
import { Badge, Button, Card, SectionTitle } from "@commonline/ui";

const STORAGE_KEY = "commonline:p0-room";

function loadRoom(): RoomState {
  const existing = localStorage.getItem(STORAGE_KEY);
  if (existing) {
    try {
      return JSON.parse(existing) as RoomState;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  }
  return createRoom({
    roomId: "commonline-p0",
    purpose: "Prove concurrent work + trustworthy resumption",
    participantNames: ["Mikey", "Guest"]
  });
}

function saveRoom(room: RoomState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(room));
}

export function App() {
  const [room, setRoom] = useState<RoomState>(() => loadRoom());
  const [taskText, setTaskText] = useState(
    "Compare two approaches and return the trade-offs as a compact artifact."
  );
  const [working, setWorking] = useState(false);
  const agent = useMemo(() => new MockSilentAgent("Vessie (silent worker)"), []);

  function update(next: RoomState) {
    setRoom(next);
    saveRoom(next);
  }

  async function runTask() {
    if (!taskText.trim() || working) return;
    setWorking(true);
    const dispatched = submitWork(room, {
      requestedBy: "Mikey",
      prompt: taskText.trim()
    });
    update(dispatched);
    const task = dispatched.workItems.at(-1)!;
    const artifact = await agent.perform(task);
    update({
      ...dispatched,
      artifacts: [...dispatched.artifacts, artifact],
      workItems: dispatched.workItems.map((item) =>
        item.id === task.id ? { ...item, status: "completed" } : item
      ),
      version: dispatched.version + 1
    });
    setWorking(false);
  }

  const resumeDelta = room.lastResumeDelta;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">COMMONLINE · P0</div>
          <h1>{room.purpose}</h1>
        </div>
        <div className="status-row">
          <Badge>{room.episodeActive ? "EPISODE LIVE" : "ROOM DORMANT"}</Badge>
          <Badge>v{room.version}</Badge>
        </div>
      </header>

      <section className="hero-grid">
        <Card>
          <SectionTitle>Room</SectionTitle>
          <p className="muted">
            Durable state survives the live episode. Raw speech is not stored by this prototype.
          </p>
          <div className="participant-list">
            {room.participants.map((p) => (
              <div className="participant" key={p.id}>
                <span className="presence-dot" />
                <div>
                  <strong>{p.name}</strong>
                  <div className="muted small">{p.kind} · {p.role}</div>
                </div>
              </div>
            ))}
            <div className="participant agent">
              <span className="presence-dot" />
              <div>
                <strong>{agent.name}</strong>
                <div className="muted small">agent · no speaking grant</div>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <SectionTitle>Authority boundary</SectionTitle>
          <div className="grant-grid">
            <Badge>READ SELECTED CONTEXT ✓</Badge>
            <Badge>WRITE DRAFT ARTIFACT ✓</Badge>
            <Badge>SPEAK ✕</Badge>
            <Badge>EXECUTE EXTERNAL EFFECT ✕</Badge>
          </div>
          <p className="muted small">
            This worker can return proposals only. Acceptance and execution remain separate.
          </p>
        </Card>
      </section>

      <section className="work-grid">
        <Card>
          <SectionTitle>Bounded work</SectionTitle>
          <textarea
            value={taskText}
            onChange={(e) => setTaskText(e.target.value)}
            rows={6}
            aria-label="Agent task"
          />
          <div className="button-row">
            <Button onClick={runTask} disabled={working || !room.episodeActive}>
              {working ? "Agent working…" : "Send silent task"}
            </Button>
          </div>
          <div className="timeline">
            {room.workItems.slice().reverse().map((item) => (
              <div className="timeline-item" key={item.id}>
                <strong>{item.status.toUpperCase()}</strong>
                <span>{item.prompt}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle>Artifact inbox</SectionTitle>
          {room.artifacts.length === 0 ? (
            <p className="muted">No agent artifacts yet.</p>
          ) : (
            room.artifacts.slice().reverse().map((artifact) => (
              <article className="artifact" key={artifact.id}>
                <div className="artifact-head">
                  <strong>{artifact.title}</strong>
                  <Badge>{artifact.status}</Badge>
                </div>
                <p>{artifact.body}</p>
                <div className="muted small">
                  Produced by {artifact.producedBy} · source task {artifact.sourceWorkId}
                </div>
                {artifact.status === "proposed" && (
                  <Button onClick={() => update(acceptArtifact(room, artifact.id))}>
                    Accept into room state
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
          {room.acceptedArtifactIds.length === 0 ? (
            <p className="muted">Nothing has been accepted yet.</p>
          ) : (
            <ul>
              {room.acceptedArtifactIds.map((id) => {
                const artifact = room.artifacts.find((a) => a.id === id);
                return <li key={id}>{artifact?.title ?? id}</li>;
              })}
            </ul>
          )}
          <p className="muted small">
            Proposed artifacts do not become durable decisions until explicitly accepted.
          </p>
        </Card>

        <Card>
          <SectionTitle>Leave / resume experiment</SectionTitle>
          {room.episodeActive ? (
            <>
              <p className="muted">
                End the live episode. The room remains, but no new autonomous work is started.
              </p>
              <Button onClick={() => update(leaveEpisode(room))}>Leave episode</Button>
            </>
          ) : (
            <>
              <p className="muted">
                Resume from the last acknowledged version and inspect only the durable delta.
              </p>
              <Button onClick={() => update(resumeRoom(room))}>Resume room</Button>
            </>
          )}
          {resumeDelta && (
            <div className="delta">
              <strong>Since last acknowledged state</strong>
              <ul>
                {resumeDelta.length ? resumeDelta.map((x) => <li key={x}>{x}</li>) : <li>No durable changes.</li>}
              </ul>
            </div>
          )}
        </Card>
      </section>

      <footer>
        P0-a is intentionally local-first scaffolding. WebRTC signaling, multi-client synchronization,
        real model adapters, authentication, and persistence service come next.
      </footer>
    </main>
  );
}
