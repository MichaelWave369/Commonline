import { createServer } from "node:http";
import { MockSilentAgent } from "@commonline/agent-runtime";
import {
  COMMONLINE_WIRE_SCHEMA_VERSION,
  type AgentWorkStatusMessage,
  type ClientMessage,
  type IntentRejectedMessage,
  type RoomEventMessage,
  type RoomSnapshotMessage,
  type RtcSignalPayload,
  type RtcSignalRelayMessage,
  type ServerMessage
} from "@commonline/protocol";
import { SILENT_AGENT_PARTICIPANT_ID } from "@commonline/room-core";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { EphemeralWorkPlane } from "./ephemeralWork";
import { IdentityService } from "./identityService";
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
const agent = new MockSilentAgent("Vessie");

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
        identity: "p256-challenge-response"
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
      candidate.reason === "failed"
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
      parsed.type === "rtc_config_request"
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "rtc_signal" &&
      typeof parsed.targetParticipantId === "string" &&
      parsed.targetParticipantId.length > 0 &&
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
          message: "join_room is missing required P0-f fields."
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
        fromParticipantId: session.participantId,
        signal: message.signal
      };
      send(target, relay);
      return;
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
        canonicalTransfer: result.canonicalTransfer
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
  console.log(`Commonline received ${signal}; closing SQLite store.`);
  wss.close();
  httpServer.close(() => {
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
