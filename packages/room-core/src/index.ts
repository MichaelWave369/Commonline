import {
  COMMONLINE_WIRE_SCHEMA_VERSION,
  type AcceptanceReceipt,
  type Artifact,
  type Capability,
  type GrantReceipt,
  type Participant,
  type RequestedHumanRole,
  type RoomSnapshot,
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
      receipt.revokedAt
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
      participant.kind === "human" && participant.role === "steward"
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
      !receipt.revokedAt &&
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
