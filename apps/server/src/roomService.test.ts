import { describe, expect, it } from "vitest";
import { RoomService } from "./roomService";

function currentVersion(service: RoomService, roomId: string) {
  const version = service.getRoom(roomId)?.version;
  if (version === undefined) throw new Error("room missing");
  return version;
}

describe("P0-d RoomService wire freeze", () => {
  it("makes the silent worker a real participant with narrow grants", () => {
    const service = new RoomService("test room");
    service.join({
      roomId: "agent-room",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const room = service.getRoom("agent-room")!;
    const vessie = room.participants.find((participant) => participant.id === "agent-vessie");

    expect(vessie).toMatchObject({
      kind: "agent",
      role: "silent-worker",
      presence: "online"
    });

    const agentCapabilities = room.grants
      .filter((grant) => grant.subjectParticipantId === "agent-vessie")
      .map((grant) => grant.capability);

    expect(agentCapabilities).toContain("READ_SELECTED_CONTEXT");
    expect(agentCapabilities).toContain("WRITE_DRAFT_ARTIFACT");
    expect(agentCapabilities).not.toContain("SPEAK");
    expect(agentCapabilities).not.toContain("RECEIVE_MEDIA");
    expect(agentCapabilities).not.toContain("EXECUTE_EXTERNAL_EFFECT");
  });

  it("keeps one steward grant while observers stay read-only", () => {
    const service = new RoomService("test room");

    service.join({
      roomId: "roles",
      participantId: "observer-first",
      name: "Observer",
      requestedRole: "observer",
      acknowledgedVersion: 0
    });
    service.join({
      roomId: "roles",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });
    service.join({
      roomId: "roles",
      participantId: "bob",
      name: "Bob",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const room = service.getRoom("roles")!;
    expect(room.participants.find((p) => p.id === "observer-first")?.role).toBe("observer");
    expect(room.participants.find((p) => p.id === "alice")?.role).toBe("steward");
    expect(room.participants.find((p) => p.id === "bob")?.role).toBe("participant");

    const acceptGrants = room.grants.filter(
      (grant) => grant.capability === "ACCEPT_OUTCOME" && !grant.revokedAt
    );
    expect(acceptGrants).toHaveLength(1);
    expect(acceptGrants[0]?.subjectParticipantId).toBe("alice");

    const observerSubmit = service.applyIntent("observer-first", {
      type: "submit_work",
      requestId: "observer-submit",
      roomId: "roles",
      baseVersion: room.version,
      prompt: "I should not be allowed to submit."
    });
    expect(observerSubmit.ok).toBe(false);
    if (!observerSubmit.ok) expect(observerSubmit.code).toBe("NOT_AUTHORIZED");

    const observerRtc = service.canRelayRtc("roles", "observer-first", "alice");
    expect(observerRtc.ok).toBe(false);
    if (!observerRtc.ok) expect(observerRtc.code).toBe("NOT_AUTHORIZED");
  });

  it("rejects stale durable writes", () => {
    const service = new RoomService("test room");
    const alice = service.join({
      roomId: "stale",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    service.join({
      roomId: "stale",
      participantId: "bob",
      name: "Bob",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const stale = service.applyIntent("alice", {
      type: "submit_work",
      requestId: "stale-write",
      roomId: "stale",
      baseVersion: alice.room.version,
      prompt: "compare A and B"
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("STALE_VERSION");
  });

  it("binds acceptance to work, artifact and grant receipt with idempotent single-writer semantics", () => {
    const service = new RoomService("test room");

    service.join({
      roomId: "accept",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });
    service.join({
      roomId: "accept",
      participantId: "bob",
      name: "Bob",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const submitted = service.applyIntent("bob", {
      type: "submit_work",
      requestId: "work",
      roomId: "accept",
      baseVersion: currentVersion(service, "accept"),
      prompt: "compare A and B"
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok || !submitted.work) return;

    const artifactA = {
      id: "artifact-a",
      sourceWorkId: submitted.work.id,
      title: "Option A",
      body: "A",
      producedBy: "ignored-display-name",
      status: "proposed" as const,
      createdAt: new Date().toISOString()
    };
    const artifactB = {
      ...artifactA,
      id: "artifact-b",
      title: "Option B",
      body: "B"
    };

    const proposedA = service.proposeArtifact("accept", artifactA);
    expect(proposedA.ok).toBe(true);
    const proposedB = service.proposeArtifact("accept", artifactB);
    expect(proposedB.ok).toBe(true);

    const roomBeforeAccept = service.getRoom("accept")!;
    const stewardGrant = roomBeforeAccept.grants.find(
      (grant) =>
        grant.subjectParticipantId === "alice" &&
        grant.capability === "ACCEPT_OUTCOME"
    )!;
    const acceptBaseVersion = roomBeforeAccept.version;

    const bobTriesStewardGrant = service.applyIntent("bob", {
      type: "accept_outcome",
      requestId: "bad-accept",
      roomId: "accept",
      baseVersion: acceptBaseVersion,
      acceptId: "accept-bad",
      workItemId: submitted.work.id,
      artifactId: artifactA.id,
      authorityGrantId: stewardGrant.grantId
    });
    expect(bobTriesStewardGrant.ok).toBe(false);
    if (!bobTriesStewardGrant.ok) {
      expect(bobTriesStewardGrant.code).toBe("GRANT_NOT_FOUND");
    }

    const first = service.applyIntent("alice", {
      type: "accept_outcome",
      requestId: "accept-first",
      roomId: "accept",
      baseVersion: acceptBaseVersion,
      acceptId: "accept-001",
      workItemId: submitted.work.id,
      artifactId: artifactA.id,
      authorityGrantId: stewardGrant.grantId
    });
    expect(first.ok).toBe(true);
    if (!first.ok || !first.acceptance) return;

    expect(first.acceptance.authorityGrantId).toBe(stewardGrant.grantId);
    expect(first.acceptance.workItemId).toBe(submitted.work.id);
    expect(first.acceptance.artifactId).toBe(artifactA.id);
    expect(first.replayed).toBe(false);

    const committedVersion = first.room.version;

    // Same acceptId with the old pre-commit base version must return the
    // original receipt instead of failing stale or accepting twice.
    const replay = service.applyIntent("alice", {
      type: "accept_outcome",
      requestId: "accept-replay",
      roomId: "accept",
      baseVersion: acceptBaseVersion,
      acceptId: "accept-001",
      workItemId: submitted.work.id,
      artifactId: artifactA.id,
      authorityGrantId: stewardGrant.grantId
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok || !replay.acceptance) return;
    expect(replay.replayed).toBe(true);
    expect(replay.acceptance.receiptId).toBe(first.acceptance.receiptId);
    expect(replay.room.version).toBe(committedVersion);

    const splitBrainAttempt = service.applyIntent("alice", {
      type: "accept_outcome",
      requestId: "accept-second",
      roomId: "accept",
      baseVersion: currentVersion(service, "accept"),
      acceptId: "accept-002",
      workItemId: submitted.work.id,
      artifactId: artifactB.id,
      authorityGrantId: stewardGrant.grantId
    });
    expect(splitBrainAttempt.ok).toBe(false);
    if (!splitBrainAttempt.ok) {
      expect(splitBrainAttempt.code).toBe("OUTCOME_ALREADY_ACCEPTED");
      expect(splitBrainAttempt.canonicalAcceptance?.artifactId).toBe(artifactA.id);
    }

    const acceptedEvents = service
      .getEventLog("accept")
      .filter((event) => event.type === "artifact_accepted");
    expect(acceptedEvents).toHaveLength(1);
  });

  it("coalesces same-participant reconnects without fake leave/join churn", () => {
    const service = new RoomService("test room");

    const first = service.join({
      roomId: "reconnect",
      participantId: "human-mikey",
      name: "Mikey",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });
    const version = first.room.version;
    const eventCount = service.getEventLog("reconnect").length;

    const replacement = service.join({
      roomId: "reconnect",
      participantId: "human-mikey",
      name: "Mikey",
      requestedRole: "participant",
      acknowledgedVersion: version
    });

    expect(replacement.room.version).toBe(version);
    expect(replacement.event).toBeNull();
    expect(service.getEventLog("reconnect")).toHaveLength(eventCount);
    expect(
      replacement.room.participants.filter((participant) => participant.id === "human-mikey")
    ).toHaveLength(1);
  });

  it("returns only missed durable events in the resume delta", () => {
    const service = new RoomService("test room");
    const joined = service.join({
      roomId: "resume",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    service.leave("resume", "alice");

    const resumed = service.join({
      roomId: "resume",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: joined.room.version
    });

    expect(
      resumed.resumeDelta.some((event) => event.type === "participant_left")
    ).toBe(true);
  });

  it("authorizes RTC signaling without mutating durable room state", () => {
    const service = new RoomService("test room");
    service.join({
      roomId: "rtc",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });
    service.join({
      roomId: "rtc",
      participantId: "bob",
      name: "Bob",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const beforeVersion = currentVersion(service, "rtc");
    const beforeEvents = service.getEventLog("rtc").length;

    expect(service.canRelayRtc("rtc", "alice", "bob").ok).toBe(true);
    expect(currentVersion(service, "rtc")).toBe(beforeVersion);
    expect(service.getEventLog("rtc")).toHaveLength(beforeEvents);
  });

  it("transfers ACCEPT_OUTCOME with immutable revocation + grant receipts and idempotent replay", () => {
    const service = new RoomService("test room");

    service.join({
      roomId: "handoff",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });
    service.join({
      roomId: "handoff",
      participantId: "bob",
      name: "Bob",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const room = service.getRoom("handoff")!;
    const aliceGrant = room.grants.find(
      (grant) =>
        grant.subjectParticipantId === "alice" &&
        grant.capability === "ACCEPT_OUTCOME"
    )!;
    const baseVersion = room.version;

    const transferred = service.applyIntent("alice", {
      type: "transfer_accept_authority",
      requestId: "transfer-1",
      roomId: "handoff",
      baseVersion,
      transferId: "transfer-stable-001",
      targetParticipantId: "bob",
      authorityGrantId: aliceGrant.grantId
    });

    expect(transferred.ok).toBe(true);
    if (!transferred.ok || !transferred.authorityTransfer) return;

    const receipt = transferred.authorityTransfer;
    expect(receipt.fromParticipantId).toBe("alice");
    expect(receipt.toParticipantId).toBe("bob");
    expect(receipt.revokedGrantId).toBe(aliceGrant.grantId);
    expect(transferred.room.grantRevocations).toContainEqual(
      expect.objectContaining({
        revocationId: receipt.revocationReceiptId,
        grantId: aliceGrant.grantId,
        revokedByParticipantId: "alice"
      })
    );

    const issued = transferred.room.grants.find(
      (grant) => grant.grantId === receipt.issuedGrantId
    );
    expect(issued).toMatchObject({
      subjectParticipantId: "bob",
      capability: "ACCEPT_OUTCOME",
      issuerId: "alice"
    });

    expect(
      transferred.room.participants.find((participant) => participant.id === "alice")
        ?.role
    ).toBe("participant");
    expect(
      transferred.room.participants.find((participant) => participant.id === "bob")
        ?.role
    ).toBe("steward");

    const committedVersion = transferred.room.version;

    const replay = service.applyIntent("alice", {
      type: "transfer_accept_authority",
      requestId: "transfer-replay",
      roomId: "handoff",
      baseVersion,
      transferId: "transfer-stable-001",
      targetParticipantId: "bob",
      authorityGrantId: aliceGrant.grantId
    });

    expect(replay.ok).toBe(true);
    if (!replay.ok || !replay.authorityTransfer) return;
    expect(replay.replayed).toBe(true);
    expect(replay.authorityTransfer.transferReceiptId).toBe(
      receipt.transferReceiptId
    );
    expect(replay.room.version).toBe(committedVersion);

    const aliceWork = service.applyIntent("alice", {
      type: "submit_work",
      requestId: "work-after-transfer",
      roomId: "handoff",
      baseVersion: committedVersion,
      prompt: "prepare acceptance proof"
    });
    expect(aliceWork.ok).toBe(true);
    if (!aliceWork.ok || !aliceWork.work) return;

    const proposed = service.proposeArtifact("handoff", {
      id: "artifact-after-transfer",
      sourceWorkId: aliceWork.work.id,
      title: "Handoff proof",
      body: "Bob should now be the only accept authority holder.",
      producedBy: "agent-vessie",
      status: "proposed",
      createdAt: new Date().toISOString()
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const aliceAccept = service.applyIntent("alice", {
      type: "accept_outcome",
      requestId: "alice-old-grant",
      roomId: "handoff",
      baseVersion: proposed.room.version,
      acceptId: "alice-accept",
      workItemId: aliceWork.work.id,
      artifactId: "artifact-after-transfer",
      authorityGrantId: aliceGrant.grantId
    });
    expect(aliceAccept.ok).toBe(false);
    if (!aliceAccept.ok) expect(aliceAccept.code).toBe("GRANT_NOT_FOUND");

    const bobAccept = service.applyIntent("bob", {
      type: "accept_outcome",
      requestId: "bob-new-grant",
      roomId: "handoff",
      baseVersion: proposed.room.version,
      acceptId: "bob-accept",
      workItemId: aliceWork.work.id,
      artifactId: "artifact-after-transfer",
      authorityGrantId: receipt.issuedGrantId
    });
    expect(bobAccept.ok).toBe(true);
  });
});
