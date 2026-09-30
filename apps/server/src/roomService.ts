import type {
  AcceptOutcomeMessage,
  AcceptanceReceipt,
  Artifact,
  RejectionCode,
  RequestedHumanRole,
  RoomEvent,
  RoomEventType,
  RoomSnapshot,
  SubmitWorkMessage,
  WorkItem
} from "@commonline/protocol";
import {
  acceptOutcome,
  createRoom,
  hasCapability,
  joinParticipant,
  leaveParticipant,
  proposeArtifact,
  SILENT_AGENT_PARTICIPANT_ID,
  submitWork
} from "@commonline/room-core";

interface RoomRecord {
  room: RoomSnapshot;
  events: RoomEvent[];
}

export type AcceptedIntent = {
  ok: true;
  room: RoomSnapshot;
  event?: RoomEvent;
  work?: WorkItem;
  acceptance?: AcceptanceReceipt;
  replayed?: boolean;
};

export type RejectedIntent = {
  ok: false;
  code: RejectionCode;
  message: string;
  room?: RoomSnapshot;
  canonicalAcceptance?: AcceptanceReceipt;
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

  getEventLog(roomId: string) {
    return [...(this.rooms.get(roomId)?.events ?? [])];
  }

  canRelayRtc(
    roomId: string,
    actorParticipantId: string,
    targetParticipantId: string
  ) {
    const record = this.rooms.get(roomId);
    if (!record) {
      return {
        ok: false as const,
        code: "ROOM_NOT_FOUND" as const,
        message: "The room does not exist."
      };
    }

    if (actorParticipantId === targetParticipantId) {
      return {
        ok: false as const,
        code: "INVALID_INTENT" as const,
        message: "A participant cannot call itself."
      };
    }

    const actor = record.room.participants.find(
      (item) =>
        item.id === actorParticipantId &&
        item.kind === "human" &&
        item.presence === "online"
    );
    const target = record.room.participants.find(
      (item) =>
        item.id === targetParticipantId &&
        item.kind === "human" &&
        item.presence === "online"
    );

    if (!actor) {
      return {
        ok: false as const,
        code: "INVALID_SESSION" as const,
        message: "The sender is not an online human participant."
      };
    }
    if (!target) {
      return {
        ok: false as const,
        code: "PEER_UNAVAILABLE" as const,
        message: "The requested peer is not online in this room."
      };
    }
    if (!hasCapability(record.room, actorParticipantId, "SPEAK")) {
      return {
        ok: false as const,
        code: "NOT_AUTHORIZED" as const,
        message: "The sender has no SPEAK grant."
      };
    }
    if (!hasCapability(record.room, targetParticipantId, "RECEIVE_MEDIA")) {
      return {
        ok: false as const,
        code: "NOT_AUTHORIZED" as const,
        message: "The target has no RECEIVE_MEDIA grant."
      };
    }

    return { ok: true as const, room: record.room };
  }

  join(input: {
    roomId: string;
    participantId: string;
    name: string;
    requestedRole: RequestedHumanRole;
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
      participantId: input.participantId,
      name: input.name,
      requestedRole: input.requestedRole
    });

    let event: RoomEvent | null = null;
    if (nextRoom.version !== priorVersion) {
      event = eventFor({
        room: nextRoom,
        type: "participant_joined",
        actorId: input.participantId,
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

  leave(roomId: string, participantId: string) {
    const record = this.rooms.get(roomId);
    if (!record) return null;

    const participant = record.room.participants.find(
      (item) => item.id === participantId
    );
    const priorVersion = record.room.version;
    const nextRoom = leaveParticipant(record.room, participantId);
    if (nextRoom.version === priorVersion) return null;

    const event = eventFor({
      room: nextRoom,
      type: "participant_left",
      actorId: participantId,
      summary: `${participant?.name ?? "A participant"} left the live episode.`
    });
    record.events.push(event);
    record.room = nextRoom;
    return { room: nextRoom, event };
  }

  applyIntent(
    actorParticipantId: string,
    intent: SubmitWorkMessage | AcceptOutcomeMessage
  ): IntentResult {
    const record = this.rooms.get(intent.roomId);
    if (!record) {
      return {
        ok: false,
        code: "ROOM_NOT_FOUND",
        message: "The room does not exist."
      };
    }

    const participant = record.room.participants.find(
      (item) =>
        item.id === actorParticipantId &&
        item.kind === "human" &&
        item.presence === "online"
    );
    if (!participant) {
      return {
        ok: false,
        code: "INVALID_SESSION",
        message: "The actor is not an online human participant in this room.",
        room: record.room
      };
    }

    // Idempotent acceptance replay must succeed even when the retry carries
    // the pre-commit room version from a connection that died after commit.
    if (intent.type === "accept_outcome") {
      const prior = record.room.acceptances.find(
        (receipt) => receipt.acceptId === intent.acceptId
      );
      if (prior) {
        return {
          ok: true,
          room: record.room,
          acceptance: prior,
          replayed: true
        };
      }
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
      return this.submitWork(record, actorParticipantId, intent);
    }

    return this.acceptOutcome(record, actorParticipantId, intent);
  }

  private submitWork(
    record: RoomRecord,
    actorParticipantId: string,
    intent: SubmitWorkMessage
  ): IntentResult {
    if (!hasCapability(record.room, actorParticipantId, "SUBMIT_WORK")) {
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
      requestedBy: actorParticipantId,
      prompt
    });
    const participant = record.room.participants.find(
      (item) => item.id === actorParticipantId
    );
    const event = eventFor({
      room: transition.room,
      type: "work_submitted",
      actorId: actorParticipantId,
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

  private acceptOutcome(
    record: RoomRecord,
    actorParticipantId: string,
    intent: AcceptOutcomeMessage
  ): IntentResult {
    const transition = acceptOutcome(record.room, {
      acceptId: intent.acceptId,
      workItemId: intent.workItemId,
      artifactId: intent.artifactId,
      actorParticipantId,
      authorityGrantId: intent.authorityGrantId
    });

    if (!transition.ok) {
      return {
        ok: false,
        code: transition.code,
        message: transition.message,
        room: record.room,
        canonicalAcceptance: transition.canonicalAcceptance
      };
    }

    if (transition.replayed) {
      return {
        ok: true,
        room: record.room,
        acceptance: transition.receipt,
        replayed: true
      };
    }

    const artifact = transition.room.artifacts.find(
      (candidate) => candidate.id === intent.artifactId
    );
    const event = eventFor({
      room: transition.room,
      type: "artifact_accepted",
      actorId: actorParticipantId,
      summary: `Accepted outcome for ${intent.workItemId}: ${artifact?.title ?? intent.artifactId}`
    });

    record.room = transition.room;
    record.events.push(event);

    return {
      ok: true,
      room: record.room,
      event,
      acceptance: transition.receipt,
      replayed: false
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

    if (
      !hasCapability(
        record.room,
        SILENT_AGENT_PARTICIPANT_ID,
        "WRITE_DRAFT_ARTIFACT"
      )
    ) {
      return {
        ok: false,
        code: "NOT_AUTHORIZED",
        message: "The silent worker has no WRITE_DRAFT_ARTIFACT grant.",
        room: record.room
      };
    }

    try {
      const nextRoom = proposeArtifact(record.room, {
        ...artifact,
        producedBy: SILENT_AGENT_PARTICIPANT_ID
      });
      const event = eventFor({
        room: nextRoom,
        type: "artifact_proposed",
        actorId: SILENT_AGENT_PARTICIPANT_ID,
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
        message:
          error instanceof Error ? error.message : "Artifact proposal failed.",
        room: record.room
      };
    }
  }
}
