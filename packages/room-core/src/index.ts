import {
  COMMONLINE_WIRE_SCHEMA_VERSION,
  type AcceptanceReceipt,
  type AgentVoiceGrantReceipt,
  type AgentVoiceRevocationReceipt,
  type Artifact,
  type AuthorityTransferReceipt,
  type Capability,
  type GrantReceipt,
  type GrantRevocationReceipt,
  type Participant,
  type RequestedHumanRole,
  type RoomSnapshot,
  type VoiceAuthorityBootstrapReceipt,
  type WorkItem
} from "@commonline/protocol";

export type RoomState = RoomSnapshot;

const SYSTEM_ISSUER_ID = "commonline-room-service";
export const SILENT_AGENT_PARTICIPANT_ID = "agent-vessie";

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function grant(input: {
  roomId: string;
  subjectParticipantId: string;
  capability: Capability;
  issuerId?: string;
}): GrantReceipt {
  return {
    grantId: id("grant"),
    roomId: input.roomId,
    subjectParticipantId: input.subjectParticipantId,
    capability: input.capability,
    issuerId: input.issuerId ?? SYSTEM_ISSUER_ID,
    issuedAt: new Date().toISOString()
  };
}

function grantIsRevoked(room: RoomState, grantId: string) {
  const grantReceipt = room.grants.find((receipt) => receipt.grantId === grantId);
  if (grantReceipt?.revokedAt) return true;
  return room.grantRevocations.some((receipt) => receipt.grantId === grantId);
}

export function createRoom(input: {
  roomId: string;
  purpose: string;
}): RoomState {
  const silentAgent: Participant = {
    id: SILENT_AGENT_PARTICIPANT_ID,
    name: "Vessie",
    kind: "agent",
    role: "silent-worker",
    presence: "online"
  };

  return {
    schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
    roomId: input.roomId,
    purpose: input.purpose,
    version: 0,
    episodeActive: false,
    participants: [silentAgent],
    grants: [
      grant({
        roomId: input.roomId,
        subjectParticipantId: SILENT_AGENT_PARTICIPANT_ID,
        capability: "READ_SELECTED_CONTEXT"
      }),
      grant({
        roomId: input.roomId,
        subjectParticipantId: SILENT_AGENT_PARTICIPANT_ID,
        capability: "WRITE_DRAFT_ARTIFACT"
      })
    ],
    grantRevocations: [],
    authorityTransfers: [],
    voiceAuthorityBootstraps: [],
    agentVoiceGrants: [],
    agentVoiceRevocations: [],
    workItems: [],
    artifacts: [],
    acceptances: []
  };
}

export function activeGrant(
  room: RoomState,
  participantId: string,
  capability: Capability
) {
  const now = Date.now();
  return room.grants.find((receipt) => {
    if (
      receipt.subjectParticipantId !== participantId ||
      receipt.capability !== capability ||
      grantIsRevoked(room, receipt.grantId)
    ) {
      return false;
    }
    return !receipt.expiresAt || Date.parse(receipt.expiresAt) > now;
  });
}

export function hasCapability(
  room: RoomState,
  participantId: string,
  capability: Capability
) {
  return Boolean(activeGrant(room, participantId, capability));
}

export function joinParticipant(
  room: RoomState,
  input: {
    participantId: string;
    name: string;
    requestedRole: RequestedHumanRole;
  }
): RoomState {
  const existing = room.participants.find(
    (participant) => participant.id === input.participantId
  );

  if (existing) {
    if (existing.kind !== "human") {
      throw new Error("Participant identity is already reserved by a non-human principal.");
    }

    if (existing.presence === "online" && existing.name === input.name) {
      return room;
    }

    return {
      ...room,
      participants: room.participants.map((participant) =>
        participant.id === input.participantId
          ? { ...participant, name: input.name, presence: "online" }
          : participant
      ),
      episodeActive: true,
      version: room.version + 1
    };
  }

  const stewardExists = room.participants.some(
    (participant) =>
      participant.kind === "human" &&
      participant.role === "steward" &&
      hasCapability(room, participant.id, "ACCEPT_OUTCOME")
  );

  const role =
    input.requestedRole === "observer"
      ? "observer"
      : stewardExists
        ? "participant"
        : "steward";

  const participant: Participant = {
    id: input.participantId,
    name: input.name,
    kind: "human",
    role,
    presence: "online"
  };

  const grants: GrantReceipt[] = [
    ...room.grants,
    grant({
      roomId: room.roomId,
      subjectParticipantId: input.participantId,
      capability: "READ_ROOM_STATE"
    })
  ];

  if (role !== "observer") {
    grants.push(
      grant({
        roomId: room.roomId,
        subjectParticipantId: input.participantId,
        capability: "SUBMIT_WORK"
      }),
      grant({
        roomId: room.roomId,
        subjectParticipantId: input.participantId,
        capability: "RECEIVE_MEDIA"
      }),
      grant({
        roomId: room.roomId,
        subjectParticipantId: input.participantId,
        capability: "SPEAK"
      })
    );
  }

  if (role === "steward") {
    grants.push(
      grant({
        roomId: room.roomId,
        subjectParticipantId: input.participantId,
        capability: "ACCEPT_OUTCOME"
      })
    );
  }

  return {
    ...room,
    participants: [...room.participants, participant],
    grants,
    episodeActive: true,
    version: room.version + 1
  };
}

export function leaveParticipant(room: RoomState, participantId: string): RoomState {
  const existing = room.participants.find(
    (participant) => participant.id === participantId
  );
  if (!existing || existing.kind !== "human" || existing.presence === "offline") {
    return room;
  }

  const participants = room.participants.map((participant) =>
    participant.id === participantId
      ? { ...participant, presence: "offline" as const }
      : participant
  );

  return {
    ...room,
    participants,
    episodeActive: participants.some(
      (participant) =>
        participant.kind === "human" && participant.presence === "online"
    ),
    version: room.version + 1
  };
}

export function submitWork(
  room: RoomState,
  input: { requestedBy: string; prompt: string }
): { room: RoomState; work: WorkItem } {
  if (!room.episodeActive) {
    throw new Error("Cannot dispatch new work from a dormant room.");
  }

  const work: WorkItem = {
    id: id("work"),
    requestedBy: input.requestedBy,
    prompt: input.prompt,
    status: "working",
    createdAt: new Date().toISOString()
  };

  return {
    room: {
      ...room,
      workItems: [...room.workItems, work],
      version: room.version + 1
    },
    work
  };
}

export function proposeArtifact(
  room: RoomState,
  artifact: Artifact
): RoomState {
  const work = room.workItems.find((item) => item.id === artifact.sourceWorkId);
  if (!work) throw new Error("Source work item not found.");

  if (room.artifacts.some((candidate) => candidate.id === artifact.id)) {
    return room;
  }

  return {
    ...room,
    workItems: room.workItems.map((item) =>
      item.id === work.id ? { ...item, status: "proposed" as const } : item
    ),
    artifacts: [...room.artifacts, artifact],
    version: room.version + 1
  };
}

export type AcceptOutcomeResult =
  | {
      ok: true;
      room: RoomState;
      receipt: AcceptanceReceipt;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "ARTIFACT_NOT_FOUND"
        | "WORK_ITEM_NOT_FOUND"
        | "GRANT_NOT_FOUND"
        | "OUTCOME_ALREADY_ACCEPTED";
      message: string;
      canonicalAcceptance?: AcceptanceReceipt;
    };

export function acceptOutcome(
  room: RoomState,
  input: {
    acceptId: string;
    workItemId: string;
    artifactId: string;
    actorParticipantId: string;
    authorityGrantId: string;
  }
): AcceptOutcomeResult {
  const priorByAcceptId = room.acceptances.find(
    (receipt) => receipt.acceptId === input.acceptId
  );
  if (priorByAcceptId) {
    return {
      ok: true,
      room,
      receipt: priorByAcceptId,
      replayed: true
    };
  }

  const work = room.workItems.find((item) => item.id === input.workItemId);
  if (!work) {
    return {
      ok: false,
      code: "WORK_ITEM_NOT_FOUND",
      message: "The work item does not exist."
    };
  }

  const artifact = room.artifacts.find(
    (candidate) => candidate.id === input.artifactId
  );
  if (!artifact || artifact.sourceWorkId !== work.id) {
    return {
      ok: false,
      code: "ARTIFACT_NOT_FOUND",
      message: "The proposed artifact does not belong to the supplied work item."
    };
  }

  const canonicalAcceptance = room.acceptances.find(
    (receipt) => receipt.workItemId === work.id
  );
  if (canonicalAcceptance) {
    return {
      ok: false,
      code: "OUTCOME_ALREADY_ACCEPTED",
      message: "This work item already has a canonical accepted outcome.",
      canonicalAcceptance
    };
  }

  const authorityGrant = room.grants.find(
    (receipt) =>
      receipt.grantId === input.authorityGrantId &&
      receipt.subjectParticipantId === input.actorParticipantId &&
      receipt.capability === "ACCEPT_OUTCOME" &&
      !grantIsRevoked(room, receipt.grantId) &&
      (!receipt.expiresAt || Date.parse(receipt.expiresAt) > Date.now())
  );

  if (!authorityGrant) {
    return {
      ok: false,
      code: "GRANT_NOT_FOUND",
      message: "The supplied ACCEPT_OUTCOME grant receipt is missing, expired, revoked, or belongs to another participant."
    };
  }

  const committedVersion = room.version + 1;
  const receipt: AcceptanceReceipt = {
    receiptId: id("acceptance"),
    acceptId: input.acceptId,
    roomId: room.roomId,
    workItemId: work.id,
    artifactId: artifact.id,
    actorParticipantId: input.actorParticipantId,
    authorityGrantId: authorityGrant.grantId,
    committedVersion,
    acceptedAt: new Date().toISOString()
  };

  return {
    ok: true,
    replayed: false,
    receipt,
    room: {
      ...room,
      workItems: room.workItems.map((item) =>
        item.id === work.id ? { ...item, status: "accepted" as const } : item
      ),
      artifacts: room.artifacts.map((candidate) =>
        candidate.id === artifact.id
          ? { ...candidate, status: "accepted" as const }
          : candidate
      ),
      acceptances: [...room.acceptances, receipt],
      version: committedVersion
    }
  };
}

export type TransferAcceptAuthorityResult =
  | {
      ok: true;
      room: RoomState;
      receipt: AuthorityTransferReceipt;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "GRANT_NOT_FOUND"
        | "TRANSFER_TARGET_INVALID"
        | "TRANSFER_ALREADY_APPLIED";
      message: string;
      canonicalTransfer?: AuthorityTransferReceipt;
    };

export function transferAcceptAuthority(
  room: RoomState,
  input: {
    transferId: string;
    actorParticipantId: string;
    targetParticipantId: string;
    authorityGrantId: string;
  }
): TransferAcceptAuthorityResult {
  const prior = room.authorityTransfers.find(
    (receipt) => receipt.transferId === input.transferId
  );
  if (prior) {
    return {
      ok: true,
      room,
      receipt: prior,
      replayed: true
    };
  }

  const target = room.participants.find(
    (participant) =>
      participant.id === input.targetParticipantId &&
      participant.kind === "human"
  );

  if (
    !target ||
    target.role === "observer" ||
    target.id === input.actorParticipantId
  ) {
    return {
      ok: false,
      code: "TRANSFER_TARGET_INVALID",
      message: "ACCEPT_OUTCOME can only transfer to a different non-observer human participant."
    };
  }

  const authorityGrant = room.grants.find(
    (receipt) =>
      receipt.grantId === input.authorityGrantId &&
      receipt.subjectParticipantId === input.actorParticipantId &&
      receipt.capability === "ACCEPT_OUTCOME" &&
      !grantIsRevoked(room, receipt.grantId) &&
      (!receipt.expiresAt || Date.parse(receipt.expiresAt) > Date.now())
  );

  if (!authorityGrant) {
    return {
      ok: false,
      code: "GRANT_NOT_FOUND",
      message: "The supplied ACCEPT_OUTCOME grant is not active for the transferring participant."
    };
  }

  const canonicalForGrant = room.authorityTransfers.find(
    (receipt) => receipt.revokedGrantId === authorityGrant.grantId
  );
  if (canonicalForGrant) {
    return {
      ok: false,
      code: "TRANSFER_ALREADY_APPLIED",
      message: "That authority grant has already been transferred.",
      canonicalTransfer: canonicalForGrant
    };
  }

  const transferredAt = new Date().toISOString();
  const revocation: GrantRevocationReceipt = {
    revocationId: id("grant-revocation"),
    roomId: room.roomId,
    grantId: authorityGrant.grantId,
    revokedByParticipantId: input.actorParticipantId,
    reason: "authority-transfer",
    revokedAt: transferredAt
  };

  const issuedGrant = grant({
    roomId: room.roomId,
    subjectParticipantId: target.id,
    capability: "ACCEPT_OUTCOME",
    issuerId: input.actorParticipantId
  });

  const committedVersion = room.version + 1;
  const receipt: AuthorityTransferReceipt = {
    transferReceiptId: id("authority-transfer"),
    transferId: input.transferId,
    roomId: room.roomId,
    fromParticipantId: input.actorParticipantId,
    toParticipantId: target.id,
    revokedGrantId: authorityGrant.grantId,
    revocationReceiptId: revocation.revocationId,
    issuedGrantId: issuedGrant.grantId,
    committedVersion,
    transferredAt
  };

  return {
    ok: true,
    replayed: false,
    receipt,
    room: {
      ...room,
      version: committedVersion,
      participants: room.participants.map((participant) => {
        if (participant.id === input.actorParticipantId) {
          return { ...participant, role: "participant" as const };
        }
        if (participant.id === target.id) {
          return { ...participant, role: "steward" as const };
        }
        return participant;
      }),
      grants: [...room.grants, issuedGrant],
      grantRevocations: [...room.grantRevocations, revocation],
      authorityTransfers: [...room.authorityTransfers, receipt]
    }
  };
}


export function activeAgentVoiceGrant(
  room: RoomState,
  agentParticipantId: string
) {
  const now = Date.now();
  return room.agentVoiceGrants.find((receipt) => {
    if (receipt.agentParticipantId !== agentParticipantId) return false;
    if (
      room.agentVoiceRevocations.some(
        (revocation) => revocation.voiceGrantId === receipt.voiceGrantId
      )
    ) {
      return false;
    }
    return !receipt.expiresAt || Date.parse(receipt.expiresAt) > now;
  });
}

export type BootstrapAgentVoiceAuthorityResult =
  | {
      ok: true;
      room: RoomState;
      receipt: VoiceAuthorityBootstrapReceipt;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "GRANT_NOT_FOUND"
        | "VOICE_AUTHORITY_ALREADY_BOOTSTRAPPED";
      message: string;
      canonicalBootstrap?: VoiceAuthorityBootstrapReceipt;
    };

export function bootstrapAgentVoiceAuthority(
  room: RoomState,
  input: {
    bootstrapId: string;
    actorParticipantId: string;
    acceptAuthorityGrantId: string;
  }
): BootstrapAgentVoiceAuthorityResult {
  const prior = room.voiceAuthorityBootstraps.find(
    (receipt) => receipt.bootstrapId === input.bootstrapId
  );
  if (prior) {
    return {
      ok: true,
      room,
      receipt: prior,
      replayed: true
    };
  }

  const canonical = room.voiceAuthorityBootstraps[0];
  if (canonical) {
    return {
      ok: false,
      code: "VOICE_AUTHORITY_ALREADY_BOOTSTRAPPED",
      message:
        "Agent voice management authority has already been bootstrapped for this room.",
      canonicalBootstrap: canonical
    };
  }

  const acceptGrant = room.grants.find(
    (receipt) =>
      receipt.grantId === input.acceptAuthorityGrantId &&
      receipt.subjectParticipantId === input.actorParticipantId &&
      receipt.capability === "ACCEPT_OUTCOME" &&
      !grantIsRevoked(room, receipt.grantId) &&
      (!receipt.expiresAt || Date.parse(receipt.expiresAt) > Date.now())
  );

  if (!acceptGrant) {
    return {
      ok: false,
      code: "GRANT_NOT_FOUND",
      message:
        "Bootstrapping agent voice authority requires the actor's exact active ACCEPT_OUTCOME grant."
    };
  }

  const managementGrant = grant({
    roomId: room.roomId,
    subjectParticipantId: input.actorParticipantId,
    capability: "MANAGE_AGENT_VOICE",
    issuerId: SYSTEM_ISSUER_ID
  });

  const committedVersion = room.version + 1;
  const receipt: VoiceAuthorityBootstrapReceipt = {
    bootstrapReceiptId: id("voice-authority-bootstrap"),
    bootstrapId: input.bootstrapId,
    roomId: room.roomId,
    actorParticipantId: input.actorParticipantId,
    acceptAuthorityGrantId: acceptGrant.grantId,
    issuedGrantId: managementGrant.grantId,
    committedVersion,
    bootstrappedAt: new Date().toISOString()
  };

  return {
    ok: true,
    replayed: false,
    receipt,
    room: {
      ...room,
      version: committedVersion,
      grants: [...room.grants, managementGrant],
      voiceAuthorityBootstraps: [
        ...room.voiceAuthorityBootstraps,
        receipt
      ]
    }
  };
}

export type GrantAgentVoiceResult =
  | {
      ok: true;
      room: RoomState;
      receipt: AgentVoiceGrantReceipt;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "GRANT_NOT_FOUND"
        | "VOICE_TARGET_INVALID"
        | "VOICE_GRANT_ALREADY_ACTIVE";
      message: string;
      canonicalGrant?: AgentVoiceGrantReceipt;
    };

export function grantAgentVoice(
  room: RoomState,
  input: {
    grantRequestId: string;
    actorParticipantId: string;
    agentParticipantId: string;
    voiceId: string;
    authorityGrantId: string;
    expiresAt?: string;
  }
): GrantAgentVoiceResult {
  const prior = room.agentVoiceGrants.find(
    (receipt) => receipt.grantRequestId === input.grantRequestId
  );
  if (prior) {
    return {
      ok: true,
      room,
      receipt: prior,
      replayed: true
    };
  }

  const target = room.participants.find(
    (participant) =>
      participant.id === input.agentParticipantId &&
      participant.kind === "agent"
  );
  if (!target) {
    return {
      ok: false,
      code: "VOICE_TARGET_INVALID",
      message: "Agent voice can only be granted to an agent participant."
    };
  }

  const authorityGrant = room.grants.find(
    (receipt) =>
      receipt.grantId === input.authorityGrantId &&
      receipt.subjectParticipantId === input.actorParticipantId &&
      receipt.capability === "MANAGE_AGENT_VOICE" &&
      !grantIsRevoked(room, receipt.grantId) &&
      (!receipt.expiresAt || Date.parse(receipt.expiresAt) > Date.now())
  );

  if (!authorityGrant) {
    return {
      ok: false,
      code: "GRANT_NOT_FOUND",
      message:
        "Granting agent voice requires the actor's exact active MANAGE_AGENT_VOICE grant."
    };
  }

  const active = activeAgentVoiceGrant(room, target.id);
  if (active) {
    return {
      ok: false,
      code: "VOICE_GRANT_ALREADY_ACTIVE",
      message:
        "The target agent already has an active voice grant. Revoke it before issuing another.",
      canonicalGrant: active
    };
  }

  const committedVersion = room.version + 1;
  const receipt: AgentVoiceGrantReceipt = {
    voiceGrantId: id("agent-voice-grant"),
    grantRequestId: input.grantRequestId,
    roomId: room.roomId,
    agentParticipantId: target.id,
    voiceId: input.voiceId,
    audienceMode: "explicit-subscription",
    issuedByParticipantId: input.actorParticipantId,
    authorityGrantId: authorityGrant.grantId,
    issuedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    committedVersion
  };

  return {
    ok: true,
    replayed: false,
    receipt,
    room: {
      ...room,
      version: committedVersion,
      agentVoiceGrants: [...room.agentVoiceGrants, receipt]
    }
  };
}

export type RevokeAgentVoiceResult =
  | {
      ok: true;
      room: RoomState;
      receipt: AgentVoiceRevocationReceipt;
      replayed: boolean;
    }
  | {
      ok: false;
      code:
        | "GRANT_NOT_FOUND"
        | "VOICE_GRANT_NOT_FOUND"
        | "VOICE_GRANT_ALREADY_REVOKED";
      message: string;
      canonicalRevocation?: AgentVoiceRevocationReceipt;
    };

export function revokeAgentVoice(
  room: RoomState,
  input: {
    revokeRequestId: string;
    actorParticipantId: string;
    voiceGrantId: string;
    authorityGrantId: string;
  }
): RevokeAgentVoiceResult {
  const prior = room.agentVoiceRevocations.find(
    (receipt) => receipt.revokeRequestId === input.revokeRequestId
  );
  if (prior) {
    return {
      ok: true,
      room,
      receipt: prior,
      replayed: true
    };
  }

  const voiceGrant = room.agentVoiceGrants.find(
    (receipt) => receipt.voiceGrantId === input.voiceGrantId
  );
  if (!voiceGrant) {
    return {
      ok: false,
      code: "VOICE_GRANT_NOT_FOUND",
      message: "The requested agent voice grant does not exist."
    };
  }

  const canonical = room.agentVoiceRevocations.find(
    (receipt) => receipt.voiceGrantId === input.voiceGrantId
  );
  if (canonical) {
    return {
      ok: false,
      code: "VOICE_GRANT_ALREADY_REVOKED",
      message: "That agent voice grant has already been revoked.",
      canonicalRevocation: canonical
    };
  }

  const authorityGrant = room.grants.find(
    (receipt) =>
      receipt.grantId === input.authorityGrantId &&
      receipt.subjectParticipantId === input.actorParticipantId &&
      receipt.capability === "MANAGE_AGENT_VOICE" &&
      !grantIsRevoked(room, receipt.grantId) &&
      (!receipt.expiresAt || Date.parse(receipt.expiresAt) > Date.now())
  );

  if (!authorityGrant) {
    return {
      ok: false,
      code: "GRANT_NOT_FOUND",
      message:
        "Revoking agent voice requires the actor's exact active MANAGE_AGENT_VOICE grant."
    };
  }

  const committedVersion = room.version + 1;
  const receipt: AgentVoiceRevocationReceipt = {
    voiceRevocationId: id("agent-voice-revocation"),
    revokeRequestId: input.revokeRequestId,
    roomId: room.roomId,
    voiceGrantId: voiceGrant.voiceGrantId,
    revokedByParticipantId: input.actorParticipantId,
    authorityGrantId: authorityGrant.grantId,
    reason: "manual",
    revokedAt: new Date().toISOString(),
    committedVersion
  };

  return {
    ok: true,
    replayed: false,
    receipt,
    room: {
      ...room,
      version: committedVersion,
      agentVoiceRevocations: [
        ...room.agentVoiceRevocations,
        receipt
      ]
    }
  };
}
