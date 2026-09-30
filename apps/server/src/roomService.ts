import type {
  AcceptArtifactMessage,
  Artifact,
  ClientMessage,
  RejectionCode,
  RoomEvent,
  RoomEventType,
  RoomSnapshot,
  SubmitWorkMessage,
  WorkItem
} from "@commonline/protocol";
import {
  acceptArtifact,
  createRoom,
  hasCapability,
  joinParticipant,
  leaveParticipant,
  proposeArtifact,
  submitWork
} from "@commonline/room-core";

interface RoomRecord {
  room: RoomSnapshot;
  events: RoomEvent[];
}

export type AcceptedIntent = {
  ok: true;
  room: RoomSnapshot;
  event: RoomEvent;
  work?: WorkItem;
};

export type RejectedIntent = {
  ok: false;
  code: RejectionCode;
  message: string;
  room?: RoomSnapshot;
};

export type IntentResult = AcceptedIntent | RejectedIntent;

function eventFor(input: {
  room: RoomSnapshot;
  type: RoomEventType;
  actorId: string;
  summary: string;
}): RoomEvent {
  return {
    id: `event-${crypto.randomUUID()}`,
    roomId: input.room.roomId,
    version: input.room.version,
    type: input.type,
    actorId: input.actorId,
    summary: input.summary,
    occurredAt: new Date().toISOString()
  };
}

export class RoomService {
  private readonly rooms = new Map<string, RoomRecord>();

  constructor(
    private readonly defaultPurpose = "Prove concurrent work + trustworthy resumption"
  ) {}

  getRoom(roomId: string) {
    return this.rooms.get(roomId)?.room;
  }

  canRelayRtc(roomId: string, actorId: string, targetClientId: string) {
    const record = this.rooms.get(roomId);
    if (!record) {
      return { ok: false as const, code: "ROOM_NOT_FOUND" as const, message: "The room does not exist." };
    }

    if (actorId === targetClientId) {
      return { ok: false as const, code: "INVALID_INTENT" as const, message: "A participant cannot call itself." };
    }

    const actor = record.room.participants.find(
      (item) => item.id === actorId && item.presence === "online"
    );
    const target = record.room.participants.find(
      (item) => item.id === targetClientId && item.presence === "online"
    );

    if (!actor) {
      return { ok: false as const, code: "INVALID_SESSION" as const, message: "The sender is not an online participant." };
    }
    if (!target) {
      return { ok: false as const, code: "PEER_UNAVAILABLE" as const, message: "The requested peer is not online in this room." };
    }
    if (!hasCapability(record.room, actorId, "SPEAK")) {
      return { ok: false as const, code: "NOT_AUTHORIZED" as const, message: "The sender has no SPEAK grant." };
    }
    if (!hasCapability(record.room, targetClientId, "RECEIVE_MEDIA")) {
      return { ok: false as const, code: "NOT_AUTHORIZED" as const, message: "The target has no RECEIVE_MEDIA grant." };
    }

    return { ok: true as const, room: record.room };
  }

  join(input: {
    roomId: string;
    clientId: string;
    name: string;
    acknowledgedVersion: number;
  }) {
    let record = this.rooms.get(input.roomId);
    if (!record) {
      record = {
        room: createRoom({
          roomId: input.roomId,
          purpose: this.defaultPurpose
        }),
        events: []
      };
      this.rooms.set(input.roomId, record);
    }

    const resumeDelta = record.events.filter(
      (event) => event.version > input.acknowledgedVersion
    );

    const priorVersion = record.room.version;
    const nextRoom = joinParticipant(record.room, {
      id: input.clientId,
      name: input.name
    });

    let event: RoomEvent | null = null;
    if (nextRoom.version !== priorVersion) {
      event = eventFor({
        room: nextRoom,
        type: "participant_joined",
        actorId: input.clientId,
        summary: `${input.name} joined the live episode.`
      });
      record.events.push(event);
      record.room = nextRoom;
    }

    return {
      room: record.room,
      resumeDelta,
      event
    };
  }

  leave(roomId: string, clientId: string) {
    const record = this.rooms.get(roomId);
    if (!record) return null;

    const participant = record.room.participants.find((item) => item.id === clientId);
    const priorVersion = record.room.version;
    const nextRoom = leaveParticipant(record.room, clientId);
    if (nextRoom.version === priorVersion) return null;

    const event = eventFor({
      room: nextRoom,
      type: "participant_left",
      actorId: clientId,
      summary: `${participant?.name ?? "A participant"} left the live episode.`
    });
    record.events.push(event);
    record.room = nextRoom;
    return { room: nextRoom, event };
  }

  applyIntent(actorId: string, intent: Exclude<ClientMessage, { type: "join_room" }>): IntentResult {
    const record = this.rooms.get(intent.roomId);
    if (!record) {
      return {
        ok: false,
        code: "ROOM_NOT_FOUND",
        message: "The room does not exist."
      };
    }

    const participant = record.room.participants.find(
      (item) => item.id === actorId && item.presence === "online"
    );
    if (!participant) {
      return {
        ok: false,
        code: "INVALID_SESSION",
        message: "The actor is not an online participant in this room.",
        room: record.room
      };
    }

    if (intent.baseVersion !== record.room.version) {
      return {
        ok: false,
        code: "STALE_VERSION",
        message: `Room advanced from v${intent.baseVersion} to v${record.room.version}. Reconcile before retrying.`,
        room: record.room
      };
    }

    if (intent.type === "submit_work") {
      return this.submitWork(record, actorId, intent);
    }

    return this.acceptArtifact(record, actorId, intent);
  }

  private submitWork(
    record: RoomRecord,
    actorId: string,
    intent: SubmitWorkMessage
  ): IntentResult {
    if (!hasCapability(record.room, actorId, "SUBMIT_WORK")) {
      return {
        ok: false,
        code: "NOT_AUTHORIZED",
        message: "This participant has no SUBMIT_WORK grant.",
        room: record.room
      };
    }

    const prompt = intent.prompt.trim();
    if (!prompt) {
      return {
        ok: false,
        code: "INVALID_INTENT",
        message: "A work request cannot be empty.",
        room: record.room
      };
    }

    const transition = submitWork(record.room, {
      requestedBy: actorId,
      prompt
    });
    const participant = record.room.participants.find((item) => item.id === actorId);
    const event = eventFor({
      room: transition.room,
      type: "work_submitted",
      actorId,
      summary: `${participant?.name ?? "A participant"} submitted bounded work.`
    });

    record.room = transition.room;
    record.events.push(event);
    return {
      ok: true,
      room: record.room,
      event,
      work: transition.work
    };
  }

  private acceptArtifact(
    record: RoomRecord,
    actorId: string,
    intent: AcceptArtifactMessage
  ): IntentResult {
    if (!hasCapability(record.room, actorId, "ACCEPT_OUTCOME")) {
      return {
        ok: false,
        code: "NOT_AUTHORIZED",
        message: "Only a participant with ACCEPT_OUTCOME authority may accept this artifact.",
        room: record.room
      };
    }

    const artifact = record.room.artifacts.find((item) => item.id === intent.artifactId);
    if (!artifact) {
      return {
        ok: false,
        code: "ARTIFACT_NOT_FOUND",
        message: "The proposed artifact does not exist.",
        room: record.room
      };
    }

    const priorVersion = record.room.version;
    const nextRoom = acceptArtifact(record.room, intent.artifactId);
    if (nextRoom.version === priorVersion) {
      return {
        ok: false,
        code: "INVALID_INTENT",
        message: "That artifact is already accepted.",
        room: record.room
      };
    }

    const event = eventFor({
      room: nextRoom,
      type: "artifact_accepted",
      actorId,
      summary: `Accepted artifact: ${artifact.title}`
    });
    record.room = nextRoom;
    record.events.push(event);

    return {
      ok: true,
      room: nextRoom,
      event
    };
  }

  proposeArtifact(roomId: string, artifact: Artifact): IntentResult {
    const record = this.rooms.get(roomId);
    if (!record) {
      return {
        ok: false,
        code: "ROOM_NOT_FOUND",
        message: "The room no longer exists."
      };
    }

    if (!hasCapability(record.room, "silent-agent", "WRITE_DRAFT_ARTIFACT")) {
      return {
        ok: false,
        code: "NOT_AUTHORIZED",
        message: "The silent worker has no WRITE_DRAFT_ARTIFACT grant.",
        room: record.room
      };
    }

    try {
      const nextRoom = proposeArtifact(record.room, artifact);
      const event = eventFor({
        room: nextRoom,
        type: "artifact_proposed",
        actorId: "silent-agent",
        summary: `Silent worker proposed artifact: ${artifact.title}`
      });
      record.room = nextRoom;
      record.events.push(event);
      return {
        ok: true,
        room: nextRoom,
        event
      };
    } catch (error) {
      return {
        ok: false,
        code: "INVALID_INTENT",
        message: error instanceof Error ? error.message : "Artifact proposal failed.",
        room: record.room
      };
    }
  }
}
