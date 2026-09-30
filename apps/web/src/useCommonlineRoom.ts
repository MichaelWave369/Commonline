import { useCallback, useMemo, useRef, useState } from "react";
import {
  COMMONLINE_WIRE_SCHEMA_VERSION,
  type AcceptanceReceipt,
  type AcceptOutcomeMessage,
  type AgentWorkStatusMessage,
  type JoinRoomMessage,
  type RequestedHumanRole,
  type RoomEvent,
  type RoomSnapshot,
  type RtcSignalClientMessage,
  type RtcSignalPayload,
  type RtcSignalRelayMessage,
  type ServerMessage,
  type SubmitWorkMessage
} from "@commonline/protocol";

const ROOM_ID = "commonline-p0";
const PARTICIPANT_ID_KEY = "commonline:p0d:participant-id";
const SESSION_ID_KEY = "commonline:p0d:session-id";
const ACK_KEY = "commonline:p0d:ack";
const NAME_KEY = "commonline:p0d:name";
const ROLE_KEY = "commonline:p0d:role";
const ACCEPT_ID_PREFIX = "commonline:p0d:accept:";

type ConnectionState =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected";

function websocketUrl() {
  const configured = import.meta.env.VITE_COMMONLINE_WS_URL as
    | string
    | undefined;
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:8787`;
}

function stableParticipantId() {
  let value = localStorage.getItem(PARTICIPANT_ID_KEY);
  if (!value) {
    value = `human-${crypto.randomUUID()}`;
    localStorage.setItem(PARTICIPANT_ID_KEY, value);
  }
  return value;
}

function tabSessionId() {
  let value = sessionStorage.getItem(SESSION_ID_KEY);
  if (!value) {
    value = `session-${crypto.randomUUID()}`;
    sessionStorage.setItem(SESSION_ID_KEY, value);
  }
  return value;
}

function acknowledgedVersion() {
  const value = Number(sessionStorage.getItem(ACK_KEY) ?? 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function useCommonlineRoom() {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const wantsConnectionRef = useRef(false);
  const openSocketRef = useRef<() => void>(() => undefined);

  const participantId = useMemo(() => stableParticipantId(), []);
  const sessionId = useMemo(() => tabSessionId(), []);

  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] =
    useState<ConnectionState>("disconnected");
  const [resumeDelta, setResumeDelta] = useState<RoomEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<RoomEvent | null>(null);
  const [lastAcceptance, setLastAcceptance] =
    useState<AcceptanceReceipt | null>(null);
  const [rtcInbox, setRtcInbox] = useState<RtcSignalRelayMessage[]>([]);
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, AgentWorkStatusMessage>
  >({});
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setNameState] = useState(
    () => localStorage.getItem(NAME_KEY) ?? "Mikey"
  );
  const nameRef = useRef(name);

  const [requestedRole, setRequestedRoleState] =
    useState<RequestedHumanRole>(() => {
      const stored = localStorage.getItem(ROLE_KEY);
      return stored === "observer" ? "observer" : "participant";
    });
  const requestedRoleRef = useRef(requestedRole);

  const rememberRoom = useCallback((snapshot: RoomSnapshot) => {
    setRoom(snapshot);
    sessionStorage.setItem(ACK_KEY, String(snapshot.version));
  }, []);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const scheduleReconnect = useCallback(() => {
    if (!wantsConnectionRef.current) return;

    const attempt = reconnectAttemptRef.current;
    reconnectAttemptRef.current += 1;

    const base = Math.min(8_000, 250 * 2 ** Math.min(attempt, 5));
    const jitter = Math.floor(Math.random() * Math.min(250, base * 0.25));
    const delay = base + jitter;

    setConnection("reconnecting");
    setNotice(`Connection lost. Retrying in ${delay} ms…`);

    clearReconnectTimer();
    reconnectTimerRef.current = window.setTimeout(() => {
      openSocketRef.current();
    }, delay);
  }, [clearReconnectTimer]);

  const openSocket = useCallback(() => {
    if (!wantsConnectionRef.current) return;
    if (
      socketRef.current?.readyState === WebSocket.OPEN ||
      socketRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    setConnection(
      reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting"
    );

    const socket = new WebSocket(websocketUrl());
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      const message: JoinRoomMessage = {
        type: "join_room",
        requestId: crypto.randomUUID(),
        schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
        roomId: ROOM_ID,
        participantId,
        sessionId,
        name: nameRef.current.trim(),
        requestedRole: requestedRoleRef.current,
        acknowledgedVersion: acknowledgedVersion()
      };
      socket.send(JSON.stringify(message));
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;

      if (message.type === "room_snapshot") {
        rememberRoom(message.room);
        setResumeDelta(message.resumeDelta);
        reconnectAttemptRef.current = 0;
        setConnection("connected");
        setNotice(
          message.resumeDelta.length
            ? `Resumed with ${message.resumeDelta.length} missed durable event(s).`
            : "Connected to authoritative room state."
        );
        return;
      }

      if (message.type === "room_event") {
        rememberRoom(message.room);
        setLastEvent(message.event);
        return;
      }

      if (message.type === "acceptance_receipt") {
        rememberRoom(message.room);
        setLastAcceptance(message.receipt);
        sessionStorage.removeItem(
          `${ACCEPT_ID_PREFIX}${message.receipt.workItemId}`
        );
        setNotice(
          message.replayed
            ? "Recovered the original acceptance receipt after retry."
            : "Outcome accepted with a durable receipt."
        );
        return;
      }

      if (message.type === "agent_work_status") {
        setAgentStatuses((current) => ({
          ...current,
          [`${message.participantId}:${message.workItemId}`]: message
        }));
        return;
      }

      if (message.type === "rtc_signal") {
        setRtcInbox((current) => [...current, message]);
        return;
      }

      if (message.room) rememberRoom(message.room);

      if (
        message.code === "OUTCOME_ALREADY_ACCEPTED" &&
        message.canonicalAcceptance
      ) {
        setLastAcceptance(message.canonicalAcceptance);
      }

      setNotice(
        message.code === "STALE_VERSION"
          ? "Room changed before your action landed. State reconciled; retry the action."
          : message.message
      );
    });

    socket.addEventListener("close", (event) => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setRtcInbox([]);

      if (event.code === 4000) {
        wantsConnectionRef.current = false;
        clearReconnectTimer();
        setConnection("disconnected");
        setNotice(
          "This session was superseded by a newer connection for the same participant."
        );
        return;
      }

      if (!wantsConnectionRef.current) {
        setConnection("disconnected");
        return;
      }

      scheduleReconnect();
    });

    socket.addEventListener("error", () => {
      setNotice("Commonline transport error. Reconnect policy is active.");
    });
  }, [
    clearReconnectTimer,
    participantId,
    rememberRoom,
    scheduleReconnect,
    sessionId
  ]);

  openSocketRef.current = openSocket;

  const connect = useCallback(() => {
    const cleaned = nameRef.current.trim();
    if (!cleaned || wantsConnectionRef.current) return;

    localStorage.setItem(NAME_KEY, cleaned);
    localStorage.setItem(ROLE_KEY, requestedRoleRef.current);
    wantsConnectionRef.current = true;
    reconnectAttemptRef.current = 0;
    setNotice(null);
    openSocketRef.current();
  }, []);

  const disconnect = useCallback(() => {
    wantsConnectionRef.current = false;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    socketRef.current?.close(1000, "participant left");
    socketRef.current = null;
    setConnection("disconnected");
  }, [clearReconnectTimer]);

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

  const acceptOutcome = useCallback(
    (workItemId: string, artifactId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) return;

      const grant = room.grants.find(
        (receipt) =>
          receipt.subjectParticipantId === participantId &&
          receipt.capability === "ACCEPT_OUTCOME" &&
          !receipt.revokedAt
      );

      if (!grant) {
        setNotice("No active ACCEPT_OUTCOME grant is available for this participant.");
        return;
      }

      const storageKey = `${ACCEPT_ID_PREFIX}${workItemId}`;
      let acceptId = sessionStorage.getItem(storageKey);
      if (!acceptId) {
        acceptId = `accept-${crypto.randomUUID()}`;
        sessionStorage.setItem(storageKey, acceptId);
      }

      const message: AcceptOutcomeMessage = {
        type: "accept_outcome",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        baseVersion: room.version,
        acceptId,
        workItemId,
        artifactId,
        authorityGrantId: grant.grantId
      };
      socketRef.current.send(JSON.stringify(message));
    },
    [participantId, room]
  );

  const sendRtcSignal = useCallback(
    (targetParticipantId: string, signal: RtcSignalPayload) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }
      const message: RtcSignalClientMessage = {
        type: "rtc_signal",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        targetParticipantId,
        signal
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const consumeRtcSignal = useCallback((requestId: string) => {
    setRtcInbox((current) =>
      current.filter((message) => message.requestId !== requestId)
    );
  }, []);

  const setName = useCallback((value: string) => {
    nameRef.current = value;
    setNameState(value);
  }, []);

  const setRequestedRole = useCallback((value: RequestedHumanRole) => {
    requestedRoleRef.current = value;
    setRequestedRoleState(value);
  }, []);

  return {
    participantId,
    sessionId,
    name,
    setName,
    requestedRole,
    setRequestedRole,
    room,
    connection,
    resumeDelta,
    lastEvent,
    lastAcceptance,
    agentStatuses,
    rtcInbox,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptOutcome,
    sendRtcSignal,
    consumeRtcSignal
  };
}
