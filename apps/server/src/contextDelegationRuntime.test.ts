import { describe, expect, it } from "vitest";
import {
  acceptOutcome,
  createRoom,
  joinParticipant,
  proposeArtifact,
  submitWork
} from "@commonline/room-core";
import type { GrantReceipt, RoomSnapshot } from "@commonline/protocol";
import {
  LocalDelegationProofExecutor,
  requestContextDelegation
} from "./contextDelegationRuntime";

function acceptedRoom(): RoomSnapshot {
  let room = joinParticipant(
    createRoom({
      roomId: "delegation-room",
      purpose: "prove context does not delegate itself"
    }),
    {
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant"
    }
  );

  const work = submitWork(room, {
    requestedBy: "alice",
    prompt: "Prepare a context delegation proof artifact."
  });
  room = work.room;

  room = proposeArtifact(room, {
    id: "artifact-delegation-proof",
    sourceWorkId: work.work.id,
    title: "Delegation proof artifact",
    body: "Accepted context does not imply onward-sharing authority.",
    producedBy: "agent-vessie",
    status: "proposed",
    createdAt: new Date().toISOString()
  });

  const acceptGrant = room.grants.find(
    (grant) =>
      grant.subjectParticipantId === "alice" &&
      grant.capability === "ACCEPT_OUTCOME"
  )!;

  const accepted = acceptOutcome(room, {
    acceptId: "accept-delegation-proof",
    actorParticipantId: "alice",
    workItemId: work.work.id,
    artifactId: "artifact-delegation-proof",
    authorityGrantId: acceptGrant.grantId
  });
  if (!accepted.ok) throw new Error(accepted.message);
  return accepted.room;
}

function message(room: RoomSnapshot, authorityGrantId: string) {
  return {
    type: "request_context_delegation" as const,
    requestId: "request-delegation-1",
    roomId: room.roomId,
    baseVersion: room.version,
    delegationRequestId: "delegation-1",
    artifactId: "artifact-delegation-proof",
    authorityGrantId,
    kind: "accepted-artifact-summary" as const,
    target: "local-delegation-proof-sink" as const,
    purpose: "comparison-review" as const
  };
}

describe("P0-v context delegation firewall", () => {
  it("blocks onward delegation when room access exists but delegation authority does not", async () => {
    const room = acceptedRoom();
    const executor = new LocalDelegationProofExecutor();

    expect(
      room.grants.some(
        (grant) => grant.capability === "DELEGATE_CONTEXT"
      )
    ).toBe(false);

    const result = await requestContextDelegation({
      room,
      actorParticipantId: "alice",
      message: message(room, "room-access-is-not-delegation"),
      executor
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("NOT_AUTHORIZED");
    expect(result.status.state).toBe("blocked");
    expect(result.status.errorCode).toBe("NOT_AUTHORIZED");
    expect(executor.invocations).toHaveLength(0);
  });

  it("permits only the local proof sink when an exact active delegation grant is fabricated for test", async () => {
    const base = acceptedRoom();
    const delegationGrant: GrantReceipt = {
      grantId: "delegate-context-alice",
      roomId: base.roomId,
      subjectParticipantId: "alice",
      capability: "DELEGATE_CONTEXT",
      issuerId: "test-authority",
      issuedAt: new Date().toISOString()
    };
    const room: RoomSnapshot = {
      ...base,
      grants: [...base.grants, delegationGrant]
    };
    const executor = new LocalDelegationProofExecutor();

    const wrongGrant = await requestContextDelegation({
      room,
      actorParticipantId: "alice",
      message: message(room, "wrong-grant"),
      executor
    });
    expect(wrongGrant.ok).toBe(false);
    expect(executor.invocations).toHaveLength(0);

    const authorized = await requestContextDelegation({
      room,
      actorParticipantId: "alice",
      message: message(room, delegationGrant.grantId),
      executor
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    expect(authorized.status.state).toBe("completed");
    expect(authorized.status.marker).toContain(
      "local-delegation-proof:delegation-1"
    );
    expect(executor.invocations).toHaveLength(1);
  });

  it("refuses to delegate context that is not already an accepted artifact", async () => {
    const base = acceptedRoom();
    const delegationGrant: GrantReceipt = {
      grantId: "delegate-context-alice",
      roomId: base.roomId,
      subjectParticipantId: "alice",
      capability: "DELEGATE_CONTEXT",
      issuerId: "test-authority",
      issuedAt: new Date().toISOString()
    };
    const room: RoomSnapshot = {
      ...base,
      grants: [...base.grants, delegationGrant]
    };
    const executor = new LocalDelegationProofExecutor();

    const result = await requestContextDelegation({
      room,
      actorParticipantId: "alice",
      message: {
        ...message(room, delegationGrant.grantId),
        artifactId: "unaccepted-context"
      },
      executor
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("ARTIFACT_NOT_FOUND");
    expect(executor.invocations).toHaveLength(0);
  });
});
