import type { MockSilentAgent } from "@commonline/agent-runtime";
import type {
  AgentTurnState,
  AgentVoiceUtteranceKind,
  AgentVoiceUtteranceState
} from "@commonline/protocol";
import {
  activeAgentVoiceGrant,
  hasCapability
} from "@commonline/room-core";
import { agentVoiceProfile } from "./agentVoicePolicy";
import type { AttentionLeaseRegistry } from "./attentionLeaseRegistry";
import type { GroupMediaRegistry } from "./groupMediaRegistry";
import type { LocalVoiceRenderer } from "./localVoiceRenderer";
import { mediaSourcePolicy } from "./mediaSourcePolicy";
import type { MediasoupSfuAdapter } from "./mediasoupSfu";
import type { RoomService } from "./roomService";

export interface AgentVoiceRuntimeStatus {
  engine: string;
  ready: boolean;
  local: boolean;
  voiceId: string;
  busyRooms: number;
  detail: string;
}

export interface AgentVoiceUtteranceResult {
  utteranceId: string;
  agentParticipantId: string;
  voiceId: string;
  sourceId: string;
  durationMs: number;
}

export class AgentVoiceRuntime {
  private readonly busy = new Set<string>();

  constructor(
    private readonly service: RoomService,
    private readonly attentionLeases: AttentionLeaseRegistry,
    private readonly groupMedia: GroupMediaRegistry,
    private readonly sfu: MediasoupSfuAdapter,
    private readonly renderer: LocalVoiceRenderer,
    private readonly agent: MockSilentAgent
  ) {}

  status(): AgentVoiceRuntimeStatus {
    const renderer = this.renderer.status();
    return {
      engine: renderer.engine,
      ready: renderer.ready,
      local: renderer.local,
      voiceId: renderer.voiceId,
      busyRooms: this.busy.size,
      detail: renderer.detail
    };
  }

  async reconcile(roomId: string) {
    const room = this.service.getRoom(roomId);
    const session = this.groupMedia.current(roomId);

    if (!room || !session) {
      this.sfu.closeRoom(roomId);
      return undefined;
    }

    const grant = activeAgentVoiceGrant(room, "agent-vessie");
    const rendererStatus = this.renderer.status();
    const policy = mediaSourcePolicy("agent-voice");

    if (
      !grant ||
      !rendererStatus.ready ||
      !policy ||
      policy.executionState !== "executable"
    ) {
      const remaining = this.groupMedia.unpublishTrustedSource({
        roomId,
        ownerParticipantId: "agent-vessie",
        kind: "agent-voice"
      });
      this.sfu.reconcile(remaining);
      return undefined;
    }

    const profile = agentVoiceProfile(
      grant.agentParticipantId,
      grant.voiceId
    );
    if (!profile || profile.voiceId !== rendererStatus.voiceId) {
      const remaining = this.groupMedia.unpublishTrustedSource({
        roomId,
        ownerParticipantId: grant.agentParticipantId,
        kind: "agent-voice"
      });
      this.sfu.reconcile(remaining);
      return undefined;
    }

    const published = this.groupMedia.publishTrustedSource({
      roomId,
      ownerParticipantId: grant.agentParticipantId,
      kind: "agent-voice",
      label: `${this.agent.name} voice`,
      policy
    });

    if (!published.ok) {
      throw new Error(published.code);
    }

    const source = published.session.sources.find(
      (candidate) =>
        candidate.ownerParticipantId === grant.agentParticipantId &&
        candidate.kind === "agent-voice"
    );
    if (!source) {
      throw new Error("MEDIA_SOURCE_NOT_FOUND");
    }

    this.sfu.reconcile(published.session);
    await this.sfu.ensureDirectAudioProducer({
      session: published.session,
      ownerParticipantId: grant.agentParticipantId,
      sourceId: source.sourceId
    });

    return source;
  }

  async requestDirectedTurn(input: {
    roomId: string;
    actorParticipantId: string;
    agentParticipantId: string;
    attentionLeaseId: string;
    turnRequestId: string;
    prompt: string;
    onState?: (
      state: AgentTurnState,
      metadata: {
        voiceId: string;
        sourceId?: string;
        errorCode?: string;
      }
    ) => void;
  }): Promise<AgentVoiceUtteranceResult> {
    const room = this.service.getRoom(input.roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");

    const actor = room.participants.find(
      (participant) =>
        participant.id === input.actorParticipantId &&
        participant.kind === "human"
    );
    if (!actor) {
      throw new Error("NOT_AUTHORIZED");
    }

    const groupSession = this.groupMedia.currentForParticipant(
      input.roomId,
      input.actorParticipantId
    );
    if (!groupSession) {
      throw new Error("VOICE_GROUP_MEDIA_REQUIRED");
    }

    const active = activeAgentVoiceGrant(
      room,
      input.agentParticipantId
    );
    if (!active) {
      throw new Error("VOICE_GRANT_NOT_FOUND");
    }

    if (!this.renderer.status().ready) {
      throw new Error("VOICE_RENDERER_UNAVAILABLE");
    }

    const prompt = input.prompt.trim();
    if (prompt.length < 1 || prompt.length > 240) {
      throw new Error("AGENT_TURN_PROMPT_INVALID");
    }

    const busyKey = `${input.roomId}::${input.agentParticipantId}`;
    if (this.busy.has(busyKey)) {
      throw new Error("AGENT_TURN_BUSY");
    }

    const consumed = this.attentionLeases.consume({
      roomId: input.roomId,
      leaseId: input.attentionLeaseId,
      actorParticipantId: input.actorParticipantId,
      agentParticipantId: input.agentParticipantId
    });
    if (!consumed.ok) {
      throw new Error(consumed.code);
    }

    const utteranceId = `agent-turn-${crypto.randomUUID()}`;
    this.busy.add(busyKey);

    try {
      input.onState?.("thinking", {
        voiceId: active.voiceId
      });

      const source = await this.reconcile(input.roomId);
      if (!source) {
        throw new Error("VOICE_RENDERER_UNAVAILABLE");
      }

      const text = await this.agent.composeDirectedTurn(prompt);

      input.onState?.("rendering", {
        voiceId: active.voiceId,
        sourceId: source.sourceId
      });

      const audio = await this.renderer.render({
        voiceId: active.voiceId,
        text
      });

      const session = this.groupMedia.current(input.roomId);
      if (!session) throw new Error("VOICE_GROUP_MEDIA_REQUIRED");

      const roomAfterRender = this.service.getRoom(input.roomId);
      const stillActive = roomAfterRender
        ? activeAgentVoiceGrant(
            roomAfterRender,
            input.agentParticipantId
          )
        : undefined;
      if (
        !stillActive ||
        stillActive.voiceGrantId !== active.voiceGrantId
      ) {
        throw new Error("VOICE_GRANT_NOT_FOUND");
      }

      input.onState?.("speaking", {
        voiceId: active.voiceId,
        sourceId: source.sourceId
      });

      const sent = await this.sfu.injectDirectPcm16({
        session,
        ownerParticipantId: input.agentParticipantId,
        sourceId: source.sourceId,
        audio
      });

      input.onState?.("completed", {
        voiceId: active.voiceId,
        sourceId: source.sourceId
      });

      return {
        utteranceId,
        agentParticipantId: input.agentParticipantId,
        voiceId: active.voiceId,
        sourceId: source.sourceId,
        durationMs: sent.durationMs
      };
    } catch (error) {
      input.onState?.("failed", {
        voiceId: active.voiceId,
        errorCode:
          error instanceof Error ? error.message : "VOICE_RENDERER_UNAVAILABLE"
      });
      throw error;
    } finally {
      this.busy.delete(busyKey);
    }
  }

  async requestUtterance(input: {
    roomId: string;
    actorParticipantId: string;
    agentParticipantId: string;
    voiceGrantId: string;
    authorityGrantId: string;
    utteranceKind: AgentVoiceUtteranceKind;
    onState?: (
      state: AgentVoiceUtteranceState,
      metadata: {
        utteranceId: string;
        voiceId: string;
        sourceId?: string;
        errorCode?: string;
      }
    ) => void;
  }): Promise<AgentVoiceUtteranceResult> {
    const room = this.service.getRoom(input.roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");

    const authority = room.grants.find(
      (grant) =>
        grant.grantId === input.authorityGrantId &&
        grant.subjectParticipantId === input.actorParticipantId &&
        grant.capability === "MANAGE_AGENT_VOICE" &&
        !room.grantRevocations.some(
          (revocation) => revocation.grantId === grant.grantId
        ) &&
        !grant.revokedAt &&
        (!grant.expiresAt ||
          Date.parse(grant.expiresAt) > Date.now())
    );

    if (
      !authority ||
      !hasCapability(
        room,
        input.actorParticipantId,
        "MANAGE_AGENT_VOICE"
      )
    ) {
      throw new Error("NOT_AUTHORIZED");
    }

    const active = activeAgentVoiceGrant(
      room,
      input.agentParticipantId
    );
    if (!active || active.voiceGrantId !== input.voiceGrantId) {
      throw new Error("VOICE_GRANT_NOT_FOUND");
    }

    if (input.utteranceKind !== "authority-proof") {
      throw new Error("INVALID_INTENT");
    }

    if (!this.groupMedia.current(input.roomId)) {
      throw new Error("VOICE_GROUP_MEDIA_REQUIRED");
    }

    if (!this.renderer.status().ready) {
      throw new Error("VOICE_RENDERER_UNAVAILABLE");
    }

    const busyKey = `${input.roomId}::${input.agentParticipantId}`;
    if (this.busy.has(busyKey)) {
      throw new Error("VOICE_UTTERANCE_BUSY");
    }

    const utteranceId = `voice-utterance-${crypto.randomUUID()}`;
    this.busy.add(busyKey);

    try {
      input.onState?.("queued", {
        utteranceId,
        voiceId: active.voiceId
      });

      const source = await this.reconcile(input.roomId);
      if (!source) {
        throw new Error("VOICE_RENDERER_UNAVAILABLE");
      }

      input.onState?.("rendering", {
        utteranceId,
        voiceId: active.voiceId,
        sourceId: source.sourceId
      });

      const text = await this.agent.composeVoiceProof();
      const audio = await this.renderer.render({
        voiceId: active.voiceId,
        text
      });

      const session = this.groupMedia.current(input.roomId);
      if (!session) throw new Error("VOICE_GROUP_MEDIA_REQUIRED");

      const roomAfterRender = this.service.getRoom(input.roomId);
      const stillActive = roomAfterRender
        ? activeAgentVoiceGrant(
            roomAfterRender,
            input.agentParticipantId
          )
        : undefined;

      if (
        !stillActive ||
        stillActive.voiceGrantId !== input.voiceGrantId
      ) {
        throw new Error("VOICE_GRANT_NOT_FOUND");
      }

      input.onState?.("speaking", {
        utteranceId,
        voiceId: active.voiceId,
        sourceId: source.sourceId
      });

      const sent = await this.sfu.injectDirectPcm16({
        session,
        ownerParticipantId: input.agentParticipantId,
        sourceId: source.sourceId,
        audio
      });

      input.onState?.("completed", {
        utteranceId,
        voiceId: active.voiceId,
        sourceId: source.sourceId
      });

      return {
        utteranceId,
        agentParticipantId: input.agentParticipantId,
        voiceId: active.voiceId,
        sourceId: source.sourceId,
        durationMs: sent.durationMs
      };
    } catch (error) {
      input.onState?.("failed", {
        utteranceId,
        voiceId: active.voiceId,
        errorCode:
          error instanceof Error ? error.message : "VOICE_RENDERER_UNAVAILABLE"
      });
      throw error;
    } finally {
      this.busy.delete(busyKey);
    }
  }
}
