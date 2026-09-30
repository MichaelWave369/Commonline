import { describe, expect, it } from "vitest";
import { RoomService } from "./roomService";

describe("RoomService authority and versioning", () => {
  it("rejects stale writes and keeps ACCEPT_OUTCOME with the steward", () => {
    const service = new RoomService("test room");

    const a = service.join({
      roomId: "r1",
      clientId: "alice",
      name: "Alice",
      acknowledgedVersion: 0
    });
    const b = service.join({
      roomId: "r1",
      clientId: "bob",
      name: "Bob",
      acknowledgedVersion: 0
    });

    const stale = service.applyIntent("alice", {
      type: "submit_work",
      requestId: "q-stale",
      roomId: "r1",
      baseVersion: a.room.version,
      prompt: "compare A and B"
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("STALE_VERSION");

    const submitted = service.applyIntent("bob", {
      type: "submit_work",
      requestId: "q1",
      roomId: "r1",
      baseVersion: b.room.version,
      prompt: "compare A and B"
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok || !submitted.work) return;

    const proposed = service.proposeArtifact("r1", {
      id: "artifact-1",
      sourceWorkId: submitted.work.id,
      title: "Comparison",
      body: "A versus B",
      producedBy: "silent-agent",
      status: "proposed",
      createdAt: new Date().toISOString()
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const bobAccepts = service.applyIntent("bob", {
      type: "accept_artifact",
      requestId: "q2",
      roomId: "r1",
      baseVersion: proposed.room.version,
      artifactId: "artifact-1"
    });
    expect(bobAccepts.ok).toBe(false);
    if (!bobAccepts.ok) expect(bobAccepts.code).toBe("NOT_AUTHORIZED");

    const aliceAccepts = service.applyIntent("alice", {
      type: "accept_artifact",
      requestId: "q3",
      roomId: "r1",
      baseVersion: proposed.room.version,
      artifactId: "artifact-1"
    });
    expect(aliceAccepts.ok).toBe(true);
  });

  it("returns only missed events in the resume delta", () => {
    const service = new RoomService("test room");
    const joined = service.join({
      roomId: "r2",
      clientId: "alice",
      name: "Alice",
      acknowledgedVersion: 0
    });

    service.leave("r2", "alice");

    const resumed = service.join({
      roomId: "r2",
      clientId: "alice",
      name: "Alice",
      acknowledgedVersion: joined.room.version
    });

    expect(resumed.resumeDelta.some((event) => event.type === "participant_left")).toBe(true);
  });
});
