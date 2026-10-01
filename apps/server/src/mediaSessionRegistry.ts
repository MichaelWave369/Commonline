export interface MediaSession {
  roomId: string;
  callId: string;
  generation: number;
  participantAId: string;
  participantBId: string;
  initiatorParticipantId: string;
  createdAt: string;
}

export type MediaSessionOpenResult =
  | {
      ok: true;
      session: MediaSession;
      coalesced: boolean;
    }
  | {
      ok: false;
      code: "MEDIA_BUSY";
      message: string;
    };

export type MediaSessionValidationResult =
  | {
      ok: true;
      session: MediaSession;
    }
  | {
      ok: false;
      code: "MEDIA_SESSION_STALE";
      message: string;
    };

function orderedPair(a: string, b: string) {
  return a < b ? [a, b] as const : [b, a] as const;
}

function pairKey(roomId: string, a: string, b: string) {
  const [first, second] = orderedPair(a, b);
  return `${roomId}::${first}::${second}`;
}

function participantKey(roomId: string, participantId: string) {
  return `${roomId}::${participantId}`;
}

function sessionKey(roomId: string, callId: string, generation: number) {
  return `${roomId}::${callId}::${generation}`;
}

export function isPolitePeer(
  participantId: string,
  peerParticipantId: string
) {
  return participantId.localeCompare(peerParticipantId) > 0;
}

export class MediaSessionRegistry {
  private readonly activeByPair = new Map<string, MediaSession>();
  private readonly activeByParticipant = new Map<string, MediaSession>();
  private readonly activeByKey = new Map<string, MediaSession>();
  private readonly generationByPair = new Map<string, number>();

  open(input: {
    roomId: string;
    initiatorParticipantId: string;
    targetParticipantId: string;
  }): MediaSessionOpenResult {
    const key = pairKey(
      input.roomId,
      input.initiatorParticipantId,
      input.targetParticipantId
    );

    const existingPair = this.activeByPair.get(key);
    if (existingPair) {
      return {
        ok: true,
        session: existingPair,
        coalesced: true
      };
    }

    const initiatorBusy = this.activeByParticipant.get(
      participantKey(input.roomId, input.initiatorParticipantId)
    );
    const targetBusy = this.activeByParticipant.get(
      participantKey(input.roomId, input.targetParticipantId)
    );

    if (initiatorBusy || targetBusy) {
      return {
        ok: false,
        code: "MEDIA_BUSY",
        message:
          "One participant already has another active ephemeral media session."
      };
    }

    const generation = (this.generationByPair.get(key) ?? 0) + 1;
    this.generationByPair.set(key, generation);

    const [participantAId, participantBId] = orderedPair(
      input.initiatorParticipantId,
      input.targetParticipantId
    );

    const session: MediaSession = {
      roomId: input.roomId,
      callId: `call-${crypto.randomUUID()}`,
      generation,
      participantAId,
      participantBId,
      initiatorParticipantId: input.initiatorParticipantId,
      createdAt: new Date().toISOString()
    };

    this.activeByPair.set(key, session);
    this.activeByKey.set(
      sessionKey(input.roomId, session.callId, generation),
      session
    );
    this.activeByParticipant.set(
      participantKey(input.roomId, participantAId),
      session
    );
    this.activeByParticipant.set(
      participantKey(input.roomId, participantBId),
      session
    );

    return {
      ok: true,
      session,
      coalesced: false
    };
  }

  validate(input: {
    roomId: string;
    callId: string;
    generation: number;
    actorParticipantId: string;
    targetParticipantId: string;
  }): MediaSessionValidationResult {
    const session = this.activeByKey.get(
      sessionKey(input.roomId, input.callId, input.generation)
    );

    if (!session) {
      return {
        ok: false,
        code: "MEDIA_SESSION_STALE",
        message: "That media session is no longer active."
      };
    }

    const participants = new Set([
      session.participantAId,
      session.participantBId
    ]);

    if (
      !participants.has(input.actorParticipantId) ||
      !participants.has(input.targetParticipantId) ||
      input.actorParticipantId === input.targetParticipantId
    ) {
      return {
        ok: false,
        code: "MEDIA_SESSION_STALE",
        message: "That signal does not belong to this media-session pair."
      };
    }

    return { ok: true, session };
  }

  end(input: {
    roomId: string;
    callId: string;
    generation: number;
  }) {
    const key = sessionKey(input.roomId, input.callId, input.generation);
    const session = this.activeByKey.get(key);
    if (!session) return undefined;

    this.activeByKey.delete(key);
    this.activeByPair.delete(
      pairKey(input.roomId, session.participantAId, session.participantBId)
    );

    for (const participantId of [
      session.participantAId,
      session.participantBId
    ]) {
      const participantMapKey = participantKey(
        input.roomId,
        participantId
      );
      if (this.activeByParticipant.get(participantMapKey) === session) {
        this.activeByParticipant.delete(participantMapKey);
      }
    }

    return session;
  }

  endForParticipant(roomId: string, participantId: string) {
    const session = this.activeByParticipant.get(
      participantKey(roomId, participantId)
    );
    if (!session) return [];

    const ended = this.end({
      roomId,
      callId: session.callId,
      generation: session.generation
    });

    return ended ? [ended] : [];
  }

  currentForParticipant(roomId: string, participantId: string) {
    return this.activeByParticipant.get(
      participantKey(roomId, participantId)
    );
  }
}
