import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AcceptArtifactMessage,
  JoinRoomMessage,
  RoomEvent,
  RoomSnapshot,
  ServerMessage,
  SubmitWorkMessage
} from "@commonline/protocol";

const ROOM_ID = "commonline-p0";
const CLIENT_ID_KEY = "commonline:p0b:client-id";
const ACK_KEY = "commonline:p0b:ack";
const NAME_KEY = "commonline:p0b:name";

type ConnectionState = "disconnected" | "connecting" | "connected";

function websocketUrl() {
  const configured = import.meta.env.VITE_COMMONLINE_WS_URL as string | undefined;
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:8787`;
}

function sessionClientId() {
  let value = sessionStorage.getItem(CLIENT_ID_KEY);
  if (!value) {
    value = `human-${crypto.randomUUID()}`;
    sessionStorage.setItem(CLIENT_ID_KEY, value);
  }
  return value;
}

function acknowledgedVersion() {
  const value = Number(sessionStorage.getItem(ACK_KEY) ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function useCommonlineRoom() {
  const socketRef = useRef<WebSocket | null>(null);
  const clientId = useMemo(() => sessionClientId(), []);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("disconnected");
  const [resumeDelta, setResumeDelta] = useState<RoomEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<RoomEvent | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setNameState] = useState(() => localStorage.getItem(NAME_KEY) ?? "Mikey");

  const rememberRoom = useCallback((snapshot: RoomSnapshot) => {
    setRoom(snapshot);
    sessionStorage.setItem(ACK_KEY, String(snapshot.version));
  }, []);

  const connect = useCallback(() => {
    const cleaned = name.trim();
    if (!cleaned || connection !== "disconnected") return;

    localStorage.setItem(NAME_KEY, cleaned);
    setConnection("connecting");
    setNotice(null);

    const socket = new WebSocket(websocketUrl());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      const message: JoinRoomMessage = {
        type: "join_room",
        requestId: crypto.randomUUID(),
        roomId: ROOM_ID,
        clientId,
        name: cleaned,
        acknowledgedVersion: acknowledgedVersion()
      };
      socket.send(JSON.stringify(message));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;

      if (message.type === "room_snapshot") {
        rememberRoom(message.room);
        setResumeDelta(message.resumeDelta);
        setConnection("connected");
        setNotice(
          message.resumeDelta.length
            ? `Resumed with ${message.resumeDelta.length} missed room event(s).`
            : "Connected to authoritative room state."
        );
        return;
      }

      if (message.type === "room_event") {
        rememberRoom(message.room);
        setLastEvent(message.event);
        return;
      }

      if (message.room) rememberRoom(message.room);
      setNotice(
        message.code === "STALE_VERSION"
          ? "Room changed before your action landed. State reconciled; retry the action."
          : message.message
      );
    });

    socket.addEventListener("close", () => {
      setConnection("disconnected");
      socketRef.current = null;
    });

    socket.addEventListener("error", () => {
      setNotice("Could not reach the Commonline room service.");
    });
  }, [clientId, connection, name, rememberRoom]);

  const disconnect = useCallback(() => {
    socketRef.current?.close();
  }, []);

  const submitWork = useCallback(
    (prompt: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) return;
      const message: SubmitWorkMessage = {
        type: "submit_work",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        baseVersion: room.version,
        prompt
      };
      socketRef.current.send(JSON.stringify(message));
    },
    [room]
  );

  const acceptArtifact = useCallback(
    (artifactId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) return;
      const message: AcceptArtifactMessage = {
        type: "accept_artifact",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        baseVersion: room.version,
        artifactId
      };
      socketRef.current.send(JSON.stringify(message));
    },
    [room]
  );

  const setName = useCallback((value: string) => {
    setNameState(value);
  }, []);

  return {
    clientId,
    name,
    setName,
    room,
    connection,
    resumeDelta,
    lastEvent,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptArtifact
  };
}
