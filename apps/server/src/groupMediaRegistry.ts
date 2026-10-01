import type {
  GroupMediaParticipant,
  GroupMediaRouterMode,
  GroupMediaSource,
  GroupMediaStateMessage,
  GroupMediaSubscription
} from "@commonline/protocol";

const MAX_PARTICIPANTS = 3;
const ROUTER_MODE: GroupMediaRouterMode = "mesh-p0";

interface GroupMediaSession {
  roomId: string;
  mediaSessionId: string;
  generation: number;
  createdAt: string;
  participants: GroupMediaParticipant[];
  sources: GroupMediaSource[];
  subscriptions: GroupMediaSubscription[];
}

type GroupMutationResult =
  | { ok: true; session: GroupMediaSession; changed: boolean }
  | {
      ok: false;
      code:
        | "GROUP_MEDIA_FULL"
        | "MEDIA_SOURCE_NOT_FOUND"
        | "MEDIA_SUBSCRIPTION_INVALID"
        | "MEDIA_SESSION_STALE";
      message: string;
    };

function subscriptionKey(subscriberParticipantId: string, sourceId: string) {
  return `${subscriberParticipantId}::${sourceId}`;
}

export class GroupMediaRegistry {
  private readonly byRoom = new Map<string, GroupMediaSession>();
  private readonly generationByRoom = new Map<string, number>();

  join(input: {
    roomId: string;
    participantId: string;
  }): GroupMutationResult {
    let session = this.byRoom.get(input.roomId);

    if (!session) {
      const generation =
        (this.generationByRoom.get(input.roomId) ?? 0) + 1;
      this.generationByRoom.set(input.roomId, generation);

      session = {
        roomId: input.roomId,
        mediaSessionId: `group-media-${crypto.randomUUID()}`,
        generation,
        createdAt: new Date().toISOString(),
        participants: [],
        sources: [],
        subscriptions: []
      };
      this.byRoom.set(input.roomId, session);
    }

    if (
      session.participants.some(
        (participant) =>
          participant.participantId === input.participantId
      )
    ) {
      return { ok: true, session, changed: false };
    }

    if (session.participants.length >= MAX_PARTICIPANTS) {
      return {
        ok: false,
        code: "GROUP_MEDIA_FULL",
        message: `P0-i group media is limited to ${MAX_PARTICIPANTS} human participants.`
      };
    }

    session.participants.push({
      participantId: input.participantId,
      joinedAt: new Date().toISOString()
    });

    return { ok: true, session, changed: true };
  }

  leave(input: {
    roomId: string;
    participantId: string;
  }) {
    const session = this.byRoom.get(input.roomId);
    if (!session) return undefined;

    const hadParticipant = session.participants.some(
      (participant) =>
        participant.participantId === input.participantId
    );
    if (!hadParticipant) return session;

    const ownedSourceIds = new Set(
      session.sources
        .filter(
          (source) =>
            source.ownerParticipantId === input.participantId
        )
        .map((source) => source.sourceId)
    );

    session.participants = session.participants.filter(
      (participant) =>
        participant.participantId !== input.participantId
    );
    session.sources = session.sources.filter(
      (source) =>
        source.ownerParticipantId !== input.participantId
    );
    session.subscriptions = session.subscriptions.filter(
      (subscription) =>
        subscription.subscriberParticipantId !== input.participantId &&
        !ownedSourceIds.has(subscription.sourceId)
    );

    if (session.participants.length === 0) {
      this.byRoom.delete(input.roomId);
      return undefined;
    }

    return session;
  }

  publishMicrophone(input: {
    roomId: string;
    participantId: string;
  }): GroupMutationResult {
    const session = this.byRoom.get(input.roomId);
    if (
      !session ||
      !session.participants.some(
        (participant) =>
          participant.participantId === input.participantId
      )
    ) {
      return {
        ok: false,
        code: "MEDIA_SESSION_STALE",
        message: "Join the active group media session before publishing."
      };
    }

    const existing = session.sources.find(
      (source) =>
        source.ownerParticipantId === input.participantId &&
        source.kind === "microphone"
    );
    if (existing) {
      return { ok: true, session, changed: false };
    }

    session.sources.push({
      sourceId: `mic-${crypto.randomUUID()}`,
      ownerParticipantId: input.participantId,
      kind: "microphone",
      publishedAt: new Date().toISOString()
    });

    return { ok: true, session, changed: true };
  }

  unpublish(input: {
    roomId: string;
    participantId: string;
    sourceId: string;
  }): GroupMutationResult {
    const session = this.byRoom.get(input.roomId);
    if (!session) {
      return {
        ok: false,
        code: "MEDIA_SESSION_STALE",
        message: "There is no active group media session."
      };
    }

    const source = session.sources.find(
      (candidate) => candidate.sourceId === input.sourceId
    );
    if (!source) {
      return {
        ok: false,
        code: "MEDIA_SOURCE_NOT_FOUND",
        message: "The media source does not exist."
      };
    }

    if (source.ownerParticipantId !== input.participantId) {
      return {
        ok: false,
        code: "MEDIA_SUBSCRIPTION_INVALID",
        message: "A participant may only unpublish its own source."
      };
    }

    session.sources = session.sources.filter(
      (candidate) => candidate.sourceId !== input.sourceId
    );
    session.subscriptions = session.subscriptions.filter(
      (subscription) => subscription.sourceId !== input.sourceId
    );

    return { ok: true, session, changed: true };
  }

  subscribe(input: {
    roomId: string;
    participantId: string;
    sourceId: string;
  }): GroupMutationResult {
    const session = this.byRoom.get(input.roomId);
    if (
      !session ||
      !session.participants.some(
        (participant) =>
          participant.participantId === input.participantId
      )
    ) {
      return {
        ok: false,
        code: "MEDIA_SESSION_STALE",
        message: "Join the group media session before subscribing."
      };
    }

    const source = session.sources.find(
      (candidate) => candidate.sourceId === input.sourceId
    );
    if (!source) {
      return {
        ok: false,
        code: "MEDIA_SOURCE_NOT_FOUND",
        message: "The requested media source does not exist."
      };
    }

    if (source.ownerParticipantId === input.participantId) {
      return {
        ok: false,
        code: "MEDIA_SUBSCRIPTION_INVALID",
        message: "A participant does not subscribe to its own microphone source."
      };
    }

    const key = subscriptionKey(input.participantId, input.sourceId);
    if (
      session.subscriptions.some(
        (subscription) =>
          subscriptionKey(
            subscription.subscriberParticipantId,
            subscription.sourceId
          ) === key
      )
    ) {
      return { ok: true, session, changed: false };
    }

    session.subscriptions.push({
      subscriberParticipantId: input.participantId,
      sourceId: input.sourceId,
      createdAt: new Date().toISOString()
    });

    return { ok: true, session, changed: true };
  }

  unsubscribe(input: {
    roomId: string;
    participantId: string;
    sourceId: string;
  }): GroupMutationResult {
    const session = this.byRoom.get(input.roomId);
    if (!session) {
      return {
        ok: false,
        code: "MEDIA_SESSION_STALE",
        message: "There is no active group media session."
      };
    }

    const before = session.subscriptions.length;
    session.subscriptions = session.subscriptions.filter(
      (subscription) =>
        !(
          subscription.subscriberParticipantId ===
            input.participantId &&
          subscription.sourceId === input.sourceId
        )
    );

    return {
      ok: true,
      session,
      changed: session.subscriptions.length !== before
    };
  }

  validateSignal(input: {
    roomId: string;
    mediaSessionId: string;
    generation: number;
    actorParticipantId: string;
    targetParticipantId: string;
  }) {
    const session = this.byRoom.get(input.roomId);
    if (
      !session ||
      session.mediaSessionId !== input.mediaSessionId ||
      session.generation !== input.generation
    ) {
      return {
        ok: false as const,
        code: "MEDIA_SESSION_STALE" as const,
        message: "That group media session is no longer active."
      };
    }

    const participants = new Set(
      session.participants.map(
        (participant) => participant.participantId
      )
    );

    if (
      !participants.has(input.actorParticipantId) ||
      !participants.has(input.targetParticipantId) ||
      input.actorParticipantId === input.targetParticipantId
    ) {
      return {
        ok: false as const,
        code: "MEDIA_SESSION_STALE" as const,
        message: "That signal does not belong to this group participant pair."
      };
    }

    const actorSourceIds = new Set(
      session.sources
        .filter(
          (source) =>
            source.ownerParticipantId ===
            input.actorParticipantId
        )
        .map((source) => source.sourceId)
    );
    const targetSourceIds = new Set(
      session.sources
        .filter(
          (source) =>
            source.ownerParticipantId ===
            input.targetParticipantId
        )
        .map((source) => source.sourceId)
    );

    const hasRoute = session.subscriptions.some(
      (subscription) =>
        (subscription.subscriberParticipantId ===
          input.actorParticipantId &&
          targetSourceIds.has(subscription.sourceId)) ||
        (subscription.subscriberParticipantId ===
          input.targetParticipantId &&
          actorSourceIds.has(subscription.sourceId))
    );

    if (!hasRoute) {
      return {
        ok: false as const,
        code: "MEDIA_SUBSCRIPTION_INVALID" as const,
        message:
          "No active source subscription requires a media transport between these participants."
      };
    }

    return { ok: true as const, session };
  }

  current(roomId: string) {
    return this.byRoom.get(roomId);
  }

  currentForParticipant(roomId: string, participantId: string) {
    const session = this.byRoom.get(roomId);
    if (
      !session ||
      !session.participants.some(
        (participant) =>
          participant.participantId === participantId
      )
    ) {
      return undefined;
    }
    return session;
  }

  stateMessage(input: {
    requestId: string;
    roomId: string;
  }): GroupMediaStateMessage | undefined {
    const session = this.byRoom.get(input.roomId);
    if (!session) return undefined;

    return {
      type: "group_media_state",
      requestId: input.requestId,
      roomId: session.roomId,
      mediaSessionId: session.mediaSessionId,
      generation: session.generation,
      routerMode: ROUTER_MODE,
      maxParticipants: MAX_PARTICIPANTS,
      participants: [...session.participants],
      sources: [...session.sources],
      subscriptions: [...session.subscriptions]
    };
  }
}
