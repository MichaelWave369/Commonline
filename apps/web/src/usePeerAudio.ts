import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject
} from "react";
import type {
  RtcCallSessionMessage,
  RtcConfigMessage,
  RtcSignalPayload,
  RtcSignalRelayMessage
} from "@commonline/protocol";
import {
  extractRtcMetrics,
  type RtcMetrics,
  type RtcStatLike
} from "./rtcDiagnostics";
import {
  mediaSessionKey,
  sameMediaSession,
  shouldIgnoreOffer
} from "./perfectNegotiation";
import { mediaContextLabel } from "./transportSecurity";

type CallState =
  | "idle"
  | "calling"
  | "incoming"
  | "connecting"
  | "connected"
  | "error";

export interface CallDiagnostics {
  networkOnline: boolean;
  mediaContext: "secure" | "insecure";
  iceTransportPolicy: "all" | "relay";
  credentialMode: RtcConfigMessage["credentialMode"] | "unavailable";
  signalingState: RTCSignalingState | "none";
  iceGatheringState: RTCIceGatheringState | "none";
  iceConnectionState: RTCIceConnectionState | "none";
  connectionState: RTCPeerConnectionState | "none";
  metrics: RtcMetrics;
  lastIceError?: string;
  failureReason?: string;
  lastUpdatedAt?: string;
}

interface UsePeerAudioInput {
  roomConnected: boolean;
  rtcConfig: RtcConfigMessage | null;
  rtcSessionInbox: RtcCallSessionMessage[];
  rtcInbox: RtcSignalRelayMessage[];
  consumeRtcSession: (requestId: string) => void;
  consumeRtcSignal: (requestId: string) => void;
  openRtcCall: (targetParticipantId: string) => boolean;
  sendRtcSignal: (
    targetParticipantId: string,
    callId: string,
    generation: number,
    signal: RtcSignalPayload
  ) => boolean;
}

const SETUP_TIMEOUT_MS = 20_000;
const DISCONNECT_GRACE_MS = 10_000;
const INCOMING_RING_TIMEOUT_MS = 30_000;
const STATS_INTERVAL_MS = 2_000;

const emptyMetrics: RtcMetrics = {
  route: "unknown",
  localCandidateType: "unknown",
  remoteCandidateType: "unknown"
};

function toRtcConfiguration(config: RtcConfigMessage): RTCConfiguration {
  return {
    iceServers: config.iceServers.map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential
    })),
    iceTransportPolicy: config.iceTransportPolicy
  };
}

function configExpired(config: RtcConfigMessage) {
  return Boolean(
    config.expiresAt && Date.parse(config.expiresAt) <= Date.now()
  );
}

function signalMatchesSession(
  signal: RtcSignalRelayMessage,
  session: RtcCallSessionMessage
) {
  return (
    signal.callId === session.callId &&
    signal.generation === session.generation &&
    signal.fromParticipantId === session.peerParticipantId
  );
}

export function usePeerAudio({
  roomConnected,
  rtcConfig,
  rtcSessionInbox,
  rtcInbox,
  consumeRtcSession,
  consumeRtcSignal,
  openRtcCall,
  sendRtcSignal
}: UsePeerAudioInput) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activeSessionRef = useRef<RtcCallSessionMessage | null>(null);
  const incomingSessionRef = useRef<RtcCallSessionMessage | null>(null);
  const pendingOpenTargetRef = useRef<string | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const queuedSignalsRef = useRef<RtcSignalRelayMessage[]>([]);
  const processingSignalsRef = useRef(new Set<string>());
  const processingSessionsRef = useRef(new Set<string>());

  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const isSettingRemoteAnswerPendingRef = useRef(false);

  const setupTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const incomingTimerRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<CallState>("idle");
  const [peerId, setPeerId] = useState<string | null>(null);
  const [incomingOffer, setIncomingOffer] =
    useState<RtcCallSessionMessage | null>(null);
  const [callSession, setCallSession] =
    useState<RtcCallSessionMessage | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CallDiagnostics>(() => ({
    networkOnline: navigator.onLine,
    mediaContext: mediaContextLabel({
      pageUrl: window.location.href,
      secureContext: window.isSecureContext
    }),
    iceTransportPolicy: rtcConfig?.iceTransportPolicy ?? "all",
    credentialMode: rtcConfig?.credentialMode ?? "unavailable",
    signalingState: "none",
    iceGatheringState: "none",
    iceConnectionState: "none",
    connectionState: "none",
    metrics: emptyMetrics
  }));

  const clearTimer = useCallback(
    (ref: MutableRefObject<number | null>) => {
      if (ref.current !== null) {
        window.clearTimeout(ref.current);
        window.clearInterval(ref.current);
        ref.current = null;
      }
    },
    []
  );

  const clearCallTimers = useCallback(() => {
    clearTimer(setupTimerRef);
    clearTimer(disconnectTimerRef);
    clearTimer(incomingTimerRef);
    clearTimer(statsTimerRef);
  }, [clearTimer]);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const resetNegotiation = useCallback(() => {
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    isSettingRemoteAnswerPendingRef.current = false;
    pendingIceRef.current = [];
    queuedSignalsRef.current = [];
  }, []);

  const cleanupCall = useCallback(() => {
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) pc.close();

    clearCallTimers();
    stopLocalMedia();
    resetNegotiation();

    activeSessionRef.current = null;
    incomingSessionRef.current = null;
    pendingOpenTargetRef.current = null;
    setIncomingOffer(null);
    setCallSession(null);
    setPeerId(null);
    setRemoteStream(null);
    setMuted(false);
    setState("idle");
    setDiagnostics((current) => ({
      ...current,
      signalingState: "none",
      iceGatheringState: "none",
      iceConnectionState: "none",
      connectionState: "none",
      metrics: emptyMetrics
    }));
  }, [clearCallTimers, resetNegotiation, stopLocalMedia]);

  const sendForSession = useCallback(
    (
      session: RtcCallSessionMessage,
      signal: RtcSignalPayload
    ) =>
      sendRtcSignal(
        session.peerParticipantId,
        session.callId,
        session.generation,
        signal
      ),
    [sendRtcSignal]
  );

  const failCall = useCallback(
    (message: string) => {
      const session =
        activeSessionRef.current ?? incomingSessionRef.current;

      if (session) {
        sendForSession(session, {
          kind: "hangup",
          reason: "failed"
        });
      }

      cleanupCall();
      setError(message);
      setState("error");
      setDiagnostics((current) => ({
        ...current,
        failureReason: message,
        lastUpdatedAt: new Date().toISOString()
      }));
    },
    [cleanupCall, sendForSession]
  );

  const microphone = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    if (
      mediaContextLabel({
        pageUrl: window.location.href,
        secureContext: window.isSecureContext
      }) !== "secure"
    ) {
      throw new Error("Microphone access requires HTTPS or localhost.");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    stream.getAudioTracks().forEach((track) => {
      track.addEventListener("ended", () => {
        if (pcRef.current) {
          failCall("The local microphone track ended.");
        }
      });
    });

    localStreamRef.current = stream;
    return stream;
  }, [failCall]);

  const refreshStats = useCallback(async (pc: RTCPeerConnection) => {
    if (pcRef.current !== pc) return;

    try {
      const report = await pc.getStats();
      const entries: RtcStatLike[] = [];
      report.forEach((value) => {
        entries.push(value as unknown as RtcStatLike);
      });

      const metrics = extractRtcMetrics(entries);
      setDiagnostics((current) => ({
        ...current,
        metrics,
        lastUpdatedAt: new Date().toISOString()
      }));
    } catch {
      // Diagnostics must never be able to break the call.
    }
  }, []);

  const startStats = useCallback(
    (pc: RTCPeerConnection) => {
      clearTimer(statsTimerRef);
      void refreshStats(pc);
      statsTimerRef.current = window.setInterval(() => {
        void refreshStats(pc);
      }, STATS_INTERVAL_MS);
    },
    [clearTimer, refreshStats]
  );

  const armSetupTimeout = useCallback(() => {
    clearTimer(setupTimerRef);
    setupTimerRef.current = window.setTimeout(() => {
      failCall(
        "Call setup timed out before WebRTC reached a connected state."
      );
    }, SETUP_TIMEOUT_MS);
  }, [clearTimer, failCall]);

  const armDisconnectGrace = useCallback(() => {
    if (disconnectTimerRef.current !== null) return;
    disconnectTimerRef.current = window.setTimeout(() => {
      failCall(
        "The peer connection stayed disconnected beyond the recovery grace period."
      );
    }, DISCONNECT_GRACE_MS);
  }, [failCall]);

  const clearDisconnectGrace = useCallback(() => {
    clearTimer(disconnectTimerRef);
  }, [clearTimer]);

  const updatePeerStates = useCallback((pc: RTCPeerConnection) => {
    if (pcRef.current !== pc) return;
    setDiagnostics((current) => ({
      ...current,
      signalingState: pc.signalingState,
      iceGatheringState: pc.iceGatheringState,
      iceConnectionState: pc.iceConnectionState,
      connectionState: pc.connectionState,
      lastUpdatedAt: new Date().toISOString()
    }));
  }, []);

  const sendLocalDescription = useCallback(
    (session: RtcCallSessionMessage, pc: RTCPeerConnection) => {
      const description = pc.localDescription;
      if (
        !description ||
        (description.type !== "offer" &&
          description.type !== "answer") ||
        !description.sdp
      ) {
        return false;
      }

      return sendForSession(session, {
        kind: description.type,
        sdp: description.sdp
      });
    },
    [sendForSession]
  );

  const flushIce = useCallback(
    async (pc: RTCPeerConnection) => {
      if (!pc.remoteDescription || ignoreOfferRef.current) return;

      const pending = pendingIceRef.current;
      pendingIceRef.current = [];

      for (const candidate of pending) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (cause) {
          if (!ignoreOfferRef.current) throw cause;
        }
      }
    },
    []
  );

  const buildPeer = useCallback(
    (session: RtcCallSessionMessage) => {
      if (!rtcConfig) {
        throw new Error(
          "ICE configuration has not arrived from the authenticated room service yet."
        );
      }

      if (configExpired(rtcConfig)) {
        throw new Error(
          "TURN credentials expired. Reconnect the room to obtain fresh ICE credentials."
        );
      }

      pcRef.current?.close();
      resetNegotiation();

      const pc = new RTCPeerConnection(toRtcConfiguration(rtcConfig));
      pcRef.current = pc;
      activeSessionRef.current = session;
      incomingSessionRef.current = null;
      setCallSession(session);
      setIncomingOffer(null);
      setPeerId(session.peerParticipantId);

      setDiagnostics((current) => ({
        ...current,
        networkOnline: navigator.onLine,
        mediaContext: mediaContextLabel({
          pageUrl: window.location.href,
          secureContext: window.isSecureContext
        }),
        iceTransportPolicy: rtcConfig.iceTransportPolicy,
        credentialMode: rtcConfig.credentialMode,
        signalingState: pc.signalingState,
        iceGatheringState: pc.iceGatheringState,
        iceConnectionState: pc.iceConnectionState,
        connectionState: pc.connectionState,
        metrics: emptyMetrics,
        lastIceError: undefined,
        failureReason: undefined,
        lastUpdatedAt: new Date().toISOString()
      }));

      pc.addEventListener("icecandidate", (event) => {
        if (!event.candidate) return;
        sendForSession(session, {
          kind: "ice",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment
        });
      });

      pc.addEventListener("icecandidateerror", (event) => {
        const iceError = event as RTCPeerConnectionIceErrorEvent;
        setDiagnostics((current) => ({
          ...current,
          lastIceError: `${iceError.errorCode}: ${iceError.errorText}`,
          lastUpdatedAt: new Date().toISOString()
        }));
      });

      pc.addEventListener("track", (event) => {
        const stream =
          event.streams[0] ?? new MediaStream([event.track]);
        setRemoteStream(stream);
      });

      pc.addEventListener("signalingstatechange", () => {
        updatePeerStates(pc);
      });

      pc.addEventListener("icegatheringstatechange", () => {
        updatePeerStates(pc);
      });

      pc.addEventListener("iceconnectionstatechange", () => {
        updatePeerStates(pc);

        if (
          pc.iceConnectionState === "connected" ||
          pc.iceConnectionState === "completed"
        ) {
          clearDisconnectGrace();
        } else if (pc.iceConnectionState === "disconnected") {
          armDisconnectGrace();
        } else if (pc.iceConnectionState === "failed") {
          failCall("ICE connectivity failed.");
        }
      });

      pc.addEventListener("connectionstatechange", () => {
        updatePeerStates(pc);

        if (pc.connectionState === "connected") {
          clearTimer(setupTimerRef);
          clearDisconnectGrace();
          setState("connected");
          setError(null);
          startStats(pc);
        } else if (pc.connectionState === "disconnected") {
          armDisconnectGrace();
        } else if (pc.connectionState === "failed") {
          failCall("WebRTC peer connection failed.");
        }
      });

      pc.addEventListener("negotiationneeded", async () => {
        if (
          pcRef.current !== pc ||
          !sameMediaSession(activeSessionRef.current, session)
        ) {
          return;
        }

        try {
          makingOfferRef.current = true;
          await pc.setLocalDescription();

          if (!sendLocalDescription(session, pc)) {
            throw new Error("Could not send the negotiated local description.");
          }

          updatePeerStates(pc);
        } catch (cause) {
          failCall(
            cause instanceof Error
              ? cause.message
              : "WebRTC negotiation failed."
          );
        } finally {
          makingOfferRef.current = false;
        }
      });

      return pc;
    },
    [
      armDisconnectGrace,
      clearDisconnectGrace,
      clearTimer,
      failCall,
      resetNegotiation,
      rtcConfig,
      sendForSession,
      sendLocalDescription,
      startStats,
      updatePeerStates
    ]
  );

  const applySignalToActive = useCallback(
    async (message: RtcSignalRelayMessage) => {
      const session = activeSessionRef.current;
      const pc = pcRef.current;
      if (
        !session ||
        !pc ||
        !signalMatchesSession(message, session)
      ) {
        return;
      }

      const signal = message.signal;

      if (signal.kind === "offer" || signal.kind === "answer") {
        const description: RTCSessionDescriptionInit = {
          type: signal.kind,
          sdp: signal.sdp
        };

        ignoreOfferRef.current = shouldIgnoreOffer({
          polite: session.polite,
          descriptionType: description.type!,
          makingOffer: makingOfferRef.current,
          signalingState: pc.signalingState,
          isSettingRemoteAnswerPending:
            isSettingRemoteAnswerPendingRef.current
        });

        if (ignoreOfferRef.current) {
          return;
        }

        isSettingRemoteAnswerPendingRef.current =
          description.type === "answer";

        try {
          await pc.setRemoteDescription(description);
        } finally {
          isSettingRemoteAnswerPendingRef.current = false;
        }

        updatePeerStates(pc);

        if (description.type === "offer") {
          await pc.setLocalDescription();
          if (!sendLocalDescription(session, pc)) {
            throw new Error("Could not send the perfect-negotiation answer.");
          }
          updatePeerStates(pc);
        }

        await flushIce(pc);
        return;
      }

      if (signal.kind === "ice") {
        if (ignoreOfferRef.current) return;

        const candidate: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
          usernameFragment: signal.usernameFragment
        };

        if (pc.remoteDescription) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (cause) {
            if (!ignoreOfferRef.current) throw cause;
          }
        } else {
          pendingIceRef.current.push(candidate);
        }
      }
    },
    [flushIce, sendLocalDescription, updatePeerStates]
  );

  const drainQueuedSignals = useCallback(async () => {
    const session = activeSessionRef.current;
    if (!session) return;

    const queued = queuedSignalsRef.current;
    queuedSignalsRef.current = [];

    for (const message of queued) {
      if (signalMatchesSession(message, session)) {
        await applySignalToActive(message);
      }
    }
  }, [applySignalToActive]);

  const activateSession = useCallback(
    async (session: RtcCallSessionMessage) => {
      if (!rtcConfig || configExpired(rtcConfig)) {
        sendForSession(session, {
          kind: "hangup",
          reason: "failed"
        });
        cleanupCall();
        setError(
          "No usable authenticated ICE configuration is available for this call."
        );
        setState("error");
        return;
      }

      setError(null);
      setState("connecting");
      clearTimer(incomingTimerRef);

      try {
        const stream = await microphone();
        const pc = buildPeer(session);

        stream.getTracks().forEach((track) => {
          pc.addTrack(track, stream);
        });

        await drainQueuedSignals();
        armSetupTimeout();
      } catch (cause) {
        sendForSession(session, {
          kind: "hangup",
          reason: "failed"
        });
        cleanupCall();
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not activate the media session."
        );
        setState("error");
      }
    },
    [
      armSetupTimeout,
      buildPeer,
      cleanupCall,
      clearTimer,
      drainQueuedSignals,
      microphone,
      rtcConfig,
      sendForSession
    ]
  );

  const handleCallSession = useCallback(
    async (session: RtcCallSessionMessage) => {
      if (
        sameMediaSession(activeSessionRef.current, session) ||
        sameMediaSession(incomingSessionRef.current, session)
      ) {
        return;
      }

      if (
        activeSessionRef.current ||
        incomingSessionRef.current
      ) {
        sendForSession(session, {
          kind: "hangup",
          reason: "superseded"
        });
        return;
      }

      setPeerId(session.peerParticipantId);
      setCallSession(session);

      const outgoingConsent =
        pendingOpenTargetRef.current === session.peerParticipantId;

      if (outgoingConsent) {
        pendingOpenTargetRef.current = null;
        activeSessionRef.current = session;
        await activateSession(session);
        return;
      }

      incomingSessionRef.current = session;
      setIncomingOffer(session);
      setState("incoming");

      clearTimer(incomingTimerRef);
      incomingTimerRef.current = window.setTimeout(() => {
        if (
          sameMediaSession(incomingSessionRef.current, session)
        ) {
          sendForSession(session, {
            kind: "hangup",
            reason: "declined"
          });
          cleanupCall();
        }
      }, INCOMING_RING_TIMEOUT_MS);
    },
    [activateSession, cleanupCall, clearTimer, sendForSession]
  );

  const startCall = useCallback(
    (targetParticipantId: string) => {
      if (
        (state !== "idle" && state !== "error") ||
        !roomConnected
      ) {
        return;
      }

      if (!rtcConfig || configExpired(rtcConfig)) {
        setError("Waiting for usable authenticated ICE configuration.");
        setState("error");
        return;
      }

      cleanupCall();
      setError(null);
      setState("calling");
      setPeerId(targetParticipantId);
      pendingOpenTargetRef.current = targetParticipantId;

      if (!openRtcCall(targetParticipantId)) {
        pendingOpenTargetRef.current = null;
        setError("Could not request an ephemeral media session.");
        setState("error");
      }
    },
    [cleanupCall, openRtcCall, roomConnected, rtcConfig, state]
  );

  const answerCall = useCallback(async () => {
    const session = incomingSessionRef.current;
    if (!session || !roomConnected) return;

    incomingSessionRef.current = null;
    activeSessionRef.current = session;
    setIncomingOffer(null);
    await activateSession(session);
  }, [activateSession, roomConnected]);

  const declineCall = useCallback(() => {
    const session = incomingSessionRef.current;
    if (!session) return;

    sendForSession(session, {
      kind: "hangup",
      reason: "declined"
    });
    cleanupCall();
  }, [cleanupCall, sendForSession]);

  const hangup = useCallback(() => {
    const session =
      activeSessionRef.current ?? incomingSessionRef.current;

    if (session) {
      sendForSession(session, {
        kind: "hangup",
        reason: "ended"
      });
    }

    cleanupCall();
    setError(null);
  }, [cleanupCall, sendForSession]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }, [muted]);

  const handleSignal = useCallback(
    async (message: RtcSignalRelayMessage) => {
      const active = activeSessionRef.current;
      const incoming = incomingSessionRef.current;
      const matchingSession =
        active && signalMatchesSession(message, active)
          ? active
          : incoming && signalMatchesSession(message, incoming)
            ? incoming
            : null;

      if (!matchingSession) {
        // A late packet from an ended/superseded generation is intentionally
        // ignored client-side even though the server also rejects stale sends.
        return;
      }

      if (message.signal.kind === "hangup") {
        cleanupCall();

        if (
          message.signal.reason === "failed" ||
          message.signal.reason === "peer-left"
        ) {
          setError(
            message.signal.reason === "peer-left"
              ? "The peer left the room; this exact media session ended."
              : "The remote peer reported a call failure."
          );
          setState("error");
        }
        return;
      }

      if (!active || !pcRef.current) {
        queuedSignalsRef.current.push(message);
        return;
      }

      await applySignalToActive(message);
    },
    [applySignalToActive, cleanupCall]
  );

  useEffect(() => {
    let cancelled = false;

    async function processSessions() {
      for (const session of rtcSessionInbox) {
        if (
          cancelled ||
          processingSessionsRef.current.has(session.requestId)
        ) {
          continue;
        }

        processingSessionsRef.current.add(session.requestId);
        try {
          await handleCallSession(session);
        } catch (cause) {
          failCall(
            cause instanceof Error
              ? cause.message
              : "Media-session setup failed."
          );
        } finally {
          consumeRtcSession(session.requestId);
          processingSessionsRef.current.delete(session.requestId);
        }
      }
    }

    void processSessions();
    return () => {
      cancelled = true;
    };
  }, [
    consumeRtcSession,
    failCall,
    handleCallSession,
    rtcSessionInbox
  ]);

  useEffect(() => {
    let cancelled = false;

    async function processSignals() {
      for (const message of rtcInbox) {
        if (
          cancelled ||
          processingSignalsRef.current.has(message.requestId)
        ) {
          continue;
        }

        processingSignalsRef.current.add(message.requestId);
        try {
          await handleSignal(message);
        } catch (cause) {
          failCall(
            cause instanceof Error
              ? cause.message
              : "RTC signaling failed."
          );
        } finally {
          consumeRtcSignal(message.requestId);
          processingSignalsRef.current.delete(message.requestId);
        }
      }
    }

    void processSignals();
    return () => {
      cancelled = true;
    };
  }, [
    consumeRtcSignal,
    failCall,
    handleSignal,
    rtcInbox
  ]);

  useEffect(() => {
    if (roomConnected) return;
    cleanupCall();
  }, [cleanupCall, roomConnected]);

  useEffect(() => {
    setDiagnostics((current) => ({
      ...current,
      iceTransportPolicy:
        rtcConfig?.iceTransportPolicy ?? "all",
      credentialMode:
        rtcConfig?.credentialMode ?? "unavailable"
    }));
  }, [rtcConfig]);

  useEffect(() => {
    const updateNetwork = () => {
      setDiagnostics((current) => ({
        ...current,
        networkOnline: navigator.onLine,
        lastUpdatedAt: new Date().toISOString()
      }));
    };

    window.addEventListener("online", updateNetwork);
    window.addEventListener("offline", updateNetwork);

    return () => {
      window.removeEventListener("online", updateNetwork);
      window.removeEventListener("offline", updateNetwork);
    };
  }, []);

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      clearCallTimers();
      stopLocalMedia();
    };
  }, [clearCallTimers, stopLocalMedia]);

  return {
    state,
    peerId,
    incomingOffer,
    callSession,
    remoteStream,
    muted,
    error,
    diagnostics,
    rtcReady: Boolean(rtcConfig && !configExpired(rtcConfig)),
    startCall,
    answerCall,
    declineCall,
    hangup,
    toggleMute
  };
}
