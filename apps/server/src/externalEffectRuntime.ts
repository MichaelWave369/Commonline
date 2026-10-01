import type {
  ExternalEffectStatusMessage,
  RequestExternalEffectMessage,
  RejectionCode,
  RoomSnapshot
} from "@commonline/protocol";

export interface ExternalEffectExecutor {
  execute(input: {
    roomId: string;
    actorParticipantId: string;
    effectRequestId: string;
    artifactId: string;
  }): Promise<{ marker: string }>;
}

export class LocalProofEffectExecutor implements ExternalEffectExecutor {
  readonly invocations: Array<{
    roomId: string;
    actorParticipantId: string;
    effectRequestId: string;
    artifactId: string;
  }> = [];

  async execute(input: {
    roomId: string;
    actorParticipantId: string;
    effectRequestId: string;
    artifactId: string;
  }) {
    this.invocations.push(input);
    return {
      marker: `local-proof:${input.effectRequestId}:${input.artifactId}`
    };
  }
}

function grantIsActive(
  room: RoomSnapshot,
  actorParticipantId: string,
  grantId: string
) {
  const grant = room.grants.find(
    (candidate) =>
      candidate.grantId === grantId &&
      candidate.subjectParticipantId === actorParticipantId &&
      candidate.capability === "EXECUTE_EXTERNAL_EFFECT"
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

function blockedStatus(
  input: RequestExternalEffectMessage,
  code: RejectionCode
): ExternalEffectStatusMessage {
  return {
    type: "external_effect_status",
    requestId: input.requestId,
    roomId: input.roomId,
    effectRequestId: input.effectRequestId,
    artifactId: input.artifactId,
    kind: input.kind,
    target: input.target,
    state: "blocked",
    authorityGrantId: input.authorityGrantId,
    errorCode: code
  };
}

export async function requestExternalEffect(input: {
  room: RoomSnapshot;
  actorParticipantId: string;
  message: RequestExternalEffectMessage;
  executor: ExternalEffectExecutor;
}): Promise<
  | {
      ok: true;
      status: ExternalEffectStatusMessage;
    }
  | {
      ok: false;
      code: RejectionCode;
      message: string;
      status: ExternalEffectStatusMessage;
    }
> {
  const { room, actorParticipantId, message, executor } = input;

  if (room.roomId !== message.roomId) {
    return {
      ok: false,
      code: "ROOM_NOT_FOUND",
      message: "The external-effect request is not bound to this room.",
      status: blockedStatus(message, "ROOM_NOT_FOUND")
    };
  }

  if (room.version !== message.baseVersion) {
    return {
      ok: false,
      code: "STALE_VERSION",
      message:
        "Room state changed before external-effect authorization. Reconcile before retrying.",
      status: blockedStatus(message, "STALE_VERSION")
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
        "External effects may only bind to an explicitly accepted artifact.",
      status: blockedStatus(message, "ARTIFACT_NOT_FOUND")
    };
  }

  if (
    !grantIsActive(
      room,
      actorParticipantId,
      message.authorityGrantId
    )
  ) {
    return {
      ok: false,
      code: "NOT_AUTHORIZED",
      message:
        "Accepted work does not authorize execution. An exact active EXECUTE_EXTERNAL_EFFECT grant is required.",
      status: blockedStatus(message, "NOT_AUTHORIZED")
    };
  }

  try {
    const executed = await executor.execute({
      roomId: room.roomId,
      actorParticipantId,
      effectRequestId: message.effectRequestId,
      artifactId: message.artifactId
    });

    return {
      ok: true,
      status: {
        type: "external_effect_status",
        requestId: message.requestId,
        roomId: message.roomId,
        effectRequestId: message.effectRequestId,
        artifactId: message.artifactId,
        kind: message.kind,
        target: message.target,
        state: "completed",
        authorityGrantId: message.authorityGrantId,
        marker: executed.marker
      }
    };
  } catch {
    return {
      ok: false,
      code: "INVALID_INTENT",
      message: "The local proof effect executor failed.",
      status: {
        type: "external_effect_status",
        requestId: message.requestId,
        roomId: message.roomId,
        effectRequestId: message.effectRequestId,
        artifactId: message.artifactId,
        kind: message.kind,
        target: message.target,
        state: "failed",
        authorityGrantId: message.authorityGrantId,
        errorCode: "INVALID_INTENT"
      }
    };
  }
}
