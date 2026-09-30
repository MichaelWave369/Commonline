import type {
  Artifact,
  Grant,
  Participant,
  ResumeSnapshot,
  WorkItem
} from "@commonline/protocol";

export interface RoomState {
  roomId: string;
  purpose: string;
  version: number;
  episodeActive: boolean;
  participants: Participant[];
  grants: Grant[];
  workItems: WorkItem[];
  artifacts: Artifact[];
  acceptedArtifactIds: string[];
  lastAcknowledged: ResumeSnapshot;
  lastResumeDelta: string[] | null;
}

function id(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function createRoom(input: {
  roomId: string;
  purpose: string;
  participantNames: string[];
}): RoomState {
  const participants: Participant[] = input.participantNames.map((name, index) => ({
    id: id("human"),
    name,
    kind: "human",
    role: index === 0 ? "room steward" : "participant"
  }));

  return {
    roomId: input.roomId,
    purpose: input.purpose,
    version: 1,
    episodeActive: true,
    participants,
    grants: [
      { principalId: "silent-agent", capability: "READ_SELECTED_CONTEXT", allowed: true },
      { principalId: "silent-agent", capability: "WRITE_DRAFT_ARTIFACT", allowed: true },
      { principalId: "silent-agent", capability: "SPEAK", allowed: false },
      { principalId: "silent-agent", capability: "EXECUTE_EXTERNAL_EFFECT", allowed: false }
    ],
    workItems: [],
    artifacts: [],
    acceptedArtifactIds: [],
    lastAcknowledged: {
      acknowledgedVersion: 1,
      acceptedArtifactIds: []
    },
    lastResumeDelta: null
  };
}

export function submitWork(
  room: RoomState,
  input: { requestedBy: string; prompt: string }
): RoomState {
  if (!room.episodeActive) {
    throw new Error("Cannot dispatch new work from a dormant episode.");
  }
  const work: WorkItem = {
    id: id("work"),
    requestedBy: input.requestedBy,
    prompt: input.prompt,
    status: "working",
    createdAt: new Date().toISOString()
  };
  return {
    ...room,
    workItems: [...room.workItems, work],
    version: room.version + 1,
    lastResumeDelta: null
  };
}

export function acceptArtifact(room: RoomState, artifactId: string): RoomState {
  const artifact = room.artifacts.find((a) => a.id === artifactId);
  if (!artifact) throw new Error("Artifact not found.");
  if (artifact.status === "accepted") return room;

  return {
    ...room,
    artifacts: room.artifacts.map((a) =>
      a.id === artifactId ? { ...a, status: "accepted" } : a
    ),
    acceptedArtifactIds: [...room.acceptedArtifactIds, artifactId],
    version: room.version + 1,
    lastResumeDelta: null
  };
}

export function leaveEpisode(room: RoomState): RoomState {
  return {
    ...room,
    episodeActive: false,
    lastAcknowledged: {
      acknowledgedVersion: room.version,
      acceptedArtifactIds: [...room.acceptedArtifactIds]
    },
    lastResumeDelta: null
  };
}

export function resumeRoom(room: RoomState): RoomState {
  const prior = new Set(room.lastAcknowledged.acceptedArtifactIds);
  const newlyAccepted = room.acceptedArtifactIds.filter((artifactId) => !prior.has(artifactId));
  const delta = newlyAccepted.map((artifactId) => {
    const artifact = room.artifacts.find((a) => a.id === artifactId);
    return `Accepted artifact: ${artifact?.title ?? artifactId}`;
  });

  return {
    ...room,
    episodeActive: true,
    version: room.version + 1,
    lastResumeDelta: delta
  };
}
