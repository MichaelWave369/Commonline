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
  LocalProofEffectExecutor,
  requestExternalEffect
} from "./externalEffectRuntime";

function acceptedRoom(): RoomSnapshot {
  let room = joinParticipant(
    createRoom({
      roomId: "effect-room",
      purpose: "prove accepted work does not imply execution"
    }),
    {
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant"
    }
  );

  const work = submitWork(room, {
    requestedBy: "alice",
    prompt: "Prepare a harmless external-effect proof."
  });
  room = work.room;

  const proposed = proposeArtifact(room, {
    id: "artifact-proof",
    sourceWorkId: work.work.id,
    title: "Accepted proof artifact",
    body: "Acceptance is publication authority, not execution authority.",
    producedBy: "agent-vessie",
    status: "proposed",
    createdAt: new Date().toISOString()
  });
  room = proposed;

  const acceptGrant = room.grants.find(
    (grant) =>
      grant.subjectParticipantId === "alice" &&
      grant.capability === "ACCEPT_OUTCOME"
  )!;

  const accepted = acceptOutcome(room, {
    acceptId: "accept-proof",
    actorParticipantId: "alice",
    workItemId: work.work.id,
    artifactId: "artifact-proof",
    authorityGrantId: acceptGrant.grantId
  });
  if (!accepted.ok) throw new Error(accepted.message);

  return accepted.room;
}

function message(room: RoomSnapshot, authorityGrantId: string) {
  return {
    type: "request_external_effect" as const,
    requestId: "request-effect-1",
    roomId: room.roomId,
    baseVersion: room.version,
    effectRequestId: "effect-1",
    artifactId: "artifact-proof",
    authorityGrantId,
    kind: "demo-marker" as const,
    target: "local-proof-sink" as const
  };
}

describe("P0-u external effect firewall", () => {
  it("blocks an external effect after artifact acceptance when no execution grant exists", async () => {
    const room = acceptedRoom();
    const executor = new LocalProofEffectExecutor();

    expect(
      room.grants.some(
        (grant) => grant.capability === "EXECUTE_EXTERNAL_EFFECT"
      )
    ).toBe(false);

    const result = await requestExternalEffect({
      room,
      actorParticipantId: "alice",
      message: message(room, "acceptance-is-not-execution"),
      executor
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("NOT_AUTHORIZED");
    expect(result.status.state).toBe("blocked");
    expect(result.status.errorCode).toBe("NOT_AUTHORIZED");
    expect(executor.invocations).toHaveLength(0);
  });

  it("executes the harmless local proof sink only with the exact active execution grant", async () => {
    const base = acceptedRoom();
    const effectGrant: GrantReceipt = {
      grantId: "effect-grant-alice",
      roomId: base.roomId,
      subjectParticipantId: "alice",
      capability: "EXECUTE_EXTERNAL_EFFECT",
      issuerId: "test-authority",
      issuedAt: new Date().toISOString()
    };
    const room: RoomSnapshot = {
      ...base,
      grants: [...base.grants, effectGrant]
    };
    const executor = new LocalProofEffectExecutor();

    const wrongGrant = await requestExternalEffect({
      room,
      actorParticipantId: "alice",
      message: message(room, "wrong-grant"),
      executor
    });
    expect(wrongGrant.ok).toBe(false);
    expect(executor.invocations).toHaveLength(0);

    const authorized = await requestExternalEffect({
      room,
      actorParticipantId: "alice",
      message: message(room, effectGrant.grantId),
      executor
    });

    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;

    expect(authorized.status.state).toBe("completed");
    expect(authorized.status.marker).toContain("local-proof:effect-1");
    expect(executor.invocations).toHaveLength(1);
  });

  it("requires the effect to bind to an already accepted artifact", async () => {
    const base = acceptedRoom();
    const effectGrant: GrantReceipt = {
      grantId: "effect-grant-alice",
      roomId: base.roomId,
      subjectParticipantId: "alice",
      capability: "EXECUTE_EXTERNAL_EFFECT",
      issuerId: "test-authority",
      issuedAt: new Date().toISOString()
    };
    const room: RoomSnapshot = {
      ...base,
      grants: [...base.grants, effectGrant]
    };
    const executor = new LocalProofEffectExecutor();

    const result = await requestExternalEffect({
      room,
      actorParticipantId: "alice",
      message: {
        ...message(room, effectGrant.grantId),
        artifactId: "unaccepted-artifact"
      },
      executor
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe("ARTIFACT_NOT_FOUND");
    expect(executor.invocations).toHaveLength(0);
  });
});
