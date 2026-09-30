import { createServer } from "node:http";
import { MockSilentAgent } from "@commonline/agent-runtime";
import type {
  ClientMessage,
  IntentRejectedMessage,
  RoomEventMessage,
  RoomSnapshotMessage,
  RtcSignalPayload,
  RtcSignalRelayMessage,
  ServerMessage
} from "@commonline/protocol";
import { WebSocket, WebSocketServer, type RawData } from "ws";
import { RoomService } from "./roomService";

const port = Number(process.env.PORT ?? 8787);
const service = new RoomService();
const agent = new MockSilentAgent("Vessie (silent worker)");

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "commonline-room" }));
    return;
  }
  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ server: httpServer });
const roomSockets = new Map<string, Set<WebSocket>>();
const clientSockets = new Map<string, Map<string, WebSocket>>();

function send(socket: WebSocket, message: ServerMessage) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function broadcast(roomId: string, message: RoomEventMessage, except?: WebSocket) {
  const sockets = roomSockets.get(roomId);
  if (!sockets) return;
  for (const socket of sockets) {
    if (socket !== except) send(socket, message);
  }
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
      parsed.type === "accept_artifact"
    ) {
      return parsed as ClientMessage;
    }

    if (
      parsed.type === "rtc_signal" &&
      typeof parsed.targetClientId === "string" &&
      parsed.targetClientId.length > 0 &&
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
  let session: { roomId: string; clientId: string } | null = null;

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
      if (
        !message.roomId ||
        !message.clientId ||
        !message.name?.trim() ||
        !Number.isInteger(message.acknowledgedVersion)
      ) {
        reject(socket, {
          requestId: message.requestId,
          code: "INVALID_INTENT",
          message: "join_room is missing required fields."
        });
        return;
      }

      session = {
        roomId: message.roomId,
        clientId: message.clientId
      };

      let sockets = roomSockets.get(message.roomId);
      if (!sockets) {
        sockets = new Set();
        roomSockets.set(message.roomId, sockets);
      }
      sockets.add(socket);

      let byClient = clientSockets.get(message.roomId);
      if (!byClient) {
        byClient = new Map();
        clientSockets.set(message.roomId, byClient);
      }
      byClient.set(message.clientId, socket);

      const joined = service.join({
        roomId: message.roomId,
        clientId: message.clientId,
        name: message.name.trim().slice(0, 64),
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
        broadcast(
          message.roomId,
          {
            type: "room_event",
            room: joined.room,
            event: joined.event
          },
          socket
        );
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

    if (message.type === "rtc_signal") {
      const permission = service.canRelayRtc(
        session.roomId,
        session.clientId,
        message.targetClientId
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

      const target = clientSockets
        .get(session.roomId)
        ?.get(message.targetClientId);

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
        fromClientId: session.clientId,
        signal: message.signal
      };
      send(target, relay);
      return;
    }

    const result = service.applyIntent(session.clientId, message);
    if (!result.ok) {
      reject(socket, {
        requestId: message.requestId,
        code: result.code,
        message: result.message,
        expectedVersion: result.room?.version,
        room: result.room
      });
      return;
    }

    broadcast(message.roomId, {
      type: "room_event",
      room: result.room,
      event: result.event
    });

    if (message.type === "submit_work" && result.work) {
      try {
        const artifact = await agent.perform(result.work);
        const proposed = service.proposeArtifact(message.roomId, artifact);
        if (proposed.ok) {
          broadcast(message.roomId, {
            type: "room_event",
            room: proposed.room,
            event: proposed.event
          });
        }
      } catch {
        // Agent work remains isolated from human media and room transport.
      }
    }
  });

  socket.on("close", () => {
    if (!session) return;

    const sockets = roomSockets.get(session.roomId);
    sockets?.delete(socket);
    if (sockets?.size === 0) roomSockets.delete(session.roomId);

    const byClient = clientSockets.get(session.roomId);
    const isCurrentSocket = byClient?.get(session.clientId) === socket;
    if (isCurrentSocket) {
      byClient?.delete(session.clientId);
      if (byClient?.size === 0) clientSockets.delete(session.roomId);
    }

    // If a newer connection replaced this socket, its participant stays online.
    if (!isCurrentSocket) return;

    const left = service.leave(session.roomId, session.clientId);
    if (left) {
      broadcast(session.roomId, {
        type: "room_event",
        room: left.room,
        event: left.event
      });
    }
  });
});

httpServer.listen(port, () => {
  console.log(`Commonline room service listening on http://localhost:${port}`);
});
