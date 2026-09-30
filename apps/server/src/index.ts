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
import { RoomService } from "./roomService";

const port = Number(process.env.PORT ?? 8787);
const service = new RoomService();
const workPlane = new EphemeralWorkPlane();
const agent = new MockSilentAgent("Vessie");

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        service: "commonline-room",
        schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION
      })
    );
    return;
  }
  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ server: httpServer });
const roomSockets = new Map<string, Set<WebSocket>>();
const participantSockets = new Map<
  string,
  Map<string, { socket: WebSocket; sessionId: string }>
>();

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
      parsed.type === "join_room" ||
      parsed.type === "submit_work" ||
      parsed.type === "accept_outcome"
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

wss.on("connection", (socket) => {
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

    if (message.type === "join_room") {
      if (message.schemaVersion !== COMMONLINE_WIRE_SCHEMA_VERSION) {
        reject(socket, {
          requestId: message.requestId,
          code: "SCHEMA_VERSION_MISMATCH",
          message: `Client schema ${message.schemaVersion ?? "unknown"} is incompatible with ${COMMONLINE_WIRE_SCHEMA_VERSION}.`
        });
        socket.close(4400, "schema mismatch");
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
          message: "join_room is missing required P0-d fields."
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

      let byParticipant = participantSockets.get(message.roomId);
      if (!byParticipant) {
        byParticipant = new Map();
        participantSockets.set(message.roomId, byParticipant);
      }

      const priorConnection = byParticipant.get(message.participantId);
      byParticipant.set(message.participantId, {
        socket,
        sessionId: message.sessionId
      });

      // New connection becomes authoritative before the old socket closes.
      // The old close handler sees it has been superseded and does not emit leave.
      if (priorConnection && priorConnection.socket !== socket) {
        priorConnection.socket.close(4000, "session superseded");
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

    if (!session) {
      reject(socket, {
        requestId: message.requestId,
        code: "INVALID_SESSION",
        message: "Join a room before sending room intents."
      });
      return;
    }

    if (message.roomId !== session.roomId) {
      reject(socket, {
        requestId: message.requestId,
        code: "INVALID_SESSION",
        message: "This connection is bound to a different room."
      });
      return;
    }

    const currentConnection = participantSockets
      .get(session.roomId)
      ?.get(session.participantId);

    if (currentConnection?.socket !== socket) {
      reject(socket, {
        requestId: message.requestId,
        code: "INVALID_SESSION",
        message: "This connection has been superseded by a newer session."
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

      const target = participantSockets
        .get(session.roomId)
        ?.get(message.targetParticipantId)
        ?.socket;

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
        canonicalAcceptance: result.canonicalAcceptance
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

        // Application-level scratch is explicit temporary working material,
        // not model chain-of-thought and never part of RoomSnapshot/RoomEvent.
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

    const byParticipant = participantSockets.get(session.roomId);
    const current = byParticipant?.get(session.participantId);
    const isCurrentSocket = current?.socket === socket;

    if (!isCurrentSocket) return;

    byParticipant?.delete(session.participantId);
    if (byParticipant?.size === 0) {
      participantSockets.delete(session.roomId);
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

httpServer.listen(port, () => {
  console.log(
    `Commonline room service listening on http://localhost:${port} (${COMMONLINE_WIRE_SCHEMA_VERSION})`
  );
});
