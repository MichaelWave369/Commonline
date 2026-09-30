import { describe, expect, it } from "vitest";
import { EphemeralWorkPlane } from "./ephemeralWork";
import { RoomService } from "./roomService";

describe("P0-d scratch / propose / accept boundary", () => {
  it("never leaks private scratch into durable room state or event history", () => {
    const service = new RoomService("scratch test");
    const workPlane = new EphemeralWorkPlane();

    service.join({
      roomId: "scratch-room",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const room = service.getRoom("scratch-room")!;
    const submitted = service.applyIntent("alice", {
      type: "submit_work",
      requestId: "scratch-work",
      roomId: "scratch-room",
      baseVersion: room.version,
      prompt: "prepare a proposal"
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok || !submitted.work) return;

    const poison = "SCRATCH_SECRET_DO_NOT_PERSIST_82731";

    workPlane.begin({
      roomId: "scratch-room",
      workItemId: submitted.work.id,
      participantId: "agent-vessie",
      ttlMs: 60_000
    });
    workPlane.writeScratch({
      roomId: "scratch-room",
      workItemId: submitted.work.id,
      participantId: "agent-vessie",
      content: poison
    });

    expect(
      workPlane.getScratch("scratch-room", submitted.work.id)?.content
    ).toBe(poison);
    expect(
      workPlane.getStatus("scratch-room", submitted.work.id)?.state
    ).toBe("working");

    const durableBefore = JSON.stringify({
      room: service.getRoom("scratch-room"),
      events: service.getEventLog("scratch-room")
    });
    expect(durableBefore).not.toContain(poison);

    workPlane.finish({
      roomId: "scratch-room",
      workItemId: submitted.work.id,
      participantId: "agent-vessie",
      state: "completed"
    });

    expect(workPlane.getScratch("scratch-room", submitted.work.id)).toBeUndefined();

    const durableAfter = JSON.stringify({
      room: service.getRoom("scratch-room"),
      events: service.getEventLog("scratch-room")
    });
    expect(durableAfter).not.toContain(poison);
  });

  it("expires scratch without turning expiry into a durable event", () => {
    const workPlane = new EphemeralWorkPlane();

    workPlane.begin({
      roomId: "r",
      workItemId: "w",
      participantId: "agent-vessie",
      ttlMs: 1
    });
    workPlane.writeScratch({
      roomId: "r",
      workItemId: "w",
      participantId: "agent-vessie",
      content: "temporary"
    });

    workPlane.clearExpired(Date.now() + 5_000);
    expect(workPlane.getScratch("r", "w")).toBeUndefined();
  });
});
