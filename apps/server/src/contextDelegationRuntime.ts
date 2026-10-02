import type {
  ContextDelegationStatusMessage,
  RequestContextDelegationMessage,
  RejectionCode,
  RoomSnapshot
} from "@commonline/protocol";

export interface ContextDelegationExecutor {
  execute(input: {
    roomId: string;
    actorParticipantId: string;
    delegationRequestId: string;
    artifactId: string;
  }): Promise<{ marker: string }>;
}

export class LocalDelegationProofExecutor
  implements ContextDelegationExecutor
{
  readonly invocations: Array<{
    roomId: string;
    actorParticipantId: string;
    delegationRequestId: string;
    artifactId: string;
  }> = [];

  async execute(input: {
    roomId: string;
    actorParticipantId: string;
    delegationRequestId: string;
    artifactId: string;
  }) {
    this.invocations.push(input);
    return {
      marker:
        `local-delegation-proof:${input.delegationRequestId}:${input.artifactId}`
    };
  }
}

function activeDelegationGrant(
  room: RoomSnapshot,
  actorParticipantId: string,
  grantId: string
) {
  const grant = room.grants.find(
    (candidate) =>
      candidate.grantId === grantId &&
      candidate.subjectParticipantId === actorParticipantId &&
      candidate.capability === "DELEGATE_CONTEXT"
  );
  if (!grant) return false;

  const revoked =
    Boolean(grant.revokedAt) ||
    room.grantRevocations.some(
      (revocation) => revocation.grantId === grant.grantId
    );
  if (revoked) return false;

  return !grant.expiresAt || Date.parse(grant.expiresAt) > Date.now();
}

function blocked(
  input: RequestContextDelegationMessage,
  code: RejectionCode
): ContextDelegationStatusMessage {
  return {
    type: "context_delegation_status",
    requestId: input.requestId,
    roomId: input.roomId,
    delegationRequestId: input.delegationRequestId,
    artifactId: input.artifactId,
    kind: input.kind,
    target: input.target,
    purpose: input.purpose,
    state: "blocked",
    authorityGrantId: input.authorityGrantId,
    errorCode: code
  };
}

export async function requestContextDelegation(input: {
  room: RoomSnapshot;
  actorParticipantId: string;
  message: RequestContextDelegationMessage;
  executor: ContextDelegationExecutor;
}): Promise<
  | { ok: true; status: ContextDelegationStatusMessage }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      status: ContextDelegationStatusMessage;
    }
> {
  const { room, actorParticipantId, message, executor } = input;

  if (room.roomId !== message.roomId) {
    return {
      ok: false,
      code: "ROOM_NOT_FOUND",
      message: "The delegation request is not bound to this room.",
      status: blocked(message, "ROOM_NOT_FOUND")
    };
  }

  if (room.version !== message.baseVersion) {
    return {
      ok: false,
      code: "STALE_VERSION",
      message:
        "Room state changed before delegation authorization. Reconcile before retrying.",
      status: blocked(message, "STALE_VERSION")
    };
  }

  const accepted = room.acceptances.find(
    (receipt) => receipt.artifactId === message.artifactId
  );
  if (!accepted) {
    return {
      ok: false,
      code: "ARTIFACT_NOT_FOUND",
      message:
        "Delegation may only bind to explicitly accepted room context in P0-v.",
      status: blocked(message, "ARTIFACT_NOT_FOUND")
    };
  }

  if (
    !activeDelegationGrant(
      room,
      actorParticipantId,
      message.authorityGrantId
    )
  ) {
    return {
      ok: false,
      code: "NOT_AUTHORIZED",
      message:
        "Room access does not authorize onward delegation. An exact active DELEGATE_CONTEXT grant is required.",
      status: blocked(message, "NOT_AUTHORIZED")
    };
  }

  try {
    const executed = await executor.execute({
      roomId: room.roomId,
      actorParticipantId,
      delegationRequestId: message.delegationRequestId,
      artifactId: message.artifactId
    });
    return {
      ok: true,
      status: {
        type: "context_delegation_status",
        requestId: message.requestId,
        roomId: message.roomId,
        delegationRequestId: message.delegationRequestId,
        artifactId: message.artifactId,
        kind: message.kind,
        target: message.target,
        purpose: message.purpose,
        state: "completed",
        authorityGrantId: message.authorityGrantId,
        marker: executed.marker
      }
    };
  } catch {
    return {
      ok: false,
      code: "INVALID_INTENT",
      message: "The local delegation proof executor failed.",
      status: {
        type: "context_delegation_status",
        requestId: message.requestId,
        roomId: message.roomId,
        delegationRequestId: message.delegationRequestId,
        artifactId: message.artifactId,
        kind: message.kind,
        target: message.target,
        purpose: message.purpose,
        state: "failed",
        authorityGrantId: message.authorityGrantId,
        errorCode: "INVALID_INTENT"
      }
    };
  }
}
