import { createServer } from "node:http";
import { MockSilentAgent } from "@commonline/agent-runtime";
import type {
  ClientMessage,
  IntentRejectedMessage,
  RoomEventMessage,
  RoomSnapshotMessage,
  ServerMessage
} from "@commonline/protocol";
import { WebSocket, WebSocketServer } from "ws";
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

function parseMessage(raw: WebSocket.RawData): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw.toString()) as Partial<ClientMessage>;
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.type === "join_room" ||
        parsed.type === "submit_work" ||
        parsed.type === "accept_artifact")
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
        // P0-b keeps worker failure isolated from the human room transport.
      }
    }
  });

  socket.on("close", () => {
    if (!session) return;

    const sockets = roomSockets.get(session.roomId);
    sockets?.delete(socket);
    if (sockets?.size === 0) roomSockets.delete(session.roomId);

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
