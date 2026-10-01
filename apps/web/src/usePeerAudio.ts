import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RtcConfigMessage,
  RtcSignalPayload,
  RtcSignalRelayMessage
} from "@commonline/protocol";
import {
  extractRtcMetrics,
  type RtcMetrics,
  type RtcStatLike
} from "./rtcDiagnostics";
import { mediaContextLabel } from "./transportSecurity";

type CallState =
  | "idle"
  | "calling"
  | "incoming"
  | "connecting"
  | "connected"
  | "error";

interface IncomingOffer {
  fromParticipantId: string;
  sdp: string;
}

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
  rtcInbox: RtcSignalRelayMessage[];
  consumeRtcSignal: (requestId: string) => void;
  sendRtcSignal: (
    targetParticipantId: string,
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

export function usePeerAudio({
  roomConnected,
  rtcConfig,
  rtcInbox,
  consumeRtcSignal,
  sendRtcSignal
}: UsePeerAudioInput) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const activePeerRef = useRef<string | null>(null);
  const incomingPeerRef = useRef<string | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const processingRef = useRef(new Set<string>());

  const setupTimerRef = useRef<number | null>(null);
  const disconnectTimerRef = useRef<number | null>(null);
  const incomingTimerRef = useRef<number | null>(null);
  const statsTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<CallState>("idle");
  const [peerId, setPeerId] = useState<string | null>(null);
  const [incomingOffer, setIncomingOffer] =
    useState<IncomingOffer | null>(null);
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

  const clearTimer = useCallback((ref: React.MutableRefObject<number | null>) => {
    if (ref.current !== null) {
      window.clearTimeout(ref.current);
      window.clearInterval(ref.current);
      ref.current = null;
    }
  }, []);

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

  const cleanupCall = useCallback(() => {
    const pc = pcRef.current;
    pcRef.current = null;
    if (pc) pc.close();

    clearCallTimers();
    stopLocalMedia();
    activePeerRef.current = null;
    incomingPeerRef.current = null;
    pendingIceRef.current = [];
    setIncomingOffer(null);
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
  }, [clearCallTimers, stopLocalMedia]);

  const failCall = useCallback(
    (message: string) => {
      const target =
        activePeerRef.current ?? incomingPeerRef.current ?? undefined;
      if (target) {
        sendRtcSignal(target, { kind: "hangup", reason: "failed" });
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
    [cleanupCall, sendRtcSignal]
  );

  const microphone = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;

    if (
      mediaContextLabel({
        pageUrl: window.location.href,
        secureContext: window.isSecureContext
      }) !== "secure"
    ) {
      throw new Error(
        "Microphone access requires HTTPS or localhost."
      );
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

  const buildPeer = useCallback(
    (targetParticipantId: string) => {
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
      const pc = new RTCPeerConnection(toRtcConfiguration(rtcConfig));
      pcRef.current = pc;
      activePeerRef.current = targetParticipantId;
      incomingPeerRef.current = null;
      setPeerId(targetParticipantId);

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
        sendRtcSignal(targetParticipantId, {
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

      return pc;
    },
    [
      armDisconnectGrace,
      clearDisconnectGrace,
      clearTimer,
      failCall,
      rtcConfig,
      sendRtcSignal,
      startStats,
      updatePeerStates
    ]
  );

  const flushIce = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc?.remoteDescription) return;
    const pending = pendingIceRef.current;
    pendingIceRef.current = [];

    for (const candidate of pending) {
      await pc.addIceCandidate(candidate);
    }
  }, []);

  const startCall = useCallback(
    async (targetParticipantId: string) => {
      if (state !== "idle" || !roomConnected) return;

      if (!rtcConfig) {
        setError("Waiting for authenticated ICE configuration.");
        return;
      }

      setError(null);
      setState("calling");
      setPeerId(targetParticipantId);
      pendingIceRef.current = [];

      try {
        const stream = await microphone();
        const pc = buildPeer(targetParticipantId);
        stream.getTracks().forEach((track) =>
          pc.addTrack(track, stream)
        );

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        updatePeerStates(pc);

        if (
          !offer.sdp ||
          !sendRtcSignal(targetParticipantId, {
            kind: "offer",
            sdp: offer.sdp
          })
        ) {
          throw new Error("Could not send the call offer.");
        }

        setState("connecting");
        armSetupTimeout();
      } catch (cause) {
        cleanupCall();
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not start audio."
        );
        setState("error");
      }
    },
    [
      armSetupTimeout,
      buildPeer,
      cleanupCall,
      microphone,
      roomConnected,
      rtcConfig,
      sendRtcSignal,
      state,
      updatePeerStates
    ]
  );

  const answerCall = useCallback(async () => {
    if (!incomingOffer || !roomConnected) return;

    if (!rtcConfig) {
      sendRtcSignal(incomingOffer.fromParticipantId, {
        kind: "hangup",
        reason: "failed"
      });
      cleanupCall();
      setError("No authenticated ICE configuration is available.");
      setState("error");
      return;
    }

    setError(null);
    setState("connecting");
    clearTimer(incomingTimerRef);

    try {
      const stream = await microphone();
      const pc = buildPeer(incomingOffer.fromParticipantId);
      stream.getTracks().forEach((track) =>
        pc.addTrack(track, stream)
      );

      await pc.setRemoteDescription({
        type: "offer",
        sdp: incomingOffer.sdp
      });
      updatePeerStates(pc);
      await flushIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      updatePeerStates(pc);

      if (
        !answer.sdp ||
        !sendRtcSignal(incomingOffer.fromParticipantId, {
          kind: "answer",
          sdp: answer.sdp
        })
      ) {
        throw new Error("Could not send the call answer.");
      }

      setIncomingOffer(null);
      armSetupTimeout();
    } catch (cause) {
      const target = incomingOffer.fromParticipantId;
      cleanupCall();
      sendRtcSignal(target, { kind: "hangup", reason: "failed" });
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not answer audio."
      );
      setState("error");
    }
  }, [
    armSetupTimeout,
    buildPeer,
    cleanupCall,
    clearTimer,
    flushIce,
    incomingOffer,
    microphone,
    roomConnected,
    rtcConfig,
    sendRtcSignal,
    updatePeerStates
  ]);

  const declineCall = useCallback(() => {
    if (!incomingOffer) return;
    sendRtcSignal(incomingOffer.fromParticipantId, {
      kind: "hangup",
      reason: "declined"
    });
    cleanupCall();
  }, [cleanupCall, incomingOffer, sendRtcSignal]);

  const hangup = useCallback(() => {
    const target =
      activePeerRef.current ?? incomingPeerRef.current;
    if (target) {
      sendRtcSignal(target, { kind: "hangup", reason: "ended" });
    }
    cleanupCall();
    setError(null);
  }, [cleanupCall, sendRtcSignal]);

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
      const { fromParticipantId, signal } = message;

      if (signal.kind === "hangup") {
        if (
          fromParticipantId === activePeerRef.current ||
          fromParticipantId === incomingPeerRef.current
        ) {
          cleanupCall();
          setError(
            signal.reason === "failed"
              ? "The remote peer reported a call failure."
              : null
          );
        }
        return;
      }

      if (signal.kind === "offer") {
        if (pcRef.current || incomingPeerRef.current) {
          sendRtcSignal(fromParticipantId, {
            kind: "hangup",
            reason: "declined"
          });
          return;
        }

        if (!rtcConfig || configExpired(rtcConfig)) {
          sendRtcSignal(fromParticipantId, {
            kind: "hangup",
            reason: "failed"
          });
          setError(
            "Incoming call rejected because usable ICE configuration is unavailable."
          );
          return;
        }

        pendingIceRef.current = [];
        incomingPeerRef.current = fromParticipantId;
        setPeerId(fromParticipantId);
        setIncomingOffer({
          fromParticipantId,
          sdp: signal.sdp
        });
        setState("incoming");

        clearTimer(incomingTimerRef);
        incomingTimerRef.current = window.setTimeout(() => {
          if (incomingPeerRef.current === fromParticipantId) {
            sendRtcSignal(fromParticipantId, {
              kind: "hangup",
              reason: "declined"
            });
            cleanupCall();
          }
        }, INCOMING_RING_TIMEOUT_MS);
        return;
      }

      if (signal.kind === "answer") {
        const pc = pcRef.current;
        if (!pc || activePeerRef.current !== fromParticipantId) return;

        await pc.setRemoteDescription({
          type: "answer",
          sdp: signal.sdp
        });
        updatePeerStates(pc);
        await flushIce();
        return;
      }

      if (
        signal.kind === "ice" &&
        (activePeerRef.current === fromParticipantId ||
          incomingPeerRef.current === fromParticipantId)
      ) {
        const candidate: RTCIceCandidateInit = {
          candidate: signal.candidate,
          sdpMid: signal.sdpMid,
          sdpMLineIndex: signal.sdpMLineIndex,
          usernameFragment: signal.usernameFragment
        };

        if (pcRef.current?.remoteDescription) {
          await pcRef.current.addIceCandidate(candidate);
        } else {
          pendingIceRef.current.push(candidate);
        }
      }
    },
    [
      cleanupCall,
      clearTimer,
      flushIce,
      rtcConfig,
      sendRtcSignal,
      updatePeerStates
    ]
  );

  useEffect(() => {
    let cancelled = false;

    async function process() {
      for (const message of rtcInbox) {
        if (
          cancelled ||
          processingRef.current.has(message.requestId)
        ) {
          continue;
        }

        processingRef.current.add(message.requestId);
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
          processingRef.current.delete(message.requestId);
        }
      }
    }

    void process();
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
