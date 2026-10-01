import type {
  AcceptOutcomeMessage,
  AcceptanceReceipt,
  AgentVoiceGrantReceipt,
  AgentVoiceRevocationReceipt,
  Artifact,
  AuthorityTransferReceipt,
  BootstrapAgentVoiceAuthorityMessage,
  RejectionCode,
  RequestedHumanRole,
  RoomEvent,
  RoomEventType,
  RoomSnapshot,
  GrantAgentVoiceMessage,
  RevokeAgentVoiceMessage,
  SubmitWorkMessage,
  TransferAcceptAuthorityMessage,
  VoiceAuthorityBootstrapReceipt,
  WorkItem
} from "@commonline/protocol";
import {
  acceptOutcome,
  bootstrapAgentVoiceAuthority,
  createRoom,
  grantAgentVoice,
  hasCapability,
  joinParticipant,
  leaveParticipant,
  proposeArtifact,
  revokeAgentVoice,
  SILENT_AGENT_PARTICIPANT_ID,
  submitWork,
  transferAcceptAuthority
} from "@commonline/room-core";
import type { DurableRoomStore } from "./roomStore";

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
  authorityTransfer?: AuthorityTransferReceipt;
  voiceAuthorityBootstrap?: VoiceAuthorityBootstrapReceipt;
  agentVoiceGrant?: AgentVoiceGrantReceipt;
  agentVoiceRevocation?: AgentVoiceRevocationReceipt;
  replayed?: boolean;
};

export type RejectedIntent = {
  ok: false;
  code: RejectionCode;
  message: string;
  room?: RoomSnapshot;
  canonicalAcceptance?: AcceptanceReceipt;
  canonicalTransfer?: AuthorityTransferReceipt;
  canonicalVoiceBootstrap?: VoiceAuthorityBootstrapReceipt;
  canonicalVoiceGrant?: AgentVoiceGrantReceipt;
  canonicalVoiceRevocation?: AgentVoiceRevocationReceipt;
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
    private readonly defaultPurpose = "Prove concurrent work + trustworthy resumption",
    private readonly store?: DurableRoomStore
  ) {}

  private record(roomId: string) {
    const cached = this.rooms.get(roomId);
    if (cached) return cached;

    const persistedRoom = this.store?.loadRoom(roomId);
    if (!persistedRoom) return undefined;

    const loaded: RoomRecord = {
      room: persistedRoom,
      events: this.store?.loadEvents(roomId) ?? []
    };
    this.rooms.set(roomId, loaded);
    return loaded;
  }

  private commitTransition(
    record: RoomRecord,
    nextRoom: RoomSnapshot,
    event: RoomEvent,
    expectedPreviousVersion: number
  ) {
    // Disk first, memory second. A failed SQLite transaction must never leave
    // the process believing a transition committed when durable state did not.
    this.store?.saveTransition({
      room: nextRoom,
      event,
      expectedPreviousVersion
    });

    record.room = nextRoom;
    record.events.push(event);
  }

  getRoom(roomId: string) {
    return this.record(roomId)?.room;
  }

  getEventLog(roomId: string) {
    return [...(this.record(roomId)?.events ?? [])];
  }

  canRelayRtc(
    roomId: string,
    actorParticipantId: string,
    targetParticipantId: string
  ) {
    const record = this.record(roomId);
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
    let record = this.record(input.roomId);
    const created = !record;

    if (!record) {
      record = {
        room: createRoom({
          roomId: input.roomId,
          purpose: this.defaultPurpose
        }),
        events: []
      };
    }

    const knownParticipant = record.room.participants.some(
      (participant) => participant.id === input.participantId
    );
    const firstMembershipEvent = knownParticipant
      ? record.events.find(
          (event) =>
            event.type === "participant_joined" &&
            event.actorId === input.participantId
        )
      : undefined;

    // P0-s history floor: first membership does not inherit the room's
    // pre-membership event history. A reconnecting participant cannot rewind
    // acknowledgement to zero to escape that floor.
    const historyFloorVersion = firstMembershipEvent?.version;
    const resumeAfterVersion =
      historyFloorVersion === undefined
        ? input.acknowledgedVersion
        : Math.max(input.acknowledgedVersion, historyFloorVersion - 1);
    const resumeDelta = knownParticipant
      ? record.events.filter(
          (event) => event.version > resumeAfterVersion
        )
      : [];

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

      this.commitTransition(record, nextRoom, event, priorVersion);
    }

    if (created) {
      this.rooms.set(input.roomId, record);
    }

    return {
      room: record.room,
      resumeDelta,
      event
    };
  }

  leave(roomId: string, participantId: string) {
    const record = this.record(roomId);
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

    this.commitTransition(record, nextRoom, event, priorVersion);
    return { room: nextRoom, event };
  }

  applyIntent(
    actorParticipantId: string,
    intent:
      | SubmitWorkMessage
      | AcceptOutcomeMessage
      | TransferAcceptAuthorityMessage
      | BootstrapAgentVoiceAuthorityMessage
      | GrantAgentVoiceMessage
      | RevokeAgentVoiceMessage
  ): IntentResult {
    const record = this.record(intent.roomId);
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

    // Idempotent receipts are checked before stale-version rejection. If the
    // process died after SQLite COMMIT but before the response reached the
    // browser, retrying the same stable id returns the original receipt.
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

    if (intent.type === "transfer_accept_authority") {
      const prior = record.room.authorityTransfers.find(
        (receipt) => receipt.transferId === intent.transferId
      );
      if (prior) {
        return {
          ok: true,
          room: record.room,
          authorityTransfer: prior,
          replayed: true
        };
      }
    }

    if (intent.type === "bootstrap_agent_voice_authority") {
      const prior = record.room.voiceAuthorityBootstraps.find(
        (receipt) => receipt.bootstrapId === intent.bootstrapId
      );
      if (prior) {
        return {
          ok: true,
          room: record.room,
          voiceAuthorityBootstrap: prior,
          replayed: true
        };
      }
    }

    if (intent.type === "grant_agent_voice") {
      const prior = record.room.agentVoiceGrants.find(
        (receipt) => receipt.grantRequestId === intent.grantRequestId
      );
      if (prior) {
        return {
          ok: true,
          room: record.room,
          agentVoiceGrant: prior,
          replayed: true
        };
      }
    }

    if (intent.type === "revoke_agent_voice") {
      const prior = record.room.agentVoiceRevocations.find(
        (receipt) => receipt.revokeRequestId === intent.revokeRequestId
      );
      if (prior) {
        return {
          ok: true,
          room: record.room,
          agentVoiceRevocation: prior,
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

    if (intent.type === "transfer_accept_authority") {
      return this.transferAcceptAuthority(
        record,
        actorParticipantId,
        intent
      );
    }

    if (intent.type === "bootstrap_agent_voice_authority") {
      return this.bootstrapAgentVoiceAuthority(
        record,
        actorParticipantId,
        intent
      );
    }

    if (intent.type === "grant_agent_voice") {
      return this.grantAgentVoice(
        record,
        actorParticipantId,
        intent
      );
    }

    if (intent.type === "revoke_agent_voice") {
      return this.revokeAgentVoice(
        record,
        actorParticipantId,
        intent
      );
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

    const priorVersion = record.room.version;
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

    this.commitTransition(
      record,
      transition.room,
      event,
      priorVersion
    );

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
    const priorVersion = record.room.version;
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

    this.commitTransition(
      record,
      transition.room,
      event,
      priorVersion
    );

    return {
      ok: true,
      room: record.room,
      event,
      acceptance: transition.receipt,
      replayed: false
    };
  }

  private transferAcceptAuthority(
    record: RoomRecord,
    actorParticipantId: string,
    intent: TransferAcceptAuthorityMessage
  ): IntentResult {
    const priorVersion = record.room.version;
    const transition = transferAcceptAuthority(record.room, {
      transferId: intent.transferId,
      actorParticipantId,
      targetParticipantId: intent.targetParticipantId,
      authorityGrantId: intent.authorityGrantId
    });

    if (!transition.ok) {
      return {
        ok: false,
        code: transition.code,
        message: transition.message,
        room: record.room,
        canonicalTransfer: transition.canonicalTransfer
      };
    }

    if (transition.replayed) {
      return {
        ok: true,
        room: record.room,
        authorityTransfer: transition.receipt,
        replayed: true
      };
    }

    const target = transition.room.participants.find(
      (participant) => participant.id === intent.targetParticipantId
    );

    const event = eventFor({
      room: transition.room,
      type: "accept_authority_transferred",
      actorId: actorParticipantId,
      summary: `Transferred ACCEPT_OUTCOME authority to ${target?.name ?? intent.targetParticipantId}.`
    });

    this.commitTransition(
      record,
      transition.room,
      event,
      priorVersion
    );

    return {
      ok: true,
      room: record.room,
      event,
      authorityTransfer: transition.receipt,
      replayed: false
    };
  }


  private bootstrapAgentVoiceAuthority(
    record: RoomRecord,
    actorParticipantId: string,
    intent: BootstrapAgentVoiceAuthorityMessage
  ): IntentResult {
    const priorVersion = record.room.version;
    const transition = bootstrapAgentVoiceAuthority(record.room, {
      bootstrapId: intent.bootstrapId,
      actorParticipantId,
      acceptAuthorityGrantId: intent.acceptAuthorityGrantId
    });

    if (!transition.ok) {
      return {
        ok: false,
        code: transition.code,
        message: transition.message,
        room: record.room,
        canonicalVoiceBootstrap: transition.canonicalBootstrap
      };
    }

    if (transition.replayed) {
      return {
        ok: true,
        room: record.room,
        voiceAuthorityBootstrap: transition.receipt,
        replayed: true
      };
    }

    const event = eventFor({
      room: transition.room,
      type: "voice_authority_bootstrapped",
      actorId: actorParticipantId,
      summary:
        "Bootstrapped dedicated MANAGE_AGENT_VOICE authority for this room."
    });

    this.commitTransition(
      record,
      transition.room,
      event,
      priorVersion
    );

    return {
      ok: true,
      room: record.room,
      event,
      voiceAuthorityBootstrap: transition.receipt,
      replayed: false
    };
  }

  private grantAgentVoice(
    record: RoomRecord,
    actorParticipantId: string,
    intent: GrantAgentVoiceMessage
  ): IntentResult {
    const priorVersion = record.room.version;
    const transition = grantAgentVoice(record.room, {
      grantRequestId: intent.grantRequestId,
      actorParticipantId,
      agentParticipantId: intent.agentParticipantId,
      voiceId: intent.voiceId,
      authorityGrantId: intent.authorityGrantId,
      expiresAt: intent.expiresAt
    });

    if (!transition.ok) {
      return {
        ok: false,
        code: transition.code,
        message: transition.message,
        room: record.room,
        canonicalVoiceGrant: transition.canonicalGrant
      };
    }

    if (transition.replayed) {
      return {
        ok: true,
        room: record.room,
        agentVoiceGrant: transition.receipt,
        replayed: true
      };
    }

    const target = transition.room.participants.find(
      (participant) => participant.id === intent.agentParticipantId
    );

    const event = eventFor({
      room: transition.room,
      type: "agent_voice_granted",
      actorId: actorParticipantId,
      summary:
        `Granted agent voice ${intent.voiceId} to ${target?.name ?? intent.agentParticipantId}.`
    });

    this.commitTransition(
      record,
      transition.room,
      event,
      priorVersion
    );

    return {
      ok: true,
      room: record.room,
      event,
      agentVoiceGrant: transition.receipt,
      replayed: false
    };
  }

  private revokeAgentVoice(
    record: RoomRecord,
    actorParticipantId: string,
    intent: RevokeAgentVoiceMessage
  ): IntentResult {
    const priorVersion = record.room.version;
    const transition = revokeAgentVoice(record.room, {
      revokeRequestId: intent.revokeRequestId,
      actorParticipantId,
      voiceGrantId: intent.voiceGrantId,
      authorityGrantId: intent.authorityGrantId
    });

    if (!transition.ok) {
      return {
        ok: false,
        code: transition.code,
        message: transition.message,
        room: record.room,
        canonicalVoiceRevocation: transition.canonicalRevocation
      };
    }

    if (transition.replayed) {
      return {
        ok: true,
        room: record.room,
        agentVoiceRevocation: transition.receipt,
        replayed: true
      };
    }

    const event = eventFor({
      room: transition.room,
      type: "agent_voice_revoked",
      actorId: actorParticipantId,
      summary:
        `Revoked agent voice grant ${intent.voiceGrantId}.`
    });

    this.commitTransition(
      record,
      transition.room,
      event,
      priorVersion
    );

    return {
      ok: true,
      room: record.room,
      event,
      agentVoiceRevocation: transition.receipt,
      replayed: false
    };
  }

  proposeArtifact(roomId: string, artifact: Artifact): IntentResult {
    const record = this.record(roomId);
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
      const priorVersion = record.room.version;
      const nextRoom = proposeArtifact(record.room, {
        ...artifact,
        producedBy: SILENT_AGENT_PARTICIPANT_ID
      });

      if (nextRoom.version === priorVersion) {
        return {
          ok: true,
          room: record.room
        };
      }

      const event = eventFor({
        room: nextRoom,
        type: "artifact_proposed",
        actorId: SILENT_AGENT_PARTICIPANT_ID,
        summary: `Silent worker proposed artifact: ${artifact.title}`
      });

      this.commitTransition(record, nextRoom, event, priorVersion);

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
