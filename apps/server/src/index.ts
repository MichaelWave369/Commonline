import { createServer } from "node:http";
import { MockSilentAgent } from "@commonline/agent-runtime";
import {
  COMMONLINE_WIRE_SCHEMA_VERSION,
  type AgentTurnStatusMessage,
  type AgentVoiceUtteranceStatusMessage,
  type AgentWorkStatusMessage,
  type AttentionLeaseStateMessage,
  type ClientMessage,
  type ExchangeResponseStatusMessage,
  type ListeningShareLeaseStateMessage,
  type ListeningShareStatusMessage,
  type IntentRejectedMessage,
  type MediaSourceKind,
  type RoomEventMessage,
  type RoomSnapshotMessage,
  type RtcSignalPayload,
  type RtcSignalRelayMessage,
  type ServerMessage
} from "@commonline/protocol";
import {
  activeAgentVoiceGrant,
  hasCapability,
  SILENT_AGENT_PARTICIPANT_ID
} from "@commonline/room-core";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { agentVoiceProfile } from "./agentVoicePolicy";
import { AttentionLeaseRegistry } from "./attentionLeaseRegistry";
import { AgentVoiceRuntime } from "./agentVoiceRuntime";
import { ConversationExchangeRegistry } from "./conversationExchangeRegistry";
import { EphemeralWorkPlane } from "./ephemeralWork";
import {
  LocalDelegationProofExecutor,
  requestContextDelegation
} from "./contextDelegationRuntime";
import {
  LocalProofEffectExecutor,
  requestExternalEffect
} from "./externalEffectRuntime";
import { GroupMediaRegistry } from "./groupMediaRegistry";
import { IdentityService } from "./identityService";
import {
  evaluateMediaSourcePolicy,
  mediaSourcePolicy
} from "./mediaSourcePolicy";
import {
  isPolitePeer,
  MediaSessionRegistry
} from "./mediaSessionRegistry";
import {
  MediasoupSfuAdapter,
  mediasoupConfigFromEnv
} from "./mediasoupSfu";
import { createLocalVoiceRenderer } from "./localVoiceRenderer";
import { createLocalSpeechRecognizer } from "./localSpeechRecognizer";
import { ListeningShareRegistry } from "./listeningShareRegistry";
import { ListeningShareRuntime } from "./listeningShareRuntime";
import { RoomService } from "./roomService";
import { buildRtcConfig } from "./rtcConfig";
import { SessionRegistry } from "./sessionRegistry";
import {
  COMMONLINE_STORAGE_SCHEMA_VERSION,
  SQLiteRoomStore
} from "./sqliteRoomStore";

const port = Number(process.env.PORT ?? 8787);
const databasePath = process.env.COMMONLINE_DB_PATH ?? "./data/commonline.db";
const store = new SQLiteRoomStore(databasePath);
const identity = new IdentityService(store);
const service = new RoomService(
  "Prove concurrent work + trustworthy resumption",
  store
);
const workPlane = new EphemeralWorkPlane();
const externalEffectExecutor = new LocalProofEffectExecutor();
const contextDelegationExecutor = new LocalDelegationProofExecutor();
const agent = new MockSilentAgent("Vessie");
const voiceRenderer = createLocalVoiceRenderer();
const speechRecognizer = createLocalSpeechRecognizer();
const sfu = await MediasoupSfuAdapter.create(
  mediasoupConfigFromEnv()
);

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "commonline-room",
        schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
        storage: "sqlite",
        storageSchemaVersion: COMMONLINE_STORAGE_SCHEMA_VERSION,
        identity: "p256-challenge-response",
        groupMedia: "mediasoup-p0",
        mediaSourcePolicy: "p0-n.1",
        agentVoiceAuthority: "p0-m.1",
        agentVoiceRenderer: voiceRenderer.status(),
        attentionLeases: "ephemeral-one-turn-p0-o",
        governedListening: "bounded-push-share-p0-p",
        explicitExchangeBinding: "heard-plus-attention-p0-q",
        externalEffectFirewall: "local-proof-sink-p0-u",
        contextDelegationFirewall: "local-delegation-proof-sink-p0-v",
        speechRecognizer: speechRecognizer.status(),
        sfu: sfu.status()
      })
    );
    return;
  }
  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ server: httpServer });
const roomSockets = new Map<string, Set<WebSocket>>();
const sessions = new SessionRegistry<WebSocket>();
const mediaSessions = new MediaSessionRegistry();
const groupMedia = new GroupMediaRegistry();
const attentionLeases = new AttentionLeaseRegistry();
const listeningShares = new ListeningShareRegistry();
const conversationExchanges = new ConversationExchangeRegistry();
const agentVoiceRuntime = new AgentVoiceRuntime(
  service,
  attentionLeases,
  conversationExchanges,
  groupMedia,
  sfu,
  voiceRenderer,
  agent
);
const listeningShareRuntime = new ListeningShareRuntime(
  service,
  groupMedia,
  listeningShares,
  conversationExchanges,
  speechRecognizer,
  agent
);

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(roomId: string, message: ServerMessage, except?: WebSocket) {
  const sockets = roomSockets.get(roomId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket !== except) send(socket, message);
  }
}

function reconcileGroupMedia(roomId: string) {
  const current = groupMedia.current(roomId);
  if (current) {
    sfu.reconcile(current);
  } else {
    sfu.closeRoom(roomId);
  }
}

function sfuFailureCode(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error);

  if (message.includes("SFU_TRANSPORT_NOT_FOUND")) {
    return "SFU_TRANSPORT_NOT_FOUND" as const;
  }
  if (message.includes("SFU_SOURCE_NOT_READY")) {
    return "SFU_SOURCE_NOT_READY" as const;
  }
  if (message.includes("SFU_CANNOT_CONSUME")) {
    return "SFU_CANNOT_CONSUME" as const;
  }

  return "SFU_NOT_READY" as const;
}

function activeGroupSession(input: {
  roomId: string;
  participantId: string;
  mediaSessionId: string;
  generation: number;
}) {
  const current = groupMedia.currentForParticipant(
    input.roomId,
    input.participantId
  );

  if (
    !current ||
    current.mediaSessionId !== input.mediaSessionId ||
    current.generation !== input.generation
  ) {
    return undefined;
  }

  return current;
}

function broadcastGroupMediaState(roomId: string, requestId: string) {
  const state = groupMedia.stateMessage({ roomId, requestId });
  if (!state) return;

  for (const participant of state.participants) {
    const socket = sessions.current(
      roomId,
      participant.participantId
    )?.connection;
    if (socket) send(socket, state);
  }
}

function groupMediaPermission(
  roomId: string,
  participantId: string,
  capability: "SPEAK" | "RECEIVE_MEDIA"
) {
  const room = service.getRoom(roomId);
  const participant = room?.participants.find(
    (candidate) =>
      candidate.id === participantId &&
      candidate.kind === "human" &&
      candidate.presence === "online"
  );

  return Boolean(
    room &&
      participant &&
      hasCapability(room, participantId, capability)
  );
}

function listeningFailureCode(error: unknown) {
  const code =
    error instanceof Error ? error.message : String(error);

  if (
    code === "ROOM_NOT_FOUND" ||
    code === "NOT_AUTHORIZED" ||
    code === "VOICE_GROUP_MEDIA_REQUIRED" ||
    code === "LISTENING_LEASE_NOT_FOUND" ||
    code === "LISTENING_LEASE_NOT_OWNED" ||
    code === "LISTENING_LEASE_EXPIRED" ||
    code === "LISTENING_LEASE_CONSUMED" ||
    code === "LISTENING_LEASE_REVOKED" ||
    code === "LISTENING_AUDIO_INVALID" ||
    code === "LISTENING_SHARE_BUSY" ||
    code === "STT_UNAVAILABLE" ||
    code === "STT_FAILED"
  ) {
    return code;
  }

  return "STT_FAILED" as const;
}

function sendListeningLeaseState(
  socket: WebSocket,
  requestId: string,
  roomId: string,
  lease: ListeningShareLeaseStateMessage["lease"]
) {
  send(socket, {
    type: "listening_share_lease_state",
    requestId,
    roomId,
    lease
  });
}

function broadcastListeningStatus(input: {
  requestId: string;
  roomId: string;
  shareId: string;
  leaseId: string;
  humanParticipantId: string;
  agentParticipantId: string;
  state: ListeningShareStatusMessage["state"];
  errorCode?: string;
}) {
  const message: ListeningShareStatusMessage = {
    type: "listening_share_status",
    ...input
  };
  broadcast(input.roomId, message);
}

function exchangeFailureCode(error: unknown) {
  const code =
    error instanceof Error ? error.message : String(error);

  if (
    code === "ROOM_NOT_FOUND" ||
    code === "NOT_AUTHORIZED" ||
    code === "VOICE_GRANT_NOT_FOUND" ||
    code === "VOICE_RENDERER_UNAVAILABLE" ||
    code === "VOICE_GROUP_MEDIA_REQUIRED" ||
    code === "ATTENTION_LEASE_NOT_FOUND" ||
    code === "ATTENTION_LEASE_NOT_OWNED" ||
    code === "ATTENTION_LEASE_EXPIRED" ||
    code === "ATTENTION_LEASE_CONSUMED" ||
    code === "ATTENTION_LEASE_REVOKED" ||
    code === "AGENT_TURN_BUSY" ||
    code === "EXCHANGE_NOT_FOUND" ||
    code === "EXCHANGE_NOT_OWNED" ||
    code === "EXCHANGE_EXPIRED" ||
    code === "EXCHANGE_ALREADY_RESPONDED" ||
    code === "EXCHANGE_BUSY"
  ) {
    return code;
  }

  return "VOICE_RENDERER_UNAVAILABLE" as const;
}

function broadcastExchangeResponseStatus(input: {
  requestId: string;
  roomId: string;
  exchangeId: string;
  attentionLeaseId: string;
  humanParticipantId: string;
  agentParticipantId: string;
  voiceId: string;
  sourceId?: string;
  state: ExchangeResponseStatusMessage["state"];
  errorCode?: string;
  exchange?: ExchangeResponseStatusMessage["exchange"];
}) {
  const message: ExchangeResponseStatusMessage = {
    type: "exchange_response_status",
    ...input
  };
  broadcast(input.roomId, message);
}

function voiceFailureCode(error: unknown) {
  const code =
    error instanceof Error ? error.message : String(error);

  if (
    code === "NOT_AUTHORIZED" ||
    code === "ROOM_NOT_FOUND" ||
    code === "INVALID_INTENT" ||
    code === "VOICE_GRANT_NOT_FOUND" ||
    code === "VOICE_RENDERER_UNAVAILABLE" ||
    code === "VOICE_UTTERANCE_BUSY" ||
    code === "VOICE_GROUP_MEDIA_REQUIRED"
  ) {
    return code;
  }

  return "VOICE_RENDERER_UNAVAILABLE" as const;
}

function turnFailureCode(error: unknown) {
  const code =
    error instanceof Error ? error.message : String(error);

  if (
    code === "ROOM_NOT_FOUND" ||
    code === "NOT_AUTHORIZED" ||
    code === "VOICE_GRANT_NOT_FOUND" ||
    code === "VOICE_RENDERER_UNAVAILABLE" ||
    code === "VOICE_GROUP_MEDIA_REQUIRED" ||
    code === "ATTENTION_LEASE_NOT_FOUND" ||
    code === "ATTENTION_LEASE_NOT_OWNED" ||
    code === "ATTENTION_LEASE_EXPIRED" ||
    code === "ATTENTION_LEASE_CONSUMED" ||
    code === "ATTENTION_LEASE_REVOKED" ||
    code === "AGENT_TURN_BUSY" ||
    code === "AGENT_TURN_PROMPT_INVALID"
  ) {
    return code;
  }

  return "VOICE_RENDERER_UNAVAILABLE" as const;
}

function sendAttentionLeaseState(
  socket: WebSocket,
  requestId: string,
  roomId: string,
  lease: AttentionLeaseStateMessage["lease"]
) {
  send(socket, {
    type: "attention_lease_state",
    requestId,
    roomId,
    lease
  });
}

function broadcastAgentTurnStatus(input: {
  requestId: string;
  roomId: string;
  turnRequestId: string;
  attentionLeaseId: string;
  agentParticipantId: string;
  voiceId: string;
  sourceId?: string;
  state: AgentTurnStatusMessage["state"];
  errorCode?: string;
}) {
  const message: AgentTurnStatusMessage = {
    type: "agent_turn_status",
    ...input
  };
  broadcast(input.roomId, message);
}

function broadcastVoiceStatus(input: {
  requestId: string;
  roomId: string;
  utteranceId: string;
  agentParticipantId: string;
  voiceId: string;
  sourceId?: string;
  state: AgentVoiceUtteranceStatusMessage["state"];
  errorCode?: string;
}) {
  const message: AgentVoiceUtteranceStatusMessage = {
    type: "agent_voice_utterance_status",
    ...input
  };
  broadcast(input.roomId, message);
}

async function reconcileAgentVoice(roomId: string, requestId: string) {
  await agentVoiceRuntime.reconcile(roomId);
  if (groupMedia.current(roomId)) {
    broadcastGroupMediaState(roomId, requestId);
  }
}

function broadcastStatus(input: {
  roomId: string;
  workItemId: string;
  state: AgentWorkStatusMessage["state"];
}) {
  const message: AgentWorkStatusMessage = {
    type: "agent_work_status",
    roomId: input.roomId,
    participantId: SILENT_AGENT_PARTICIPANT_ID,
    workItemId: input.workItemId,
    state: input.state
  };
  broadcast(input.roomId, message);
}

function reject(
  socket: WebSocket,
  input: Omit<IntentRejectedMessage, "type">
) {
  send(socket, { type: "intent_rejected", ...input });
}

function isMediaSourceKind(value: unknown): value is MediaSourceKind {
  return (
    value === "human-microphone" ||
    value === "sound-effect" ||
    value === "shared-music" ||
    value === "agent-voice" ||
    value === "system-tone"
  );
}

function isRtcSignalPayload(value: unknown): value is RtcSignalPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;

  if (candidate.kind === "offer" || candidate.kind === "answer") {
    return typeof candidate.sdp === "string" && candidate.sdp.length > 0;
  }

  if (candidate.kind === "ice") {
    return typeof candidate.candidate === "string";
  }

  if (candidate.kind === "hangup") {
    return (
      candidate.reason === undefined ||
      candidate.reason === "ended" ||
      candidate.reason === "declined" ||
      candidate.reason === "failed" ||
      candidate.reason === "peer-left" ||
      candidate.reason === "superseded"
    );
  }

  return false;
}

function parseMessage(raw: RawData): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw.toString()) as Partial<ClientMessage>;
    if (!parsed || typeof parsed !== "object") return null;

    if (
      parsed.type === "identity_begin" ||
      parsed.type === "identity_prove" ||
      parsed.type === "identity_recover" ||
      parsed.type === "join_room" ||
      parsed.type === "submit_work" ||
      parsed.type === "accept_outcome" ||
      parsed.type === "transfer_accept_authority" ||
      parsed.type === "bootstrap_agent_voice_authority" ||
      parsed.type === "grant_agent_voice" ||
      parsed.type === "revoke_agent_voice" ||
      parsed.type === "request_agent_voice_utterance" ||
      parsed.type === "rtc_config_request" ||
      parsed.type === "rtc_call_open" ||
      parsed.type === "group_media_join" ||
      parsed.type === "group_media_leave" ||
      parsed.type === "group_media_unpublish" ||
      parsed.type === "group_media_subscribe" ||
      parsed.type === "group_media_unsubscribe" ||
      parsed.type === "sfu_capabilities_request" ||
      parsed.type === "sfu_transport_create" ||
      parsed.type === "sfu_transport_connect" ||
      parsed.type === "sfu_produce" ||
      parsed.type === "sfu_consume" ||
      parsed.type === "sfu_consumer_resume"
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "request_external_effect" &&
      typeof parsed.effectRequestId === "string" &&
      parsed.effectRequestId.length > 0 &&
      typeof parsed.artifactId === "string" &&
      parsed.artifactId.length > 0 &&
      typeof parsed.authorityGrantId === "string" &&
      parsed.authorityGrantId.length > 0 &&
      parsed.kind === "demo-marker" &&
      parsed.target === "local-proof-sink" &&
      Number.isInteger(parsed.baseVersion) &&
      Number(parsed.baseVersion) >= 0
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "request_context_delegation" &&
      typeof parsed.delegationRequestId === "string" &&
      parsed.delegationRequestId.length > 0 &&
      typeof parsed.artifactId === "string" &&
      parsed.artifactId.length > 0 &&
      typeof parsed.authorityGrantId === "string" &&
      parsed.authorityGrantId.length > 0 &&
      parsed.kind === "accepted-artifact-summary" &&
      parsed.target === "local-delegation-proof-sink" &&
      parsed.purpose === "comparison-review" &&
      Number.isInteger(parsed.baseVersion) &&
      Number(parsed.baseVersion) >= 0
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "grant_listening_share" &&
      typeof parsed.agentParticipantId === "string" &&
      parsed.agentParticipantId.length > 0
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "revoke_listening_share" &&
      typeof parsed.leaseId === "string" &&
      parsed.leaseId.length > 0
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "submit_listening_share" &&
      typeof parsed.shareId === "string" &&
      parsed.shareId.length > 0 &&
      typeof parsed.leaseId === "string" &&
      parsed.leaseId.length > 0 &&
      typeof parsed.agentParticipantId === "string" &&
      parsed.agentParticipantId.length > 0 &&
      parsed.sampleRate === 16000 &&
      Number.isInteger(parsed.sampleCount) &&
      Number(parsed.sampleCount) >= 1600 &&
      Number(parsed.sampleCount) <= 80000 &&
      typeof parsed.pcm16Base64 === "string" &&
      parsed.pcm16Base64.length > 0 &&
      parsed.pcm16Base64.length <= 220000
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "request_exchange_response" &&
      typeof parsed.exchangeId === "string" &&
      parsed.exchangeId.length > 0 &&
      typeof parsed.attentionLeaseId === "string" &&
      parsed.attentionLeaseId.length > 0 &&
      typeof parsed.agentParticipantId === "string" &&
      parsed.agentParticipantId.length > 0
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "grant_attention_lease" &&
      typeof parsed.agentParticipantId === "string" &&
      parsed.agentParticipantId.length > 0
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "revoke_attention_lease" &&
      typeof parsed.leaseId === "string" &&
      parsed.leaseId.length > 0
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "group_media_publish_source" &&
      isMediaSourceKind(parsed.kind) &&
      typeof parsed.label === "string" &&
      parsed.label.trim().length > 0 &&
      parsed.label.length <= 160
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "request_agent_turn" &&
      typeof parsed.turnRequestId === "string" &&
      parsed.turnRequestId.length > 0 &&
      typeof parsed.attentionLeaseId === "string" &&
      parsed.attentionLeaseId.length > 0 &&
      typeof parsed.agentParticipantId === "string" &&
      parsed.agentParticipantId.length > 0 &&
      typeof parsed.prompt === "string" &&
      parsed.prompt.trim().length > 0 &&
      parsed.prompt.length <= 240
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "rtc_signal" &&
      typeof parsed.targetParticipantId === "string" &&
      parsed.targetParticipantId.length > 0 &&
      typeof parsed.callId === "string" &&
      parsed.callId.length > 0 &&
      Number.isInteger(parsed.generation) &&
      Number(parsed.generation) > 0 &&
      isRtcSignalPayload(parsed.signal)
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "group_rtc_signal" &&
      typeof parsed.targetParticipantId === "string" &&
      parsed.targetParticipantId.length > 0 &&
      typeof parsed.mediaSessionId === "string" &&
      parsed.mediaSessionId.length > 0 &&
      Number.isInteger(parsed.generation) &&
      Number(parsed.generation) > 0 &&
      isRtcSignalPayload(parsed.signal)
    ) {
      return parsed as ClientMessage;
    }
  } catch {
    // Rejected below.
  }

  return null;
}

function schemaMatches(
  socket: WebSocket,
  requestId: string,
  schemaVersion: unknown
) {
  if (schemaVersion === COMMONLINE_WIRE_SCHEMA_VERSION) return true;

  reject(socket, {
    requestId,
    code: "SCHEMA_VERSION_MISMATCH",
    message: `Client schema ${String(schemaVersion ?? "unknown")} is incompatible with ${COMMONLINE_WIRE_SCHEMA_VERSION}.`
  });
  socket.close(4400, "schema mismatch");
  return false;
}

wss.on("connection", (socket) => {
  let authenticated:
    | { participantId: string; sessionId: string }
    | null = null;
  let session:
    | { roomId: string; participantId: string; sessionId: string }
    | null = null;

  socket.on("message", async (raw) => {
    const message = parseMessage(raw);
    if (!message) {
      reject(socket, {
        requestId: "unknown",
        code: "INVALID_INTENT",
        message: "Message is not a recognized Commonline client intent."
      });
      return;
    }

    if (message.type === "identity_begin") {
      if (!schemaMatches(socket, message.requestId, message.schemaVersion)) {
        return;
      }

      const started = identity.begin({
        requestId: message.requestId,
        participantId: message.participantId,
        sessionId: message.sessionId,
        publicKey: message.publicKey
      });

      if (!started.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: started.code,
          message: started.message
        });
        return;
      }

      send(socket, started.message);
      return;
    }

    if (message.type === "identity_prove") {
      const proof = identity.prove({
        challengeId: message.challengeId,
        signature: message.signature
      });

      if (!proof.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: proof.code,
          message: proof.message
        });
        return;
      }

      authenticated = {
        participantId: proof.participantId,
        sessionId: proof.sessionId
      };

      send(socket, {
        type: "identity_authenticated",
        requestId: message.requestId,
        participantId: proof.participantId,
        sessionId: proof.sessionId,
        enrolled: proof.enrolled,
        recovered: false,
        recoveryCode: proof.recoveryCode
      });
      return;
    }

    if (message.type === "identity_recover") {
      if (!schemaMatches(socket, message.requestId, message.schemaVersion)) {
        return;
      }

      const recovered = identity.recover({
        participantId: message.participantId,
        sessionId: message.sessionId,
        recoveryCode: message.recoveryCode,
        newPublicKey: message.newPublicKey
      });

      if (!recovered.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: recovered.code,
          message: recovered.message
        });
        return;
      }

      authenticated = {
        participantId: recovered.participantId,
        sessionId: recovered.sessionId
      };

      send(socket, {
        type: "identity_authenticated",
        requestId: message.requestId,
        participantId: recovered.participantId,
        sessionId: recovered.sessionId,
        enrolled: false,
        recovered: true,
        recoveryCode: recovered.recoveryCode
      });
      return;
    }

    if (message.type === "join_room") {
      if (!schemaMatches(socket, message.requestId, message.schemaVersion)) {
        return;
      }

      if (
        !authenticated ||
        authenticated.participantId !== message.participantId ||
        authenticated.sessionId !== message.sessionId
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "IDENTITY_REQUIRED",
          message: "Complete identity proof for this participant/session before joining a room."
        });
        return;
      }

      if (
        !message.roomId ||
        !message.participantId ||
        !message.sessionId ||
        !message.name?.trim() ||
        (message.requestedRole !== "participant" &&
          message.requestedRole !== "observer") ||
        !Number.isInteger(message.acknowledgedVersion)
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "INVALID_INTENT",
          message: "join_room is missing required Commonline fields."
        });
        return;
      }

      session = {
        roomId: message.roomId,
        participantId: message.participantId,
        sessionId: message.sessionId
      };

      let sockets = roomSockets.get(message.roomId);
      if (!sockets) {
        sockets = new Set();
        roomSockets.set(message.roomId, sockets);
      }
      sockets.add(socket);

      const priorConnection = sessions.bind(message.roomId, {
        participantId: message.participantId,
        sessionId: message.sessionId,
        connection: socket
      });

      if (priorConnection && priorConnection.connection !== socket) {
        priorConnection.connection.close(4000, "session superseded");
      }

      const joined = service.join({
        roomId: message.roomId,
        participantId: message.participantId,
        name: message.name.trim().slice(0, 64),
        requestedRole: message.requestedRole,
        acknowledgedVersion: Math.max(0, message.acknowledgedVersion)
      });

      const snapshot: RoomSnapshotMessage = {
        type: "room_snapshot",
        requestId: message.requestId,
        room: joined.room,
        resumeDelta: joined.resumeDelta
      };
      send(socket, snapshot);

      if (joined.event) {
        const roomEvent: RoomEventMessage = {
          type: "room_event",
          room: joined.room,
          event: joined.event
        };
        broadcast(message.roomId, roomEvent, socket);
      }
      return;
    }

    if (!session || !authenticated) {
      reject(socket, {
        requestId: message.requestId,
        code: "INVALID_SESSION",
        message: "Authenticate and join a room before sending room intents."
      });
      return;
    }

    if ("roomId" in message && message.roomId !== session.roomId) {
      reject(socket, {
        requestId: message.requestId,
        code: "INVALID_SESSION",
        message: "This connection is bound to a different room."
      });
      return;
    }

    const currentConnection = sessions.current(
      session.roomId,
      session.participantId
    );

    if (currentConnection?.connection !== socket) {
      reject(socket, {
        requestId: message.requestId,
        code: "INVALID_SESSION",
        message: "This connection has been superseded by a newer session."
      });
      return;
    }

    if (message.type === "request_external_effect") {
      const room = service.getRoom(session.roomId);
      if (!room) {
        reject(socket, {
          requestId: message.requestId,
          code: "ROOM_NOT_FOUND",
          message: "Room no longer exists."
        });
        return;
      }

      const result = await requestExternalEffect({
        room,
        actorParticipantId: session.participantId,
        message,
        executor: externalEffectExecutor
      });

      send(socket, result.status);
      if (!result.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: result.code,
          message: result.message,
          room
        });
      }
      return;
    }

    if (message.type === "request_context_delegation") {
      const room = service.getRoom(session.roomId);
      if (!room) {
        reject(socket, {
          requestId: message.requestId,
          code: "ROOM_NOT_FOUND",
          message: "Room no longer exists."
        });
        return;
      }

      const result = await requestContextDelegation({
        room,
        actorParticipantId: session.participantId,
        message,
        executor: contextDelegationExecutor
      });

      send(socket, result.status);
      if (!result.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: result.code,
          message: result.message,
          room
        });
      }
      return;
    }

    if (message.type === "rtc_config_request") {
      try {
        const rtcConfig = buildRtcConfig({
          requestId: message.requestId,
          roomId: session.roomId,
          participantId: session.participantId
        });
        send(socket, rtcConfig);
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: "INVALID_INTENT",
          message:
            error instanceof Error
              ? error.message
              : "RTC configuration is invalid."
        });
      }
      return;
    }

    if (message.type === "group_media_join") {
      if (mediaSessions.currentForParticipant(
        session.roomId,
        session.participantId
      )) {
        reject(socket, {
          requestId: message.requestId,
          code: "MEDIA_BUSY",
          message:
            "Leave the active one-to-one call before joining group media.",
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const maySpeak = groupMediaPermission(
        session.roomId,
        session.participantId,
        "SPEAK"
      );
      const mayReceive = groupMediaPermission(
        session.roomId,
        session.participantId,
        "RECEIVE_MEDIA"
      );

      if (!maySpeak && !mayReceive) {
        reject(socket, {
          requestId: message.requestId,
          code: "NOT_AUTHORIZED",
          message:
            "Group media requires SPEAK or RECEIVE_MEDIA authority.",
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const joined = groupMedia.join({
        roomId: session.roomId,
        participantId: session.participantId
      });

      if (!joined.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: joined.code,
          message: joined.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      reconcileGroupMedia(session.roomId);
      await reconcileAgentVoice(
        session.roomId,
        `voice-source-join-${message.requestId}`
      );
      broadcastGroupMediaState(session.roomId, message.requestId);
      return;
    }

    if (message.type === "group_media_leave") {
      groupMedia.leave({
        roomId: session.roomId,
        participantId: session.participantId
      });
      attentionLeases.removeParticipant(
        session.roomId,
        session.participantId
      );
      listeningShares.removeParticipant(
        session.roomId,
        session.participantId
      );
      conversationExchanges.removeParticipant(
        session.roomId,
        session.participantId
      );
      sfu.closeParticipant(
        session.roomId,
        session.participantId
      );
      reconcileGroupMedia(session.roomId);
      await reconcileAgentVoice(
        session.roomId,
        `voice-source-leave-${message.requestId}`
      );
      broadcastGroupMediaState(session.roomId, message.requestId);
      return;
    }

    if (message.type === "group_media_publish_source") {
      const actorParticipantId = session.participantId;
      const room = service.getRoom(session.roomId);
      const participant = room?.participants.find(
        (candidate) => candidate.id === actorParticipantId
      );

      if (
        !participant ||
        typeof message.kind !== "string" ||
        typeof message.label !== "string"
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "INVALID_INTENT",
          message: "A governed media source requires kind and label."
        });
        return;
      }

      const sourcePolicy = mediaSourcePolicy(message.kind);
      const policyDecision = evaluateMediaSourcePolicy({
        kind: message.kind,
        publisherKind: participant.kind,
        hasRequiredAuthority: Boolean(
          room &&
            sourcePolicy?.requiredAuthority === "SPEAK" &&
            hasCapability(
              room,
              actorParticipantId,
              "SPEAK"
            )
        )
      });

      if (!policyDecision.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: policyDecision.code,
          message: policyDecision.message,
          room
        });
        return;
      }

      const published = groupMedia.publishSource({
        roomId: session.roomId,
        participantId: actorParticipantId,
        kind: message.kind,
        label: message.label,
        policy: policyDecision.policy
      });

      if (!published.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: published.code,
          message: published.message,
          room
        });
        return;
      }

      reconcileGroupMedia(session.roomId);
      broadcastGroupMediaState(session.roomId, message.requestId);
      return;
    }

    if (message.type === "group_media_unpublish") {
      const unpublished = groupMedia.unpublish({
        roomId: session.roomId,
        participantId: session.participantId,
        sourceId: message.sourceId
      });

      if (!unpublished.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: unpublished.code,
          message: unpublished.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      reconcileGroupMedia(session.roomId);
      broadcastGroupMediaState(session.roomId, message.requestId);
      return;
    }

    if (message.type === "group_media_subscribe") {
      if (
        !groupMediaPermission(
          session.roomId,
          session.participantId,
          "RECEIVE_MEDIA"
        )
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "NOT_AUTHORIZED",
          message:
            "Subscribing to a media source requires an active RECEIVE_MEDIA grant.",
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const subscribed = groupMedia.subscribe({
        roomId: session.roomId,
        participantId: session.participantId,
        sourceId: message.sourceId
      });

      if (!subscribed.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: subscribed.code,
          message: subscribed.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      reconcileGroupMedia(session.roomId);
      broadcastGroupMediaState(session.roomId, message.requestId);
      return;
    }

    if (message.type === "group_media_unsubscribe") {
      const unsubscribed = groupMedia.unsubscribe({
        roomId: session.roomId,
        participantId: session.participantId,
        sourceId: message.sourceId
      });

      if (!unsubscribed.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: unsubscribed.code,
          message: unsubscribed.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      reconcileGroupMedia(session.roomId);
      broadcastGroupMediaState(session.roomId, message.requestId);
      return;
    }

    if (message.type === "sfu_capabilities_request") {
      const groupSession = activeGroupSession({
        roomId: session.roomId,
        participantId: session.participantId,
        mediaSessionId: message.mediaSessionId,
        generation: message.generation
      });

      if (!groupSession) {
        reject(socket, {
          requestId: message.requestId,
          code: "SFU_SESSION_STALE",
          message:
            "Join the current group media session before requesting SFU capabilities."
        });
        return;
      }

      try {
        const routerRtpCapabilities =
          await sfu.routerCapabilities(groupSession);
        send(socket, {
          type: "sfu_capabilities",
          requestId: message.requestId,
          roomId: session.roomId,
          mediaSessionId: groupSession.mediaSessionId,
          generation: groupSession.generation,
          routerRtpCapabilities
        });
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: sfuFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "SFU router capabilities are unavailable."
        });
      }
      return;
    }

    if (message.type === "sfu_transport_create") {
      const groupSession = activeGroupSession({
        roomId: session.roomId,
        participantId: session.participantId,
        mediaSessionId: message.mediaSessionId,
        generation: message.generation
      });

      if (!groupSession) {
        reject(socket, {
          requestId: message.requestId,
          code: "SFU_SESSION_STALE",
          message: "The requested group media session is stale."
        });
        return;
      }

      if (
        message.direction !== "send" &&
        message.direction !== "recv"
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "SFU_DIRECTION_INVALID",
          message: "SFU transport direction must be send or recv."
        });
        return;
      }

      const requiredCapability =
        message.direction === "send"
          ? "SPEAK"
          : "RECEIVE_MEDIA";

      if (
        !groupMediaPermission(
          session.roomId,
          session.participantId,
          requiredCapability
        )
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "NOT_AUTHORIZED",
          message:
            `Creating an SFU ${message.direction} transport requires ${requiredCapability} authority.`
        });
        return;
      }

      try {
        const transport = await sfu.createTransport({
          session: groupSession,
          participantId: session.participantId,
          direction: message.direction
        });
        send(socket, {
          type: "sfu_transport_created",
          requestId: message.requestId,
          roomId: session.roomId,
          mediaSessionId: groupSession.mediaSessionId,
          generation: groupSession.generation,
          direction: message.direction,
          transport
        });
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: sfuFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Could not create the SFU transport."
        });
      }
      return;
    }

    if (message.type === "sfu_transport_connect") {
      const groupSession = activeGroupSession({
        roomId: session.roomId,
        participantId: session.participantId,
        mediaSessionId: message.mediaSessionId,
        generation: message.generation
      });

      if (!groupSession) {
        reject(socket, {
          requestId: message.requestId,
          code: "SFU_SESSION_STALE",
          message: "The requested group media session is stale."
        });
        return;
      }

      try {
        await sfu.connectTransport({
          roomId: session.roomId,
          participantId: session.participantId,
          transportId: message.transportId,
          dtlsParameters: message.dtlsParameters
        });
        send(socket, {
          type: "sfu_transport_connected",
          requestId: message.requestId,
          roomId: session.roomId,
          transportId: message.transportId
        });
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: sfuFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Could not connect the SFU transport."
        });
      }
      return;
    }

    if (message.type === "sfu_produce") {
      const groupSession = activeGroupSession({
        roomId: session.roomId,
        participantId: session.participantId,
        mediaSessionId: message.mediaSessionId,
        generation: message.generation
      });
      const source = groupMedia.source(
        session.roomId,
        message.sourceId
      );

      if (!groupSession) {
        reject(socket, {
          requestId: message.requestId,
          code: "SFU_SESSION_STALE",
          message: "The requested group media session is stale."
        });
        return;
      }

      const actorParticipantId = session.participantId;
      const sourcePolicy = source
        ? mediaSourcePolicy(source.kind)
        : undefined;
      const room = service.getRoom(session.roomId);
      const participant = room?.participants.find(
        (candidate) => candidate.id === actorParticipantId
      );

      if (
        !source ||
        !sourcePolicy ||
        sourcePolicy.executionState !== "executable" ||
        source.policyId !== sourcePolicy.policyId ||
        source.ownerParticipantId !== actorParticipantId ||
        message.kind !== "audio"
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "MEDIA_SOURCE_POLICY_DENIED",
          message:
            "The SFU will only produce an executable Commonline source bound to its current policy."
        });
        return;
      }

      if (
        !participant ||
        !sourcePolicy.allowedPublisherKinds.includes(
          participant.kind
        ) ||
        !room ||
        sourcePolicy.requiredAuthority !== "SPEAK" ||
        !hasCapability(
          room,
          actorParticipantId,
          "SPEAK"
        )
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "MEDIA_SOURCE_POLICY_DENIED",
          message:
            `Producing ${source.kind} requires its active source policy and ${sourcePolicy.requiredAuthority} authority.`
        });
        return;
      }

      try {
        const producerId = await sfu.produce({
          session: groupSession,
          participantId: session.participantId,
          transportId: message.transportId,
          sourceId: message.sourceId,
          kind: message.kind,
          rtpParameters: message.rtpParameters,
          appData: message.appData
        });

        send(socket, {
          type: "sfu_produced",
          requestId: message.requestId,
          roomId: session.roomId,
          sourceId: message.sourceId,
          producerId
        });

        // The control state did not change, but subscribers may have been
        // waiting for this source to become physically routable.
        broadcastGroupMediaState(
          session.roomId,
          `sfu-source-ready-${crypto.randomUUID()}`
        );
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: sfuFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Could not create the governed SFU producer."
        });
      }
      return;
    }

    if (message.type === "sfu_consume") {
      const groupSession = activeGroupSession({
        roomId: session.roomId,
        participantId: session.participantId,
        mediaSessionId: message.mediaSessionId,
        generation: message.generation
      });
      const source = groupMedia.source(
        session.roomId,
        message.sourceId
      );

      if (!groupSession) {
        reject(socket, {
          requestId: message.requestId,
          code: "SFU_SESSION_STALE",
          message: "The requested group media session is stale."
        });
        return;
      }

      if (!source) {
        reject(socket, {
          requestId: message.requestId,
          code: "MEDIA_SOURCE_NOT_FOUND",
          message: "The requested media source does not exist."
        });
        return;
      }

      if (
        !groupMediaPermission(
          session.roomId,
          session.participantId,
          "RECEIVE_MEDIA"
        ) ||
        !groupMedia.hasSubscription(
          session.roomId,
          session.participantId,
          message.sourceId
        )
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "NOT_AUTHORIZED",
          message:
            "The SFU will not create a consumer without an active RECEIVE_MEDIA grant and explicit source subscription."
        });
        return;
      }

      try {
        const consumed = await sfu.consume({
          session: groupSession,
          participantId: session.participantId,
          transportId: message.transportId,
          sourceId: message.sourceId,
          rtpCapabilities: message.rtpCapabilities
        });

        send(socket, {
          type: "sfu_consumed",
          requestId: message.requestId,
          roomId: session.roomId,
          sourceId: message.sourceId,
          consumerId: consumed.consumerId,
          producerId: consumed.producerId,
          kind: "audio",
          rtpParameters: consumed.rtpParameters,
          producerPaused: consumed.producerPaused
        });
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: sfuFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Could not create the governed SFU consumer."
        });
      }
      return;
    }

    if (message.type === "sfu_consumer_resume") {
      const groupSession = activeGroupSession({
        roomId: session.roomId,
        participantId: session.participantId,
        mediaSessionId: message.mediaSessionId,
        generation: message.generation
      });

      if (!groupSession) {
        reject(socket, {
          requestId: message.requestId,
          code: "SFU_SESSION_STALE",
          message: "The requested group media session is stale."
        });
        return;
      }

      try {
        await sfu.resumeConsumer({
          roomId: session.roomId,
          participantId: session.participantId,
          consumerId: message.consumerId
        });
        send(socket, {
          type: "sfu_consumer_resumed",
          requestId: message.requestId,
          roomId: session.roomId,
          consumerId: message.consumerId
        });
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: sfuFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Could not resume the governed SFU consumer."
        });
      }
      return;
    }

    if (message.type === "rtc_call_open") {
      if (
        groupMedia.currentForParticipant(
          session.roomId,
          session.participantId
        ) ||
        groupMedia.currentForParticipant(
          session.roomId,
          message.targetParticipantId
        )
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "MEDIA_BUSY",
          message:
            "One participant is already attached to the active group media session.",
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const permission = service.canRelayRtc(
        session.roomId,
        session.participantId,
        message.targetParticipantId
      );
      if (!permission.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: permission.code,
          message: permission.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const target = sessions.current(
        session.roomId,
        message.targetParticipantId
      )?.connection;

      if (!target || target.readyState !== WebSocket.OPEN) {
        reject(socket, {
          requestId: message.requestId,
          code: "PEER_UNAVAILABLE",
          message: "The requested peer has no active signaling connection.",
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const opened = mediaSessions.open({
        roomId: session.roomId,
        initiatorParticipantId: session.participantId,
        targetParticipantId: message.targetParticipantId
      });

      if (!opened.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: opened.code,
          message: opened.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const mediaSession = opened.session;

      send(socket, {
        type: "rtc_call_session",
        requestId: message.requestId,
        roomId: session.roomId,
        callId: mediaSession.callId,
        generation: mediaSession.generation,
        peerParticipantId: message.targetParticipantId,
        initiatorParticipantId: mediaSession.initiatorParticipantId,
        polite: isPolitePeer(
          session.participantId,
          message.targetParticipantId
        ),
        createdAt: mediaSession.createdAt
      });

      send(target, {
        type: "rtc_call_session",
        requestId: message.requestId,
        roomId: session.roomId,
        callId: mediaSession.callId,
        generation: mediaSession.generation,
        peerParticipantId: session.participantId,
        initiatorParticipantId: mediaSession.initiatorParticipantId,
        polite: isPolitePeer(
          message.targetParticipantId,
          session.participantId
        ),
        createdAt: mediaSession.createdAt
      });
      return;
    }

    if (message.type === "rtc_signal") {
      const permission = service.canRelayRtc(
        session.roomId,
        session.participantId,
        message.targetParticipantId
      );
      if (!permission.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: permission.code,
          message: permission.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const mediaValidation = mediaSessions.validate({
        roomId: session.roomId,
        callId: message.callId,
        generation: message.generation,
        actorParticipantId: session.participantId,
        targetParticipantId: message.targetParticipantId
      });

      if (!mediaValidation.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: mediaValidation.code,
          message: mediaValidation.message,
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const target = sessions.current(
        session.roomId,
        message.targetParticipantId
      )?.connection;

      if (!target || target.readyState !== WebSocket.OPEN) {
        reject(socket, {
          requestId: message.requestId,
          code: "PEER_UNAVAILABLE",
          message: "The requested peer has no active signaling connection.",
          room: service.getRoom(session.roomId)
        });
        return;
      }

      const relay: RtcSignalRelayMessage = {
        type: "rtc_signal",
        requestId: message.requestId,
        roomId: session.roomId,
        callId: message.callId,
        generation: message.generation,
        fromParticipantId: session.participantId,
        signal: message.signal
      };
      send(target, relay);

      if (message.signal.kind === "hangup") {
        mediaSessions.end({
          roomId: session.roomId,
          callId: message.callId,
          generation: message.generation
        });
      }
      return;
    }

    if (message.type === "group_rtc_signal") {
      reject(socket, {
        requestId: message.requestId,
        code: "INVALID_INTENT",
        message:
          "P0-j disables peer-to-peer group signaling. Multiparty audio must traverse the governed SFU."
      });
      return;
    }

    if (message.type === "grant_listening_share") {
      const actorParticipantId = session.participantId;
      const room = service.getRoom(session.roomId);
      const target = room?.participants.find(
        (participant) =>
          participant.id === message.agentParticipantId &&
          participant.kind === "agent"
      );
      const currentGroup = groupMedia.currentForParticipant(
        session.roomId,
        actorParticipantId
      );

      if (!target || !currentGroup) {
        reject(socket, {
          requestId: message.requestId,
          code: "VOICE_GROUP_MEDIA_REQUIRED",
          message:
            "A bounded listening share can be granted only while the human is in live group media with the target agent available."
        });
        return;
      }

      if (
        !room ||
        !hasCapability(
          room,
          message.agentParticipantId,
          "READ_SELECTED_CONTEXT"
        )
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "NOT_AUTHORIZED",
          message:
            "The target agent is not authorized to receive explicitly selected context."
        });
        return;
      }

      if (!speechRecognizer.status().ready) {
        reject(socket, {
          requestId: message.requestId,
          code: "STT_UNAVAILABLE",
          message:
            "No local speech recognizer is ready for a bounded listening share."
        });
        return;
      }

      const lease = listeningShares.grant({
        roomId: session.roomId,
        humanParticipantId: actorParticipantId,
        agentParticipantId: message.agentParticipantId
      });
      sendListeningLeaseState(
        socket,
        message.requestId,
        session.roomId,
        lease
      );
      return;
    }

    if (message.type === "revoke_listening_share") {
      const revoked = listeningShares.revoke({
        roomId: session.roomId,
        leaseId: message.leaseId,
        humanParticipantId: session.participantId
      });

      if (!revoked.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: revoked.code,
          message: revoked.message
        });
        return;
      }

      sendListeningLeaseState(
        socket,
        message.requestId,
        session.roomId,
        revoked.lease
      );
      return;
    }

    if (message.type === "submit_listening_share") {
      const actorParticipantId = session.participantId;
      const actorRoomId = session.roomId;

      try {
        const result = await listeningShareRuntime.submit({
          roomId: actorRoomId,
          humanParticipantId: actorParticipantId,
          agentParticipantId: message.agentParticipantId,
          leaseId: message.leaseId,
          shareId: message.shareId,
          sampleRate: message.sampleRate,
          sampleCount: message.sampleCount,
          pcm16Base64: message.pcm16Base64,
          onState: (state, errorCode) => {
            broadcastListeningStatus({
              requestId: message.requestId,
              roomId: actorRoomId,
              shareId: message.shareId,
              leaseId: message.leaseId,
              humanParticipantId: actorParticipantId,
              agentParticipantId: message.agentParticipantId,
              state,
              errorCode
            });
          }
        });

        const consumed = listeningShares.get(message.leaseId);
        if (consumed) {
          sendListeningLeaseState(
            socket,
            message.requestId,
            actorRoomId,
            consumed
          );
        }

        send(socket, {
          type: "listening_share_result",
          requestId: message.requestId,
          roomId: actorRoomId,
          shareId: message.shareId,
          leaseId: message.leaseId,
          agentParticipantId: message.agentParticipantId,
          transcript: result.transcript,
          engine: result.engine,
          sampleCount: result.sampleCount,
          durationMs: result.durationMs,
          exchange: result.exchange
        });
      } catch (error) {
        const lease = listeningShares.get(message.leaseId);
        if (lease) {
          sendListeningLeaseState(
            socket,
            message.requestId,
            actorRoomId,
            lease
          );
        }

        reject(socket, {
          requestId: message.requestId,
          code: listeningFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Bounded listening share failed."
        });
      }
      return;
    }

    if (message.type === "request_exchange_response") {
      const actorParticipantId = session.participantId;
      const actorRoomId = session.roomId;

      try {
        await agentVoiceRuntime.requestExchangeResponse({
          roomId: actorRoomId,
          actorParticipantId,
          agentParticipantId: message.agentParticipantId,
          exchangeId: message.exchangeId,
          attentionLeaseId: message.attentionLeaseId,
          onState: (state, metadata) => {
            broadcastExchangeResponseStatus({
              requestId: message.requestId,
              roomId: actorRoomId,
              exchangeId: message.exchangeId,
              attentionLeaseId: message.attentionLeaseId,
              humanParticipantId: actorParticipantId,
              agentParticipantId: message.agentParticipantId,
              voiceId: metadata.voiceId,
              sourceId: metadata.sourceId,
              state,
              errorCode: metadata.errorCode,
              exchange: metadata.exchange
            });
          }
        });

        const consumedAttention = attentionLeases.get(
          message.attentionLeaseId
        );
        if (consumedAttention) {
          sendAttentionLeaseState(
            socket,
            message.requestId,
            actorRoomId,
            consumedAttention
          );
        }
      } catch (error) {
        const attention = attentionLeases.get(
          message.attentionLeaseId
        );
        if (attention) {
          sendAttentionLeaseState(
            socket,
            message.requestId,
            actorRoomId,
            attention
          );
        }

        reject(socket, {
          requestId: message.requestId,
          code: exchangeFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Exchange-bound agent response failed."
        });
      }
      return;
    }

    if (message.type === "grant_attention_lease") {
      const actorParticipantId = session.participantId;
      const room = service.getRoom(session.roomId);
      const target = room?.participants.find(
        (participant) =>
          participant.id === message.agentParticipantId &&
          participant.kind === "agent"
      );
      const currentGroup = groupMedia.currentForParticipant(
        session.roomId,
        actorParticipantId
      );
      const voiceGrant = room
        ? activeAgentVoiceGrant(room, message.agentParticipantId)
        : undefined;

      if (!target || !currentGroup) {
        reject(socket, {
          requestId: message.requestId,
          code: "VOICE_GROUP_MEDIA_REQUIRED",
          message:
            "Grant attention only while you are in the live group media session with the target agent available."
        });
        return;
      }

      if (!voiceGrant) {
        reject(socket, {
          requestId: message.requestId,
          code: "VOICE_GRANT_NOT_FOUND",
          message:
            "The target agent needs an active voice grant before attention can be leased."
        });
        return;
      }

      const lease = attentionLeases.grant({
        roomId: session.roomId,
        agentParticipantId: message.agentParticipantId,
        grantedByParticipantId: actorParticipantId
      });
      sendAttentionLeaseState(
        socket,
        message.requestId,
        session.roomId,
        lease
      );
      return;
    }

    if (message.type === "revoke_attention_lease") {
      const revoked = attentionLeases.revoke({
        roomId: session.roomId,
        leaseId: message.leaseId,
        actorParticipantId: session.participantId
      });

      if (!revoked.ok) {
        reject(socket, {
          requestId: message.requestId,
          code: revoked.code,
          message: revoked.message
        });
        return;
      }

      sendAttentionLeaseState(
        socket,
        message.requestId,
        session.roomId,
        revoked.lease
      );
      return;
    }

    if (message.type === "request_agent_turn") {
      const actorParticipantId = session.participantId;
      const actorRoomId = session.roomId;

      try {
        await agentVoiceRuntime.requestDirectedTurn({
          roomId: actorRoomId,
          actorParticipantId,
          agentParticipantId: message.agentParticipantId,
          attentionLeaseId: message.attentionLeaseId,
          turnRequestId: message.turnRequestId,
          prompt: message.prompt,
          onState: (state, metadata) => {
            broadcastAgentTurnStatus({
              requestId: message.requestId,
              roomId: actorRoomId,
              turnRequestId: message.turnRequestId,
              attentionLeaseId: message.attentionLeaseId,
              agentParticipantId: message.agentParticipantId,
              voiceId: metadata.voiceId,
              sourceId: metadata.sourceId,
              state,
              errorCode: metadata.errorCode
            });
          }
        });

        const consumed = attentionLeases.get(
          message.attentionLeaseId
        );
        if (consumed) {
          sendAttentionLeaseState(
            socket,
            message.requestId,
            actorRoomId,
            consumed
          );
        }
      } catch (error) {
        const lease = attentionLeases.get(
          message.attentionLeaseId
        );
        if (lease) {
          sendAttentionLeaseState(
            socket,
            message.requestId,
            actorRoomId,
            lease
          );
        }

        reject(socket, {
          requestId: message.requestId,
          code: turnFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Agent turn failed."
        });
      }
      return;
    }

    if (message.type === "request_agent_voice_utterance") {
      const actorParticipantId = session.participantId;
      const actorRoomId = session.roomId;

      try {
        await agentVoiceRuntime.requestUtterance({
          roomId: actorRoomId,
          actorParticipantId,
          agentParticipantId: message.agentParticipantId,
          voiceGrantId: message.voiceGrantId,
          authorityGrantId: message.authorityGrantId,
          utteranceKind: message.utteranceKind,
          onState: (state, metadata) => {
            broadcastVoiceStatus({
              requestId: message.requestId,
              roomId: actorRoomId,
              utteranceId: metadata.utteranceId,
              agentParticipantId: message.agentParticipantId,
              voiceId: metadata.voiceId,
              sourceId: metadata.sourceId,
              state,
              errorCode: metadata.errorCode
            });
          }
        });
      } catch (error) {
        reject(socket, {
          requestId: message.requestId,
          code: voiceFailureCode(error),
          message:
            error instanceof Error
              ? error.message
              : "Agent voice renderer failed."
        });
      }
      return;
    }

    if (message.type === "grant_agent_voice") {
      if (
        !message.agentParticipantId ||
        !message.voiceId ||
        !agentVoiceProfile(
          message.agentParticipantId,
          message.voiceId
        )
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "VOICE_ID_INVALID",
          message:
            "The requested voice ID is not bound to that Commonline agent."
        });
        return;
      }

      if (
        message.expiresAt &&
        (!Number.isFinite(Date.parse(message.expiresAt)) ||
          Date.parse(message.expiresAt) <= Date.now())
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "INVALID_INTENT",
          message: "Agent voice expiry must be a future ISO timestamp."
        });
        return;
      }
    }

    const result = service.applyIntent(session.participantId, message);
    if (!result.ok) {
      reject(socket, {
        requestId: message.requestId,
        code: result.code,
        message: result.message,
        expectedVersion: result.room?.version,
        room: result.room,
        canonicalAcceptance: result.canonicalAcceptance,
        canonicalTransfer: result.canonicalTransfer,
        canonicalVoiceBootstrap: result.canonicalVoiceBootstrap,
        canonicalVoiceGrant: result.canonicalVoiceGrant,
        canonicalVoiceRevocation: result.canonicalVoiceRevocation
      });
      return;
    }

    if (
      message.type === "transfer_accept_authority" &&
      result.authorityTransfer
    ) {
      if (result.event) {
        const roomEvent: RoomEventMessage = {
          type: "room_event",
          room: result.room,
          event: result.event
        };
        broadcast(message.roomId, roomEvent);
      }

      send(socket, {
        type: "authority_transfer_receipt",
        requestId: message.requestId,
        room: result.room,
        receipt: result.authorityTransfer,
        replayed: Boolean(result.replayed)
      });
      return;
    }

    if (
      message.type === "bootstrap_agent_voice_authority" &&
      result.voiceAuthorityBootstrap
    ) {
      if (result.event) {
        const roomEvent: RoomEventMessage = {
          type: "room_event",
          room: result.room,
          event: result.event
        };
        broadcast(message.roomId, roomEvent);
      }

      send(socket, {
        type: "voice_authority_bootstrap_receipt",
        requestId: message.requestId,
        room: result.room,
        receipt: result.voiceAuthorityBootstrap,
        replayed: Boolean(result.replayed)
      });
      return;
    }

    if (
      message.type === "grant_agent_voice" &&
      result.agentVoiceGrant
    ) {
      if (result.event) {
        const roomEvent: RoomEventMessage = {
          type: "room_event",
          room: result.room,
          event: result.event
        };
        broadcast(message.roomId, roomEvent);
      }

      send(socket, {
        type: "agent_voice_grant_receipt",
        requestId: message.requestId,
        room: result.room,
        receipt: result.agentVoiceGrant,
        replayed: Boolean(result.replayed)
      });

      await reconcileAgentVoice(
        message.roomId,
        `voice-grant-${message.requestId}`
      );
      return;
    }

    if (
      message.type === "revoke_agent_voice" &&
      result.agentVoiceRevocation
    ) {
      if (result.event) {
        const roomEvent: RoomEventMessage = {
          type: "room_event",
          room: result.room,
          event: result.event
        };
        broadcast(message.roomId, roomEvent);
      }

      await reconcileAgentVoice(
        message.roomId,
        `voice-revoke-${message.requestId}`
      );

      send(socket, {
        type: "agent_voice_revocation_receipt",
        requestId: message.requestId,
        room: result.room,
        receipt: result.agentVoiceRevocation,
        replayed: Boolean(result.replayed)
      });
      return;
    }

    if (message.type === "accept_outcome" && result.acceptance) {
      if (result.event) {
        const roomEvent: RoomEventMessage = {
          type: "room_event",
          room: result.room,
          event: result.event
        };
        broadcast(message.roomId, roomEvent);
      }

      send(socket, {
        type: "acceptance_receipt",
        requestId: message.requestId,
        room: result.room,
        receipt: result.acceptance,
        replayed: Boolean(result.replayed)
      });
      return;
    }

    if (result.event) {
      const roomEvent: RoomEventMessage = {
        type: "room_event",
        room: result.room,
        event: result.event
      };
      broadcast(message.roomId, roomEvent);
    }

    if (message.type === "submit_work" && result.work) {
      const work = result.work;
      workPlane.begin({
        roomId: message.roomId,
        workItemId: work.id,
        participantId: SILENT_AGENT_PARTICIPANT_ID
      });
      broadcastStatus({
        roomId: message.roomId,
        workItemId: work.id,
        state: "working"
      });

      try {
        const artifact = await agent.perform(work);

        workPlane.writeScratch({
          roomId: message.roomId,
          workItemId: work.id,
          participantId: SILENT_AGENT_PARTICIPANT_ID,
          content: JSON.stringify({
            candidateArtifactId: artifact.id,
            title: artifact.title,
            body: artifact.body
          })
        });

        const proposed = service.proposeArtifact(message.roomId, artifact);
        if (proposed.ok && proposed.event) {
          const roomEvent: RoomEventMessage = {
            type: "room_event",
            room: proposed.room,
            event: proposed.event
          };
          broadcast(message.roomId, roomEvent);
        }

        workPlane.finish({
          roomId: message.roomId,
          workItemId: work.id,
          participantId: SILENT_AGENT_PARTICIPANT_ID,
          state: "completed"
        });
        broadcastStatus({
          roomId: message.roomId,
          workItemId: work.id,
          state: "completed"
        });
      } catch {
        workPlane.finish({
          roomId: message.roomId,
          workItemId: work.id,
          participantId: SILENT_AGENT_PARTICIPANT_ID,
          state: "failed"
        });
        broadcastStatus({
          roomId: message.roomId,
          workItemId: work.id,
          state: "failed"
        });
      }
    }
  });

  socket.on("close", () => {
    if (!session) return;

    const sockets = roomSockets.get(session.roomId);
    sockets?.delete(socket);
    if (sockets?.size === 0) roomSockets.delete(session.roomId);

    const wasCurrent = sessions.unbindIfCurrent(
      session.roomId,
      session.participantId,
      socket
    );
    if (!wasCurrent) return;

    attentionLeases.removeParticipant(
      session.roomId,
      session.participantId
    );
    listeningShares.removeParticipant(
      session.roomId,
      session.participantId
    );
    conversationExchanges.removeParticipant(
      session.roomId,
      session.participantId
    );

    for (const ended of mediaSessions.endForParticipant(
      session.roomId,
      session.participantId
    )) {
      const peerParticipantId =
        ended.participantAId === session.participantId
          ? ended.participantBId
          : ended.participantAId;
      const peerSocket = sessions.current(
        session.roomId,
        peerParticipantId
      )?.connection;

      if (peerSocket?.readyState === WebSocket.OPEN) {
        send(peerSocket, {
          type: "rtc_signal",
          requestId: `peer-left-${crypto.randomUUID()}`,
          roomId: session.roomId,
          callId: ended.callId,
          generation: ended.generation,
          fromParticipantId: session.participantId,
          signal: {
            kind: "hangup",
            reason: "peer-left"
          }
        });
      }
    }

    if (
      groupMedia.currentForParticipant(
        session.roomId,
        session.participantId
      )
    ) {
      groupMedia.leave({
        roomId: session.roomId,
        participantId: session.participantId
      });
      sfu.closeParticipant(
        session.roomId,
        session.participantId
      );
      reconcileGroupMedia(session.roomId);
      void reconcileAgentVoice(
        session.roomId,
        `voice-peer-left-${crypto.randomUUID()}`
      );
      broadcastGroupMediaState(
        session.roomId,
        `group-peer-left-${crypto.randomUUID()}`
      );
    }

    const left = service.leave(session.roomId, session.participantId);
    if (left) {
      const roomEvent: RoomEventMessage = {
        type: "room_event",
        room: left.room,
        event: left.event
      };
      broadcast(session.roomId, roomEvent);
    }
  });
});

function shutdown(signal: string) {
  console.log(
    `Commonline received ${signal}; closing SFU and SQLite store.`
  );
  wss.close();
  httpServer.close(() => {
    sfu.close();
    store.close();
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

httpServer.listen(port, () => {
  console.log(
    `Commonline room service listening on http://localhost:${port} (${COMMONLINE_WIRE_SCHEMA_VERSION}, storage ${COMMONLINE_STORAGE_SCHEMA_VERSION})`
  );
});
