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
    expect(Object.keys(store.durableDebugRows())).not.toContain("media_sessions");
    expect(Object.keys(store.durableDebugRows())).not.toContain("group_media_sessions");
    expect(Object.keys(store.durableDebugRows())).not.toContain("media_sources");
    expect(Object.keys(store.durableDebugRows())).not.toContain("media_subscriptions");

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

  it("persists authority transfer receipts and revocations across restart", () => {
    const path = databasePath();
    const store1 = new SQLiteRoomStore(path);
    const service1 = new RoomService("handoff persistence", store1);

    service1.join({
      roomId: "handoff-db",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });
    service1.join({
      roomId: "handoff-db",
      participantId: "bob",
      name: "Bob",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const before = service1.getRoom("handoff-db")!;
    const grant = before.grants.find(
      (item) =>
        item.subjectParticipantId === "alice" &&
        item.capability === "ACCEPT_OUTCOME"
    )!;

    const transfer = service1.applyIntent("alice", {
      type: "transfer_accept_authority",
      requestId: "handoff",
      roomId: "handoff-db",
      baseVersion: before.version,
      transferId: "transfer-persist-001",
      targetParticipantId: "bob",
      authorityGrantId: grant.grantId
    });

    expect(transfer.ok).toBe(true);
    if (!transfer.ok || !transfer.authorityTransfer) return;
    const receiptId = transfer.authorityTransfer.transferReceiptId;
    const newGrantId = transfer.authorityTransfer.issuedGrantId;

    store1.close();

    const store2 = new SQLiteRoomStore(path);
    const recovered = store2.loadRoom("handoff-db")!;

    expect(recovered.authorityTransfers[0]?.transferReceiptId).toBe(receiptId);
    expect(
      recovered.grantRevocations.some(
        (revocation) => revocation.grantId === grant.grantId
      )
    ).toBe(true);
    expect(
      recovered.grants.some(
        (item) =>
          item.grantId === newGrantId &&
          item.subjectParticipantId === "bob" &&
          item.capability === "ACCEPT_OUTCOME"
      )
    ).toBe(true);

    store2.close();
  });

  it("stores identity public keys and only a recovery hash", () => {
    const path = databasePath();
    const store = new SQLiteRoomStore(path);

    store.enrollIdentity({
      participantId: "human-alice",
      publicKey: {
        kty: "EC",
        crv: "P-256",
        x: "x-coordinate",
        y: "y-coordinate",
        ext: true,
        key_ops: ["verify"]
      },
      recoveryHash: "deadbeef",
      createdAt: new Date().toISOString()
    });

    const identity = store.getIdentity("human-alice")!;
    expect(identity.publicKey.x).toBe("x-coordinate");
    expect(identity.recoveryHash).toBe("deadbeef");

    const durable = JSON.stringify(store.durableDebugRows());
    expect(durable).toContain("deadbeef");
    expect(durable).not.toContain("raw-recovery-secret");

    store.close();
  });

  it("explicitly migrates p0-e.1 / p0-d.1 metadata to the P0-i schema", () => {
    const path = databasePath();
    const raw = new DatabaseSync(path);

    raw.exec(`
      CREATE TABLE schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE rooms (
        room_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        version INTEGER NOT NULL,
        wire_schema_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("storage_version", "p0-e.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("wire_schema_version", "p0-d.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("created_at", new Date().toISOString());
    raw
      .prepare(
        "INSERT INTO rooms(room_id, purpose, version, wire_schema_version, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "legacy-room",
        "legacy",
        0,
        "p0-d.1",
        new Date().toISOString()
      );
    raw.close();

    const migrated = new SQLiteRoomStore(path);
    expect(migrated.metadata().storage_version).toBe(
      COMMONLINE_STORAGE_SCHEMA_VERSION
    );
    expect(migrated.metadata().wire_schema_version).toBe("p0-i.1");
    expect(migrated.metadata().migrated_at).toBeTruthy();
    expect(migrated.loadRoom("legacy-room")?.schemaVersion).toBe("p0-i.1");
    migrated.close();
  });
  it("migrates P0-f metadata forward to P0-i", () => {
    const path = databasePath();
    const raw = new DatabaseSync(path);

    raw.exec(`
      CREATE TABLE schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE rooms (
        room_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        version INTEGER NOT NULL,
        wire_schema_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("storage_version", "p0-f.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("wire_schema_version", "p0-f.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("created_at", new Date().toISOString());
    raw
      .prepare(
        "INSERT INTO rooms(room_id, purpose, version, wire_schema_version, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "p0f-room",
        "p0-f room",
        0,
        "p0-f.1",
        new Date().toISOString()
      );
    raw.close();

    const migrated = new SQLiteRoomStore(path);
    expect(migrated.metadata().storage_version).toBe(
      COMMONLINE_STORAGE_SCHEMA_VERSION
    );
    expect(migrated.metadata().wire_schema_version).toBe("p0-i.1");
    expect(migrated.loadRoom("p0f-room")?.schemaVersion).toBe("p0-i.1");
    migrated.close();
  });

  it("migrates the immediately previous P0-g metadata to P0-i", () => {
    const path = databasePath();
    const raw = new DatabaseSync(path);

    raw.exec(`
      CREATE TABLE schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE rooms (
        room_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        version INTEGER NOT NULL,
        wire_schema_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("storage_version", "p0-g.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("wire_schema_version", "p0-g.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("created_at", new Date().toISOString());
    raw
      .prepare(
        "INSERT INTO rooms(room_id, purpose, version, wire_schema_version, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "p0g-room",
        "p0-g room",
        0,
        "p0-g.1",
        new Date().toISOString()
      );
    raw.close();

    const migrated = new SQLiteRoomStore(path);
    expect(migrated.metadata().storage_version).toBe(
      COMMONLINE_STORAGE_SCHEMA_VERSION
    );
    expect(migrated.metadata().wire_schema_version).toBe("p0-i.1");
    expect(migrated.loadRoom("p0g-room")?.schemaVersion).toBe("p0-i.1");
    migrated.close();
  });


  it("migrates the immediately previous P0-h metadata to P0-i", () => {
    const path = databasePath();
    const raw = new DatabaseSync(path);

    raw.exec(`
      CREATE TABLE schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE rooms (
        room_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        version INTEGER NOT NULL,
        wire_schema_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("storage_version", "p0-h.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("wire_schema_version", "p0-h.1");
    raw
      .prepare("INSERT INTO schema_meta(key, value) VALUES (?, ?)")
      .run("created_at", new Date().toISOString());
    raw
      .prepare(
        "INSERT INTO rooms(room_id, purpose, version, wire_schema_version, updated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        "p0h-room",
        "p0-h room",
        0,
        "p0-h.1",
        new Date().toISOString()
      );
    raw.close();

    const migrated = new SQLiteRoomStore(path);
    expect(migrated.metadata().storage_version).toBe(
      COMMONLINE_STORAGE_SCHEMA_VERSION
    );
    expect(migrated.metadata().wire_schema_version).toBe("p0-i.1");
    expect(migrated.loadRoom("p0h-room")?.schemaVersion).toBe("p0-i.1");
    migrated.close();
  });


});
