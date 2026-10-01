import { useCallback, useRef, useState } from "react";
import {
  COMMONLINE_WIRE_SCHEMA_VERSION,
  type AcceptanceReceipt,
  type AcceptOutcomeMessage,
  type AgentTurnStatusMessage,
  type AgentVoiceGrantReceipt,
  type AgentVoiceRevocationReceipt,
  type AgentVoiceUtteranceStatusMessage,
  type AttentionLease,
  type AgentWorkStatusMessage,
  type AuthorityTransferReceipt,
  type BootstrapAgentVoiceAuthorityMessage,
  type GroupMediaJoinMessage,
  type GroupMediaLeaveMessage,
  type GroupMediaPublishSourceMessage,
  type GroupMediaStateMessage,
  type GroupMediaSubscribeMessage,
  type GroupMediaUnpublishMessage,
  type GroupMediaUnsubscribeMessage,
  type GroupRtcSignalClientMessage,
  type GroupRtcSignalRelayMessage,
  type IdentityBeginMessage,
  type IdentityChallengeMessage,
  type IdentityProveMessage,
  type IdentityRecoverMessage,
  type JoinRoomMessage,
  type GrantAgentVoiceMessage,
  type GrantAttentionLeaseMessage,
  type MediaSourceKind,
  type RequestedHumanRole,
  type RevokeAgentVoiceMessage,
  type RevokeAttentionLeaseMessage,
  type RequestAgentTurnMessage,
  type RequestAgentVoiceUtteranceMessage,
  type RoomEvent,
  type RoomSnapshot,
  type RtcCallOpenMessage,
  type RtcCallSessionMessage,
  type RtcConfigMessage,
  type RtcConfigRequestMessage,
  type RtcSignalClientMessage,
  type RtcSignalPayload,
  type RtcSignalRelayMessage,
  type ServerMessage,
  type SfuCapabilitiesMessage,
  type SfuCapabilitiesRequestMessage,
  type SfuConsumeMessage,
  type SfuConsumedMessage,
  type SfuConsumerResumeMessage,
  type SfuConsumerResumedMessage,
  type SfuProduceMessage,
  type SfuProducedMessage,
  type SfuTransportConnectMessage,
  type SfuTransportConnectedMessage,
  type SfuTransportCreateMessage,
  type SfuTransportCreatedMessage,
  type SubmitWorkMessage,
  type TransferAcceptAuthorityMessage,
  type VoiceAuthorityBootstrapReceipt
} from "@commonline/protocol";
import {
  createIdentityCandidate,
  getOrCreateIdentity,
  signIdentityChallenge,
  storeIdentity,
  type LocalIdentity
} from "./identityVault";
import { resolveCommonlineWebSocketUrl } from "./transportSecurity";

const ROOM_ID = "commonline-p0";
const PARTICIPANT_ID_KEY = "commonline:p0d:participant-id";
const SESSION_ID_KEY = "commonline:p0d:session-id";
const ACK_KEY = "commonline:p0d:ack";
const NAME_KEY = "commonline:p0d:name";
const ROLE_KEY = "commonline:p0d:role";
const ACCEPT_ID_PREFIX = "commonline:p0d:accept:";
const TRANSFER_ID_PREFIX = "commonline:p0f:transfer:";
const VOICE_BOOTSTRAP_ID_PREFIX = "commonline:p0m:voice-bootstrap:";
const VOICE_GRANT_ID_PREFIX = "commonline:p0m:voice-grant:";
const VOICE_REVOKE_ID_PREFIX = "commonline:p0m:voice-revoke:";

type ConnectionState =
  | "disconnected"
  | "connecting"
  | "reconnecting"
  | "connected";

export type IdentityState =
  | "idle"
  | "challenging"
  | "authenticated"
  | "recovery-required";

type SfuClientMessage =
  | SfuCapabilitiesRequestMessage
  | SfuTransportCreateMessage
  | SfuTransportConnectMessage
  | SfuProduceMessage
  | SfuConsumeMessage
  | SfuConsumerResumeMessage;

export type SfuServerResponse =
  | SfuCapabilitiesMessage
  | SfuTransportCreatedMessage
  | SfuTransportConnectedMessage
  | SfuProducedMessage
  | SfuConsumedMessage
  | SfuConsumerResumedMessage;

interface PendingSfuRequest {
  resolve: (message: SfuServerResponse) => void;
  reject: (error: Error) => void;
  timer: number;
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
  const rtcConfigTimerRef = useRef<number | null>(null);
  const reconnectAttemptRef = useRef(0);
  const wantsConnectionRef = useRef(false);
  const openSocketRef = useRef<() => void>(() => undefined);
  const pendingSfuRef = useRef(new Map<string, PendingSfuRequest>());

  const initialParticipantId = stableParticipantId();
  const [participantId, setParticipantIdState] = useState(initialParticipantId);
  const participantIdRef = useRef(initialParticipantId);
  const sessionId = useRef(tabSessionId()).current;
  const identityRef = useRef<LocalIdentity | null>(null);
  const pendingRecoveryRef = useRef<{
    participantId: string;
    recoveryCode: string;
    candidate: LocalIdentity;
  } | null>(null);

  const [identityState, setIdentityState] = useState<IdentityState>("idle");
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [connection, setConnection] =
    useState<ConnectionState>("disconnected");
  const [resumeDelta, setResumeDelta] = useState<RoomEvent[]>([]);
  const [lastEvent, setLastEvent] = useState<RoomEvent | null>(null);
  const [lastAcceptance, setLastAcceptance] =
    useState<AcceptanceReceipt | null>(null);
  const [lastAuthorityTransfer, setLastAuthorityTransfer] =
    useState<AuthorityTransferReceipt | null>(null);
  const [lastVoiceAuthorityBootstrap, setLastVoiceAuthorityBootstrap] =
    useState<VoiceAuthorityBootstrapReceipt | null>(null);
  const [lastAgentVoiceGrant, setLastAgentVoiceGrant] =
    useState<AgentVoiceGrantReceipt | null>(null);
  const [lastAgentVoiceRevocation, setLastAgentVoiceRevocation] =
    useState<AgentVoiceRevocationReceipt | null>(null);
  const [lastAgentVoiceUtteranceStatus, setLastAgentVoiceUtteranceStatus] =
    useState<AgentVoiceUtteranceStatusMessage | null>(null);
  const [attentionLease, setAttentionLease] =
    useState<AttentionLease | null>(null);
  const [lastAgentTurnStatus, setLastAgentTurnStatus] =
    useState<AgentTurnStatusMessage | null>(null);
  const [rtcInbox, setRtcInbox] = useState<RtcSignalRelayMessage[]>([]);
  const [rtcSessionInbox, setRtcSessionInbox] = useState<RtcCallSessionMessage[]>([]);
  const [groupRtcInbox, setGroupRtcInbox] = useState<GroupRtcSignalRelayMessage[]>([]);
  const [groupMediaState, setGroupMediaState] =
    useState<GroupMediaStateMessage | null>(null);
  const [rtcConfig, setRtcConfig] = useState<RtcConfigMessage | null>(null);
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

  const rejectPendingSfu = useCallback((reason: string) => {
    for (const pending of pendingSfuRef.current.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    pendingSfuRef.current.clear();
  }, []);

  const clearRtcConfigTimer = useCallback(() => {
    if (rtcConfigTimerRef.current !== null) {
      window.clearTimeout(rtcConfigTimerRef.current);
      rtcConfigTimerRef.current = null;
    }
  }, []);

  const sendJoin = useCallback((socket: WebSocket) => {
    const message: JoinRoomMessage = {
      type: "join_room",
      requestId: crypto.randomUUID(),
      schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
      roomId: ROOM_ID,
      participantId: participantIdRef.current,
      sessionId,
      name: nameRef.current.trim(),
      requestedRole: requestedRoleRef.current,
      acknowledgedVersion: acknowledgedVersion()
    };
    socket.send(JSON.stringify(message));
  }, [sessionId]);

  const beginIdentity = useCallback(async (socket: WebSocket) => {
    try {
      const identity = await getOrCreateIdentity(participantIdRef.current);
      identityRef.current = identity;
      setIdentityState("challenging");

      const message: IdentityBeginMessage = {
        type: "identity_begin",
        requestId: crypto.randomUUID(),
        schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
        participantId: participantIdRef.current,
        sessionId,
        publicKey: identity.publicKey
      };
      socket.send(JSON.stringify(message));
    } catch (error) {
      setIdentityState("recovery-required");
      setNotice(
        error instanceof Error
          ? error.message
          : "Could not initialize local cryptographic identity."
      );
    }
  }, [sessionId]);

  const scheduleReconnect = useCallback(() => {
    if (!wantsConnectionRef.current) return;

    const attempt = reconnectAttemptRef.current;
    reconnectAttemptRef.current += 1;

    const base = Math.min(8_000, 250 * 2 ** Math.min(attempt, 5));
    const jitter = Math.floor(Math.random() * Math.min(250, base * 0.25));
    const delay = base + jitter;

    setConnection("reconnecting");
    setIdentityState("idle");
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
    setIdentityState("idle");

    let signalingUrl: string;
    try {
      signalingUrl = resolveCommonlineWebSocketUrl({
        pageUrl: window.location.href,
        configuredUrl: import.meta.env.VITE_COMMONLINE_WS_URL as
          | string
          | undefined
      });
    } catch (error) {
      wantsConnectionRef.current = false;
      setConnection("disconnected");
      setNotice(
        error instanceof Error
          ? error.message
          : "Commonline refused an insecure signaling configuration."
      );
      return;
    }

    const socket = new WebSocket(signalingUrl);
    socketRef.current = socket;

    socket.addEventListener("open", () => {
      const pending = pendingRecoveryRef.current;
      if (pending) {
        const message: IdentityRecoverMessage = {
          type: "identity_recover",
          requestId: crypto.randomUUID(),
          schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
          participantId: pending.participantId,
          sessionId,
          recoveryCode: pending.recoveryCode,
          newPublicKey: pending.candidate.publicKey
        };
        socket.send(JSON.stringify(message));
        return;
      }

      void beginIdentity(socket);
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage;

      if ("requestId" in message) {
        const pending = pendingSfuRef.current.get(message.requestId);
        if (pending) {
          pendingSfuRef.current.delete(message.requestId);
          window.clearTimeout(pending.timer);

          if (message.type === "intent_rejected") {
            pending.reject(
              new Error(`${message.code}: ${message.message}`)
            );
          } else if (
            message.type === "sfu_capabilities" ||
            message.type === "sfu_transport_created" ||
            message.type === "sfu_transport_connected" ||
            message.type === "sfu_produced" ||
            message.type === "sfu_consumed" ||
            message.type === "sfu_consumer_resumed"
          ) {
            pending.resolve(message);
          } else {
            pending.reject(
              new Error(
                `Unexpected SFU response type ${message.type}.`
              )
            );
          }
          return;
        }
      }

      if (message.type === "identity_challenge") {
        const localIdentity = identityRef.current;
        if (
          !localIdentity ||
          localIdentity.participantId !== message.participantId
        ) {
          setIdentityState("recovery-required");
          setNotice("No matching local private key is available for this identity.");
          return;
        }

        void signIdentityChallenge(localIdentity, message)
          .then((signature) => {
            const proof: IdentityProveMessage = {
              type: "identity_prove",
              requestId: crypto.randomUUID(),
              challengeId: message.challengeId,
              signature
            };
            socket.send(JSON.stringify(proof));
          })
          .catch((error) => {
            setIdentityState("recovery-required");
            setNotice(
              error instanceof Error
                ? error.message
                : "Could not sign the identity challenge."
            );
          });
        return;
      }

      if (message.type === "identity_authenticated") {
        setIdentityState("authenticated");
        reconnectAttemptRef.current = 0;

        if (message.recoveryCode) {
          setRecoveryCode(message.recoveryCode);
        }

        if (message.recovered && pendingRecoveryRef.current) {
          const recoveredIdentity = pendingRecoveryRef.current.candidate;
          void storeIdentity(recoveredIdentity)
            .then(() => {
              identityRef.current = recoveredIdentity;
              pendingRecoveryRef.current = null;
              sendJoin(socket);
            })
            .catch((error) => {
              setNotice(
                error instanceof Error
                  ? error.message
                  : "Identity recovered remotely but the replacement key could not be stored locally."
              );
            });
          return;
        }

        sendJoin(socket);
        return;
      }

      if (message.type === "room_snapshot") {
        rememberRoom(message.room);
        setResumeDelta(message.resumeDelta);
        reconnectAttemptRef.current = 0;
        setConnection("connected");

        const rtcRequest: RtcConfigRequestMessage = {
          type: "rtc_config_request",
          requestId: crypto.randomUUID(),
          roomId: message.room.roomId
        };
        socket.send(JSON.stringify(rtcRequest));

        setNotice(
          message.resumeDelta.length
            ? `Authenticated and resumed with ${message.resumeDelta.length} missed durable event(s).`
            : "Authenticated and connected to authoritative room state."
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

      if (message.type === "authority_transfer_receipt") {
        rememberRoom(message.room);
        setLastAuthorityTransfer(message.receipt);
        setNotice(
          message.replayed
            ? "Recovered the original authority-transfer receipt after retry."
            : "ACCEPT_OUTCOME authority transferred with durable receipts."
        );
        return;
      }

      if (message.type === "voice_authority_bootstrap_receipt") {
        rememberRoom(message.room);
        setLastVoiceAuthorityBootstrap(message.receipt);
        sessionStorage.removeItem(
          `${VOICE_BOOTSTRAP_ID_PREFIX}${message.room.roomId}`
        );
        setNotice(
          message.replayed
            ? "Recovered the original voice-authority bootstrap receipt."
            : "Dedicated MANAGE_AGENT_VOICE authority bootstrapped."
        );
        return;
      }

      if (message.type === "agent_voice_grant_receipt") {
        rememberRoom(message.room);
        setLastAgentVoiceGrant(message.receipt);
        sessionStorage.removeItem(
          `${VOICE_GRANT_ID_PREFIX}${message.receipt.agentParticipantId}`
        );
        setNotice(
          message.replayed
            ? "Recovered the original agent-voice grant receipt."
            : "Agent voice granted with a durable receipt."
        );
        return;
      }

      if (message.type === "agent_voice_revocation_receipt") {
        rememberRoom(message.room);
        setLastAgentVoiceRevocation(message.receipt);
        sessionStorage.removeItem(
          `${VOICE_REVOKE_ID_PREFIX}${message.receipt.voiceGrantId}`
        );
        setNotice(
          message.replayed
            ? "Recovered the original agent-voice revocation receipt."
            : "Agent voice revoked with a durable receipt."
        );
        return;
      }

      if (message.type === "agent_voice_utterance_status") {
        setLastAgentVoiceUtteranceStatus(message);
        if (message.state === "failed") {
          setNotice(
            `Agent voice failed: ${message.errorCode ?? "unknown renderer error"}`
          );
        } else if (message.state === "completed") {
          setNotice("Agent voice utterance completed through the governed renderer.");
        }
        return;
      }

      if (message.type === "attention_lease_state") {
        setAttentionLease(message.lease);
        setNotice(
          message.lease.state === "active"
            ? "One-turn attention lease granted."
            : `Attention lease is now ${message.lease.state}.`
        );
        return;
      }

      if (message.type === "agent_turn_status") {
        setLastAgentTurnStatus(message);
        if (message.state === "failed") {
          setNotice(
            `Agent turn failed: ${message.errorCode ?? "unknown turn error"}`
          );
        } else if (message.state === "completed") {
          setNotice("Vessie completed one attention-leased turn.");
        }
        return;
      }

      if (message.type === "agent_work_status") {
        setAgentStatuses((current) => ({
          ...current,
          [`${message.participantId}:${message.workItemId}`]: message
        }));
        return;
      }

      if (message.type === "rtc_config") {
        setRtcConfig(message);
        clearRtcConfigTimer();

        if (message.expiresAt) {
          const refreshIn = Math.max(
            5_000,
            Date.parse(message.expiresAt) - Date.now() - 60_000
          );
          rtcConfigTimerRef.current = window.setTimeout(() => {
            if (socket.readyState !== WebSocket.OPEN) return;
            const refresh: RtcConfigRequestMessage = {
              type: "rtc_config_request",
              requestId: crypto.randomUUID(),
              roomId: message.roomId
            };
            socket.send(JSON.stringify(refresh));
          }, refreshIn);
        }
        return;
      }

      if (message.type === "rtc_call_session") {
        setRtcSessionInbox((current) => [...current, message]);
        return;
      }

      if (message.type === "group_media_state") {
        setGroupMediaState(message);
        return;
      }

      if (message.type === "group_rtc_signal") {
        setGroupRtcInbox((current) => [...current, message]);
        return;
      }

      if (message.type === "rtc_signal") {
        setRtcInbox((current) => [...current, message]);
        return;
      }

      // Correlated SFU replies are consumed by requestSfu above. Any SFU
      // response without a pending request is stale transport chatter, not a
      // generic intent rejection.
      if (message.type !== "intent_rejected") {
        return;
      }

      if (message.room) rememberRoom(message.room);

      if (
        message.code === "OUTCOME_ALREADY_ACCEPTED" &&
        message.canonicalAcceptance
      ) {
        setLastAcceptance(message.canonicalAcceptance);
      }

      if (
        message.code === "TRANSFER_ALREADY_APPLIED" &&
        message.canonicalTransfer
      ) {
        setLastAuthorityTransfer(message.canonicalTransfer);
      }

      if (message.canonicalVoiceBootstrap) {
        setLastVoiceAuthorityBootstrap(message.canonicalVoiceBootstrap);
      }
      if (message.canonicalVoiceGrant) {
        setLastAgentVoiceGrant(message.canonicalVoiceGrant);
      }
      if (message.canonicalVoiceRevocation) {
        setLastAgentVoiceRevocation(message.canonicalVoiceRevocation);
      }

      if (
        message.code === "IDENTITY_PROOF_INVALID" ||
        message.code === "IDENTITY_RECOVERY_INVALID" ||
        message.code === "IDENTITY_NOT_FOUND"
      ) {
        setIdentityState("recovery-required");
        if (message.code === "IDENTITY_RECOVERY_INVALID") {
          pendingRecoveryRef.current = null;
        }
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
      setRtcSessionInbox([]);
      setGroupRtcInbox([]);
      setGroupMediaState(null);
      rejectPendingSfu("Commonline signaling connection closed.");
      setRtcConfig(null);
      clearRtcConfigTimer();
      setIdentityState("idle");

      if (event.code === 4000) {
        wantsConnectionRef.current = false;
        clearReconnectTimer();
        setConnection("disconnected");
        setNotice(
          "This session was superseded by a newer connection for the same authenticated participant."
        );
        return;
      }

      if (event.code === 4400) {
        wantsConnectionRef.current = false;
        clearReconnectTimer();
        setConnection("disconnected");
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
    beginIdentity,
    clearReconnectTimer,
    clearRtcConfigTimer,
    rememberRoom,
    scheduleReconnect,
    sendJoin
  ]);

  openSocketRef.current = openSocket;

  const connect = useCallback(() => {
    const cleaned = nameRef.current.trim();
    if (!cleaned || wantsConnectionRef.current) return;

    localStorage.setItem(NAME_KEY, cleaned);
    localStorage.setItem(ROLE_KEY, requestedRoleRef.current);
    wantsConnectionRef.current = true;
    reconnectAttemptRef.current = 0;
    setRecoveryCode(null);
    setNotice(null);
    openSocketRef.current();
  }, []);

  const disconnect = useCallback(() => {
    wantsConnectionRef.current = false;
    reconnectAttemptRef.current = 0;
    clearReconnectTimer();
    clearRtcConfigTimer();
    socketRef.current?.close(1000, "participant left");
    socketRef.current = null;
    setConnection("disconnected");
    setIdentityState("idle");
  }, [clearReconnectTimer, clearRtcConfigTimer]);

  const recoverIdentity = useCallback(
    async (recoverParticipantId: string, code: string) => {
      const cleanedId = recoverParticipantId.trim();
      const cleanedCode = code.trim();
      if (!cleanedId || !cleanedCode) {
        setNotice("Recovery requires both participant ID and recovery code.");
        return;
      }

      try {
        const candidate = await createIdentityCandidate(cleanedId);
        pendingRecoveryRef.current = {
          participantId: cleanedId,
          recoveryCode: cleanedCode,
          candidate
        };
        participantIdRef.current = cleanedId;
        setParticipantIdState(cleanedId);
        localStorage.setItem(PARTICIPANT_ID_KEY, cleanedId);
        setIdentityState("challenging");

        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          const message: IdentityRecoverMessage = {
            type: "identity_recover",
            requestId: crypto.randomUUID(),
            schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
            participantId: cleanedId,
            sessionId,
            recoveryCode: cleanedCode,
            newPublicKey: candidate.publicKey
          };
          socket.send(JSON.stringify(message));
          return;
        }

        wantsConnectionRef.current = true;
        reconnectAttemptRef.current = 0;
        openSocketRef.current();
      } catch (error) {
        pendingRecoveryRef.current = null;
        setNotice(
          error instanceof Error
            ? error.message
            : "Could not prepare replacement identity key."
        );
      }
    },
    [sessionId]
  );

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
          receipt.subjectParticipantId === participantIdRef.current &&
          receipt.capability === "ACCEPT_OUTCOME" &&
          !receipt.revokedAt &&
          !room.grantRevocations.some(
            (revocation) => revocation.grantId === receipt.grantId
          )
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
    [room]
  );

  const transferAcceptAuthority = useCallback(
    (targetParticipantId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) return;

      const authorityGrant = room.grants.find(
        (receipt) =>
          receipt.subjectParticipantId === participantIdRef.current &&
          receipt.capability === "ACCEPT_OUTCOME" &&
          !receipt.revokedAt &&
          !room.grantRevocations.some(
            (revocation) => revocation.grantId === receipt.grantId
          )
      );

      if (!authorityGrant) {
        setNotice("Only the current ACCEPT_OUTCOME authority holder can transfer it.");
        return;
      }

      const storageKey =
        `${TRANSFER_ID_PREFIX}${authorityGrant.grantId}:${targetParticipantId}`;
      let transferId = sessionStorage.getItem(storageKey);
      if (!transferId) {
        transferId = `transfer-${crypto.randomUUID()}`;
        sessionStorage.setItem(storageKey, transferId);
      }

      const message: TransferAcceptAuthorityMessage = {
        type: "transfer_accept_authority",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        baseVersion: room.version,
        transferId,
        targetParticipantId,
        authorityGrantId: authorityGrant.grantId
      };
      socketRef.current.send(JSON.stringify(message));
    },
    [room]
  );

  const bootstrapAgentVoiceAuthority = useCallback(
    (acceptAuthorityGrantId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const storageKey = `${VOICE_BOOTSTRAP_ID_PREFIX}${room.roomId}`;
      let bootstrapId = sessionStorage.getItem(storageKey);
      if (!bootstrapId) {
        bootstrapId = `voice-bootstrap-${crypto.randomUUID()}`;
        sessionStorage.setItem(storageKey, bootstrapId);
      }

      const message: BootstrapAgentVoiceAuthorityMessage = {
        type: "bootstrap_agent_voice_authority",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        baseVersion: room.version,
        bootstrapId,
        acceptAuthorityGrantId
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const grantAgentVoice = useCallback(
    (
      agentParticipantId: string,
      voiceId: string,
      authorityGrantId: string,
      expiresAt?: string
    ) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const storageKey =
        `${VOICE_GRANT_ID_PREFIX}${agentParticipantId}`;
      let grantRequestId = sessionStorage.getItem(storageKey);
      if (!grantRequestId) {
        grantRequestId = `voice-grant-${crypto.randomUUID()}`;
        sessionStorage.setItem(storageKey, grantRequestId);
      }

      const message: GrantAgentVoiceMessage = {
        type: "grant_agent_voice",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        baseVersion: room.version,
        grantRequestId,
        agentParticipantId,
        voiceId,
        authorityGrantId,
        expiresAt
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const revokeAgentVoice = useCallback(
    (voiceGrantId: string, authorityGrantId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const storageKey =
        `${VOICE_REVOKE_ID_PREFIX}${voiceGrantId}`;
      let revokeRequestId = sessionStorage.getItem(storageKey);
      if (!revokeRequestId) {
        revokeRequestId = `voice-revoke-${crypto.randomUUID()}`;
        sessionStorage.setItem(storageKey, revokeRequestId);
      }

      const message: RevokeAgentVoiceMessage = {
        type: "revoke_agent_voice",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        baseVersion: room.version,
        revokeRequestId,
        voiceGrantId,
        authorityGrantId
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const grantAttentionLease = useCallback(
    (agentParticipantId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const message: GrantAttentionLeaseMessage = {
        type: "grant_attention_lease",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        agentParticipantId
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const revokeAttentionLease = useCallback(
    (leaseId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const message: RevokeAttentionLeaseMessage = {
        type: "revoke_attention_lease",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        leaseId
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const requestAgentTurn = useCallback(
    (
      agentParticipantId: string,
      attentionLeaseId: string,
      prompt: string
    ) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const message: RequestAgentTurnMessage = {
        type: "request_agent_turn",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        turnRequestId: `agent-turn-${crypto.randomUUID()}`,
        attentionLeaseId,
        agentParticipantId,
        prompt
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const requestAgentVoiceUtterance = useCallback(
    (
      agentParticipantId: string,
      voiceGrantId: string,
      authorityGrantId: string
    ) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const message: RequestAgentVoiceUtteranceMessage = {
        type: "request_agent_voice_utterance",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        agentParticipantId,
        voiceGrantId,
        authorityGrantId,
        utteranceKind: "authority-proof"
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const openRtcCall = useCallback(
    (targetParticipantId: string) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }

      const message: RtcCallOpenMessage = {
        type: "rtc_call_open",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        targetParticipantId
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const sendRtcSignal = useCallback(
    (
      targetParticipantId: string,
      callId: string,
      generation: number,
      signal: RtcSignalPayload
    ) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }
      const message: RtcSignalClientMessage = {
        type: "rtc_signal",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        callId,
        generation,
        targetParticipantId,
        signal
      };
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const requestSfu = useCallback(
    (message: SfuClientMessage): Promise<SfuServerResponse> => {
      const socket = socketRef.current;
      if (!room || !socket || socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(
          new Error("Commonline signaling is not connected.")
        );
      }

      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => {
          pendingSfuRef.current.delete(message.requestId);
          reject(
            new Error(
              `SFU request ${message.type} timed out.`
            )
          );
        }, 12_000);

        pendingSfuRef.current.set(message.requestId, {
          resolve,
          reject,
          timer
        });

        socket.send(JSON.stringify(message));
      });
    },
    [room]
  );

  const sendGroupMessage = useCallback(
    (message:
      | GroupMediaJoinMessage
      | GroupMediaLeaveMessage
      | GroupMediaPublishSourceMessage
      | GroupMediaUnpublishMessage
      | GroupMediaSubscribeMessage
      | GroupMediaUnsubscribeMessage
      | GroupRtcSignalClientMessage) => {
      if (!room || socketRef.current?.readyState !== WebSocket.OPEN) {
        return false;
      }
      socketRef.current.send(JSON.stringify(message));
      return true;
    },
    [room]
  );

  const joinGroupMedia = useCallback(() => {
    if (!room) return false;
    return sendGroupMessage({
      type: "group_media_join",
      requestId: crypto.randomUUID(),
      roomId: room.roomId
    });
  }, [room, sendGroupMessage]);

  const leaveGroupMedia = useCallback(() => {
    if (!room) return false;
    const sent = sendGroupMessage({
      type: "group_media_leave",
      requestId: crypto.randomUUID(),
      roomId: room.roomId
    });
    if (sent) {
      setGroupMediaState(null);
      setGroupRtcInbox([]);
    }
    return sent;
  }, [room, sendGroupMessage]);

  const publishGroupSource = useCallback(
    (kind: MediaSourceKind, label: string) => {
      if (!room) return false;
      return sendGroupMessage({
        type: "group_media_publish_source",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        kind,
        label
      });
    },
    [room, sendGroupMessage]
  );

  const unpublishGroupSource = useCallback(
    (sourceId: string) => {
      if (!room) return false;
      return sendGroupMessage({
        type: "group_media_unpublish",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        sourceId
      });
    },
    [room, sendGroupMessage]
  );

  const subscribeGroupSource = useCallback(
    (sourceId: string) => {
      if (!room) return false;
      return sendGroupMessage({
        type: "group_media_subscribe",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        sourceId
      });
    },
    [room, sendGroupMessage]
  );

  const unsubscribeGroupSource = useCallback(
    (sourceId: string) => {
      if (!room) return false;
      return sendGroupMessage({
        type: "group_media_unsubscribe",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        sourceId
      });
    },
    [room, sendGroupMessage]
  );

  const sendGroupRtcSignal = useCallback(
    (
      targetParticipantId: string,
      mediaSessionId: string,
      generation: number,
      signal: RtcSignalPayload
    ) => {
      if (!room) return false;
      return sendGroupMessage({
        type: "group_rtc_signal",
        requestId: crypto.randomUUID(),
        roomId: room.roomId,
        mediaSessionId,
        generation,
        targetParticipantId,
        signal
      });
    },
    [room, sendGroupMessage]
  );

  const consumeGroupRtcSignal = useCallback((requestId: string) => {
    setGroupRtcInbox((current) =>
      current.filter((message) => message.requestId !== requestId)
    );
  }, []);

  const consumeRtcSession = useCallback((requestId: string) => {
    setRtcSessionInbox((current) =>
      current.filter((message) => message.requestId !== requestId)
    );
  }, []);

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
    identityState,
    recoveryCode,
    clearRecoveryCode: () => setRecoveryCode(null),
    recoverIdentity,
    name,
    setName,
    requestedRole,
    setRequestedRole,
    room,
    connection,
    resumeDelta,
    lastEvent,
    lastAcceptance,
    lastAuthorityTransfer,
    lastVoiceAuthorityBootstrap,
    lastAgentVoiceGrant,
    lastAgentVoiceRevocation,
    lastAgentVoiceUtteranceStatus,
    attentionLease,
    lastAgentTurnStatus,
    agentStatuses,
    rtcInbox,
    rtcSessionInbox,
    groupRtcInbox,
    groupMediaState,
    rtcConfig,
    notice,
    connect,
    disconnect,
    submitWork,
    acceptOutcome,
    transferAcceptAuthority,
    bootstrapAgentVoiceAuthority,
    grantAgentVoice,
    revokeAgentVoice,
    grantAttentionLease,
    revokeAttentionLease,
    requestAgentTurn,
    requestAgentVoiceUtterance,
    openRtcCall,
    sendRtcSignal,
    joinGroupMedia,
    leaveGroupMedia,
    publishGroupSource,
    unpublishGroupSource,
    subscribeGroupSource,
    unsubscribeGroupSource,
    sendGroupRtcSignal,
    consumeGroupRtcSignal,
    requestSfu,
    consumeRtcSession,
    consumeRtcSignal
  };
}
