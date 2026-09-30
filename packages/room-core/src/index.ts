import type {
  Artifact,
  Capability,
  Grant,
  Participant,
  RoomSnapshot,
  WorkItem
} from "@commonline/protocol";

export type RoomState = RoomSnapshot;

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createRoom(input: {
  roomId: string;
  purpose: string;
}): RoomState {
  return {
    roomId: input.roomId,
    purpose: input.purpose,
    version: 0,
    episodeActive: false,
    participants: [],
    grants: [
      { principalId: "silent-agent", capability: "READ_SELECTED_CONTEXT", allowed: true },
      { principalId: "silent-agent", capability: "WRITE_DRAFT_ARTIFACT", allowed: true },
      { principalId: "silent-agent", capability: "SPEAK", allowed: false },
      { principalId: "silent-agent", capability: "EXECUTE_EXTERNAL_EFFECT", allowed: false }
    ],
    workItems: [],
    artifacts: [],
    acceptedArtifactIds: []
  };
}

export function hasCapability(
  room: RoomState,
  principalId: string,
  capability: Capability
) {
  return room.grants.some(
    (grant) =>
      grant.principalId === principalId &&
      grant.capability === capability &&
      grant.allowed
  );
}

export function joinParticipant(
  room: RoomState,
  input: { id: string; name: string }
): RoomState {
  const existing = room.participants.find((participant) => participant.id === input.id);
  if (existing) {
    if (existing.presence === "online" && existing.name === input.name) return room;
    return {
      ...room,
      participants: room.participants.map((participant) =>
        participant.id === input.id
          ? { ...participant, name: input.name, presence: "online" }
          : participant
      ),
      episodeActive: true,
      version: room.version + 1
    };
  }

  const isFirstHuman = room.participants.length === 0;
  const participant: Participant = {
    id: input.id,
    name: input.name,
    kind: "human",
    role: isFirstHuman ? "room steward" : "participant",
    presence: "online"
  };

  const grants: Grant[] = [
    ...room.grants,
    { principalId: input.id, capability: "SUBMIT_WORK", allowed: true },
    { principalId: input.id, capability: "ACCEPT_OUTCOME", allowed: isFirstHuman }
  ];

  return {
    ...room,
    participants: [...room.participants, participant],
    grants,
    episodeActive: true,
    version: room.version + 1
  };
}

export function leaveParticipant(room: RoomState, participantId: string): RoomState {
  const existing = room.participants.find((participant) => participant.id === participantId);
  if (!existing || existing.presence === "offline") return room;

  const participants = room.participants.map((participant) =>
    participant.id === participantId
      ? { ...participant, presence: "offline" as const }
      : participant
  );

  return {
    ...room,
    participants,
    episodeActive: participants.some((participant) => participant.presence === "online"),
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

  return {
    ...room,
    workItems: room.workItems.map((item) =>
      item.id === work.id ? { ...item, status: "completed" as const } : item
    ),
    artifacts: [...room.artifacts, artifact],
    version: room.version + 1
  };
}

export function acceptArtifact(room: RoomState, artifactId: string): RoomState {
  const artifact = room.artifacts.find((candidate) => candidate.id === artifactId);
  if (!artifact) throw new Error("Artifact not found.");
  if (artifact.status === "accepted") return room;

  return {
    ...room,
    artifacts: room.artifacts.map((candidate) =>
      candidate.id === artifactId
        ? { ...candidate, status: "accepted" as const }
        : candidate
    ),
    acceptedArtifactIds: [...room.acceptedArtifactIds, artifactId],
    version: room.version + 1
  };
}
