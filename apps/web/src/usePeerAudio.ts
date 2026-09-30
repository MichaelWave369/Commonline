import { useCallback, useEffect, useRef, useState } from "react";
import type {
  RtcSignalPayload,
  RtcSignalRelayMessage
} from "@commonline/protocol";

type CallState = "idle" | "calling" | "incoming" | "connecting" | "connected" | "error";

interface IncomingOffer {
  fromParticipantId: string;
  sdp: string;
}

interface UsePeerAudioInput {
  roomConnected: boolean;
  rtcInbox: RtcSignalRelayMessage[];
  consumeRtcSignal: (requestId: string) => void;
  sendRtcSignal: (targetClientId: string, signal: RtcSignalPayload) => boolean;
}

function rtcConfiguration(): RTCConfiguration {
  const stunUrl = (import.meta.env.VITE_COMMONLINE_STUN_URL as string | undefined)?.trim();
  return {
    iceServers: stunUrl ? [{ urls: stunUrl }] : []
  };
}

export function usePeerAudio({
  roomConnected,
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

  const [state, setState] = useState<CallState>("idle");
  const [peerId, setPeerId] = useState<string | null>(null);
  const [incomingOffer, setIncomingOffer] = useState<IncomingOffer | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
  }, []);

  const resetCall = useCallback(() => {
    pcRef.current?.close();
    pcRef.current = null;
    stopLocalMedia();
    activePeerRef.current = null;
    incomingPeerRef.current = null;
    pendingIceRef.current = [];
    setIncomingOffer(null);
    setPeerId(null);
    setRemoteStream(null);
    setMuted(false);
    setState("idle");
  }, [stopLocalMedia]);

  const microphone = useCallback(async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
    localStreamRef.current = stream;
    return stream;
  }, []);

  const buildPeer = useCallback(
    (targetClientId: string) => {
      pcRef.current?.close();
      const pc = new RTCPeerConnection(rtcConfiguration());
      pcRef.current = pc;
      activePeerRef.current = targetClientId;
      incomingPeerRef.current = null;
      setPeerId(targetClientId);

      pc.addEventListener("icecandidate", (event) => {
        if (!event.candidate) return;
        sendRtcSignal(targetClientId, {
          kind: "ice",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment
        });
      });

      pc.addEventListener("track", (event) => {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        setRemoteStream(stream);
      });

      pc.addEventListener("connectionstatechange", () => {
        if (pc.connectionState === "connected") {
          setState("connected");
          setError(null);
        } else if (pc.connectionState === "failed") {
          setError("WebRTC connection failed. End the call and retry.");
          setState("error");
        }
      });

      return pc;
    },
    [sendRtcSignal]
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
    async (targetClientId: string) => {
      if (state !== "idle" || !roomConnected) return;
      setError(null);
      setState("calling");
      setPeerId(targetClientId);

      try {
        const stream = await microphone();
        const pc = buildPeer(targetClientId);
        stream.getTracks().forEach((track) => pc.addTrack(track, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (!offer.sdp || !sendRtcSignal(targetClientId, { kind: "offer", sdp: offer.sdp })) {
          throw new Error("Could not send the call offer.");
        }
        setState("connecting");
      } catch (cause) {
        resetCall();
        setError(cause instanceof Error ? cause.message : "Could not start audio.");
      }
    },
    [buildPeer, microphone, resetCall, roomConnected, sendRtcSignal, state]
  );

  const answerCall = useCallback(async () => {
    if (!incomingOffer || !roomConnected) return;
    setError(null);
    setState("connecting");

    try {
      const stream = await microphone();
      const pc = buildPeer(incomingOffer.fromParticipantId);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await pc.setRemoteDescription({
        type: "offer",
        sdp: incomingOffer.sdp
      });
      await flushIce();

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (!answer.sdp || !sendRtcSignal(incomingOffer.fromParticipantId, { kind: "answer", sdp: answer.sdp })) {
        throw new Error("Could not send the call answer.");
      }
      setIncomingOffer(null);
    } catch (cause) {
      const target = incomingOffer.fromParticipantId;
      resetCall();
      sendRtcSignal(target, { kind: "hangup", reason: "failed" });
      setError(cause instanceof Error ? cause.message : "Could not answer audio.");
    }
  }, [buildPeer, flushIce, incomingOffer, microphone, resetCall, roomConnected, sendRtcSignal]);

  const declineCall = useCallback(() => {
    if (!incomingOffer) return;
    sendRtcSignal(incomingOffer.fromParticipantId, { kind: "hangup", reason: "declined" });
    resetCall();
  }, [incomingOffer, resetCall, sendRtcSignal]);

  const hangup = useCallback(() => {
    const target = activePeerRef.current ?? incomingPeerRef.current;
    if (target) sendRtcSignal(target, { kind: "hangup", reason: "ended" });
    resetCall();
  }, [resetCall, sendRtcSignal]);

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
          resetCall();
        }
        return;
      }

      if (signal.kind === "offer") {
        if (pcRef.current || incomingPeerRef.current) {
          sendRtcSignal(fromParticipantId, { kind: "hangup", reason: "declined" });
          return;
        }

        pendingIceRef.current = [];
        incomingPeerRef.current = fromParticipantId;
        setPeerId(fromParticipantId);
        setIncomingOffer({ fromParticipantId, sdp: signal.sdp });
        setState("incoming");
        return;
      }

      if (signal.kind === "answer") {
        const pc = pcRef.current;
        if (!pc || activePeerRef.current !== fromParticipantId) return;
        await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
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
    [flushIce, resetCall, sendRtcSignal]
  );

  useEffect(() => {
    let cancelled = false;

    async function process() {
      for (const message of rtcInbox) {
        if (cancelled || processingRef.current.has(message.requestId)) continue;
        processingRef.current.add(message.requestId);
        try {
          await handleSignal(message);
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : "RTC signaling failed.");
          setState("error");
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
  }, [consumeRtcSignal, handleSignal, rtcInbox]);

  useEffect(() => {
    if (roomConnected) return;
    resetCall();
  }, [roomConnected, resetCall]);

  useEffect(() => {
    return () => {
      pcRef.current?.close();
      stopLocalMedia();
    };
  }, [stopLocalMedia]);

  return {
    state,
    peerId,
    incomingOffer,
    remoteStream,
    muted,
    error,
    startCall,
    answerCall,
    declineCall,
    hangup,
    toggleMute
  };
}
