import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRoom,
  joinParticipant,
  SILENT_AGENT_PARTICIPANT_ID
} from "@commonline/room-core";
import type { RoomEvent } from "@commonline/protocol";
import { EphemeralWorkPlane } from "./ephemeralWork";
import { RoomService } from "./roomService";
import {
  COMMONLINE_STORAGE_SCHEMA_VERSION,
  SQLiteRoomStore
} from "./sqliteRoomStore";

const cleanup: string[] = [];

function databasePath() {
  const dir = mkdtempSync(join(tmpdir(), "commonline-p0e-"));
  cleanup.push(dir);
  return join(dir, "commonline.db");
}

afterEach(() => {
  while (cleanup.length) {
    rmSync(cleanup.pop()!, { recursive: true, force: true });
  }
});

describe("P0-e SQLite durability", () => {
  it("recovers room, grants, work, proposal, acceptance and event history after restart", () => {
    const path = databasePath();

    const store1 = new SQLiteRoomStore(path);
    const service1 = new RoomService("persistent test", store1);

    service1.join({
      roomId: "durable",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const beforeWork = service1.getRoom("durable")!;
    const submitted = service1.applyIntent("alice", {
      type: "submit_work",
      requestId: "work-1",
      roomId: "durable",
      baseVersion: beforeWork.version,
      prompt: "prepare a durable proposal"
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok || !submitted.work) return;

    const proposed = service1.proposeArtifact("durable", {
      id: "artifact-durable",
      sourceWorkId: submitted.work.id,
      title: "Durable proposal",
      body: "This body must survive a process restart.",
      producedBy: SILENT_AGENT_PARTICIPANT_ID,
      status: "proposed",
      createdAt: new Date().toISOString()
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const beforeAccept = service1.getRoom("durable")!;
    const acceptGrant = beforeAccept.grants.find(
      (grant) =>
        grant.subjectParticipantId === "alice" &&
        grant.capability === "ACCEPT_OUTCOME"
    )!;

    const accepted = service1.applyIntent("alice", {
      type: "accept_outcome",
      requestId: "accept-1",
      roomId: "durable",
      baseVersion: beforeAccept.version,
      acceptId: "accept-stable-001",
      workItemId: submitted.work.id,
      artifactId: "artifact-durable",
      authorityGrantId: acceptGrant.grantId
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok || !accepted.acceptance) return;

    const receiptId = accepted.acceptance.receiptId;
    const acceptedVersion = accepted.room.version;
    const eventCount = service1.getEventLog("durable").length;

    store1.close();

    const store2 = new SQLiteRoomStore(path);
    const service2 = new RoomService("persistent test", store2);
    const recovered = service2.getRoom("durable")!;

    expect(recovered.version).toBe(acceptedVersion);
    expect(recovered.episodeActive).toBe(false);
    expect(
      recovered.participants.find((participant) => participant.id === "alice")
        ?.presence
    ).toBe("offline");
    expect(
      recovered.participants.find(
        (participant) => participant.id === SILENT_AGENT_PARTICIPANT_ID
      )?.presence
    ).toBe("online");
    expect(recovered.workItems[0]?.status).toBe("accepted");
    expect(recovered.artifacts[0]?.status).toBe("accepted");
    expect(recovered.acceptances[0]?.receiptId).toBe(receiptId);
    expect(service2.getEventLog("durable")).toHaveLength(eventCount);

    const rejoined = service2.join({
      roomId: "durable",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });
    expect(
      rejoined.resumeDelta.some((event) => event.type === "artifact_accepted")
    ).toBe(true);

    // Simulate a browser retrying after the original COMMIT response was lost.
    // The original pre-commit base version is stale now, but the stable acceptId
    // must still recover the canonical receipt.
    const replay = service2.applyIntent("alice", {
      type: "accept_outcome",
      requestId: "accept-retry",
      roomId: "durable",
      baseVersion: beforeAccept.version,
      acceptId: "accept-stable-001",
      workItemId: submitted.work.id,
      artifactId: "artifact-durable",
      authorityGrantId: acceptGrant.grantId
    });

    expect(replay.ok).toBe(true);
    if (!replay.ok || !replay.acceptance) return;
    expect(replay.replayed).toBe(true);
    expect(replay.acceptance.receiptId).toBe(receiptId);

    store2.close();
  });

  it("rolls back snapshot mutation if the event append fails", () => {
    const path = databasePath();
    const store = new SQLiteRoomStore(path);

    const base = createRoom({
      roomId: "atomic",
      purpose: "atomicity proof"
    });
    const v1 = joinParticipant(base, {
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant"
    });

    const event1: RoomEvent = {
      id: "event-one",
      roomId: "atomic",
      version: v1.version,
      type: "participant_joined",
      actorId: "alice",
      summary: "Alice joined.",
      occurredAt: new Date().toISOString()
    };

    store.saveTransition({
      room: v1,
      event: event1,
      expectedPreviousVersion: 0
    });

    const v2 = joinParticipant(v1, {
      participantId: "bob",
      name: "Bob",
      requestedRole: "participant"
    });

    // Duplicate event id fails after the snapshot writes have begun. The whole
    // transaction must roll back, including Bob and room version 2.
    const conflictingEvent: RoomEvent = {
      ...event1,
      version: v2.version,
      actorId: "bob",
      summary: "Bob joined."
    };

    expect(() =>
      store.saveTransition({
        room: v2,
        event: conflictingEvent,
        expectedPreviousVersion: v1.version
      })
    ).toThrow();

    const recovered = store.loadRoom("atomic")!;
    expect(recovered.version).toBe(v1.version);
    expect(
      recovered.participants.some((participant) => participant.id === "bob")
    ).toBe(false);
    expect(store.loadEvents("atomic")).toHaveLength(1);

    store.close();
  });

  it("keeps scratch and status outside every durable SQLite table", () => {
    const path = databasePath();
    const store = new SQLiteRoomStore(path);
    const service = new RoomService("scratch persistence test", store);
    const workPlane = new EphemeralWorkPlane();

    service.join({
      roomId: "scratch-db",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const room = service.getRoom("scratch-db")!;
    const submitted = service.applyIntent("alice", {
      type: "submit_work",
      requestId: "scratch-work",
      roomId: "scratch-db",
      baseVersion: room.version,
      prompt: "make a proposal without persisting backstage"
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok || !submitted.work) return;

    const poison = "SCRATCH_SECRET_DO_NOT_PERSIST_82731";

    workPlane.begin({
      roomId: "scratch-db",
      workItemId: submitted.work.id,
      participantId: SILENT_AGENT_PARTICIPANT_ID
    });
    workPlane.writeScratch({
      roomId: "scratch-db",
      workItemId: submitted.work.id,
      participantId: SILENT_AGENT_PARTICIPANT_ID,
      content: poison
    });
    workPlane.setStatus({
      roomId: "scratch-db",
      workItemId: submitted.work.id,
      participantId: SILENT_AGENT_PARTICIPANT_ID,
      state: "blocked"
    });

    const durable = JSON.stringify(store.durableDebugRows());
    expect(durable).not.toContain(poison);
    expect(Object.keys(store.durableDebugRows())).not.toContain("scratch");
    expect(Object.keys(store.durableDebugRows())).not.toContain("sessions");
    expect(Object.keys(store.durableDebugRows())).not.toContain("rtc_signaling");
    expect(Object.keys(store.durableDebugRows())).not.toContain("agent_status");

    store.close();
  });

  it("refuses to reinterpret an incompatible storage or wire schema", () => {
    const path = databasePath();
    const store = new SQLiteRoomStore(path);

    expect(store.metadata().storage_version).toBe(
      COMMONLINE_STORAGE_SCHEMA_VERSION
    );
    store.close();

    const raw = new DatabaseSync(path);
    raw
      .prepare("UPDATE schema_meta SET value = ? WHERE key = 'wire_schema_version'")
      .run("future-wire");
    raw.close();

    expect(() => new SQLiteRoomStore(path)).toThrow(
      /Stored wire schema future-wire/
    );
  });
});
