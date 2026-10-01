import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  GroupMediaStateMessage,
  GroupRtcSignalRelayMessage,
  RtcConfigMessage,
  RtcSignalPayload
} from "@commonline/protocol";
import { buildGroupPeerPlans } from "./groupMediaPlan";
import { shouldIgnoreOffer } from "./perfectNegotiation";
import { mediaContextLabel } from "./transportSecurity";

interface PeerLink {
  peerParticipantId: string;
  pc: RTCPeerConnection;
  sender?: RTCRtpSender;
  pendingIce: RTCIceCandidateInit[];
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
}

interface UseGroupAudioInput {
  participantId: string;
  roomConnected: boolean;
  rtcConfig: RtcConfigMessage | null;
  groupState: GroupMediaStateMessage | null;
  signalInbox: GroupRtcSignalRelayMessage[];
  consumeSignal: (requestId: string) => void;
  joinGroup: () => boolean;
  leaveGroup: () => boolean;
  publishMicrophone: () => boolean;
  unpublishSource: (sourceId: string) => boolean;
  subscribeSource: (sourceId: string) => boolean;
  unsubscribeSource: (sourceId: string) => boolean;
  sendSignal: (
    targetParticipantId: string,
    mediaSessionId: string,
    generation: number,
    signal: RtcSignalPayload
  ) => boolean;
}

function rtcConfiguration(config: RtcConfigMessage): RTCConfiguration {
  return {
    iceServers: config.iceServers.map((server) => ({
      urls: server.urls,
      username: server.username,
      credential: server.credential
    })),
    iceTransportPolicy: config.iceTransportPolicy
  };
}

function configExpired(config: RtcConfigMessage | null) {
  return Boolean(
    config?.expiresAt && Date.parse(config.expiresAt) <= Date.now()
  );
}

export function useGroupAudio({
  participantId,
  roomConnected,
  rtcConfig,
  groupState,
  signalInbox,
  consumeSignal,
  joinGroup,
  leaveGroup,
  publishMicrophone,
  unpublishSource,
  subscribeSource,
  unsubscribeSource,
  sendSignal
}: UseGroupAudioInput) {
  const stateRef = useRef<GroupMediaStateMessage | null>(groupState);
  const localStreamRef = useRef<MediaStream | null>(null);
  const linksRef = useRef(new Map<string, PeerLink>());
  const queuedSignalsRef = useRef(
    new Map<string, GroupRtcSignalRelayMessage[]>()
  );
  const processingRef = useRef(new Set<string>());

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [peerStates, setPeerStates] = useState<
    Record<string, RTCPeerConnectionState>
  >({});
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  stateRef.current = groupState;

  const joined = Boolean(
    groupState?.participants.some(
      (participant) => participant.participantId === participantId
    )
  );

  const ownSource = useMemo(
    () =>
      groupState?.sources.find(
        (source) => source.ownerParticipantId === participantId
      ),
    [groupState, participantId]
  );

  const plans = useMemo(
    () =>
      groupState
        ? buildGroupPeerPlans(groupState, participantId)
        : [],
    [groupState, participantId]
  );

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setMuted(false);
  }, []);

  const closePeer = useCallback((peerParticipantId: string) => {
    const link = linksRef.current.get(peerParticipantId);
    if (!link) return;

    link.pc.close();
    linksRef.current.delete(peerParticipantId);
    queuedSignalsRef.current.delete(peerParticipantId);

    setRemoteStreams((current) => {
      const next = { ...current };
      delete next[peerParticipantId];
      return next;
    });

    setPeerStates((current) => {
      const next = { ...current };
      delete next[peerParticipantId];
      return next;
    });
  }, []);

  const cleanupAllPeers = useCallback(() => {
    for (const peerId of [...linksRef.current.keys()]) {
      closePeer(peerId);
    }
  }, [closePeer]);

  const signalForCurrentSession = useCallback(
    (peerParticipantId: string, signal: RtcSignalPayload) => {
      const state = stateRef.current;
      if (!state) return false;

      return sendSignal(
        peerParticipantId,
        state.mediaSessionId,
        state.generation,
        signal
      );
    },
    [sendSignal]
  );

  const currentPlan = useCallback(
    (peerParticipantId: string) => {
      const state = stateRef.current;
      if (!state) return undefined;
      return buildGroupPeerPlans(state, participantId).find(
        (plan) => plan.peerParticipantId === peerParticipantId
      );
    },
    [participantId]
  );

  const ensurePeer = useCallback(
    (peerParticipantId: string) => {
      const existing = linksRef.current.get(peerParticipantId);
      if (existing) return existing;

      if (!rtcConfig || configExpired(rtcConfig)) {
        throw new Error(
          "Usable ICE configuration is required before group media can negotiate."
        );
      }

      const pc = new RTCPeerConnection(rtcConfiguration(rtcConfig));
      const link: PeerLink = {
        peerParticipantId,
        pc,
        pendingIce: [],
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false
      };
      linksRef.current.set(peerParticipantId, link);

      pc.addEventListener("icecandidate", (event) => {
        if (!event.candidate) return;
        signalForCurrentSession(peerParticipantId, {
          kind: "ice",
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment
        });
      });

      pc.addEventListener("track", (event) => {
        const plan = currentPlan(peerParticipantId);
        if (!plan?.receiveRemote) {
          return;
        }

        const stream =
          event.streams[0] ?? new MediaStream([event.track]);
        setRemoteStreams((current) => ({
          ...current,
          [peerParticipantId]: stream
        }));
      });

      pc.addEventListener("connectionstatechange", () => {
        setPeerStates((current) => ({
          ...current,
          [peerParticipantId]: pc.connectionState
        }));

        if (
          pc.connectionState === "failed" ||
          pc.connectionState === "closed"
        ) {
          closePeer(peerParticipantId);
        }
      });

      pc.addEventListener("negotiationneeded", async () => {
        if (linksRef.current.get(peerParticipantId) !== link) return;

        try {
          link.makingOffer = true;
          await pc.setLocalDescription();
          const description = pc.localDescription;
          if (
            description &&
            (description.type === "offer" ||
              description.type === "answer") &&
            description.sdp
          ) {
            signalForCurrentSession(peerParticipantId, {
              kind: description.type,
              sdp: description.sdp
            });
          }
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Group media negotiation failed."
          );
        } finally {
          link.makingOffer = false;
        }
      });

      return link;
    },
    [
      closePeer,
      currentPlan,
      rtcConfig,
      signalForCurrentSession
    ]
  );

  const applySignal = useCallback(
    async (message: GroupRtcSignalRelayMessage) => {
      const state = stateRef.current;
      if (
        !state ||
        message.mediaSessionId !== state.mediaSessionId ||
        message.generation !== state.generation
      ) {
        return;
      }

      const plan = currentPlan(message.fromParticipantId);
      if (!plan) return;

      const link = ensurePeer(message.fromParticipantId);
      const pc = link.pc;
      const signal = message.signal;

      if (signal.kind === "hangup") {
        closePeer(message.fromParticipantId);
        return;
      }

      if (signal.kind === "offer" || signal.kind === "answer") {
        const description: RTCSessionDescriptionInit = {
          type: signal.kind,
          sdp: signal.sdp
        };

        link.ignoreOffer = shouldIgnoreOffer({
          polite:
            participantId.localeCompare(message.fromParticipantId) > 0,
          descriptionType: description.type!,
          makingOffer: link.makingOffer,
          signalingState: pc.signalingState,
          isSettingRemoteAnswerPending:
            link.isSettingRemoteAnswerPending
        });

        if (link.ignoreOffer) return;

        link.isSettingRemoteAnswerPending =
          description.type === "answer";

        try {
          await pc.setRemoteDescription(description);
        } finally {
          link.isSettingRemoteAnswerPending = false;
        }

        if (description.type === "offer") {
          await pc.setLocalDescription();
          const local = pc.localDescription;
          if (
            local &&
            (local.type === "offer" || local.type === "answer") &&
            local.sdp
          ) {
            signalForCurrentSession(message.fromParticipantId, {
              kind: local.type,
              sdp: local.sdp
            });
          }
        }

        const pending = link.pendingIce;
        link.pendingIce = [];
        for (const candidate of pending) {
          try {
            await pc.addIceCandidate(candidate);
          } catch (cause) {
            if (!link.ignoreOffer) throw cause;
          }
        }
        return;
      }

      const candidate: RTCIceCandidateInit = {
        candidate: signal.candidate,
        sdpMid: signal.sdpMid,
        sdpMLineIndex: signal.sdpMLineIndex,
        usernameFragment: signal.usernameFragment
      };

      if (link.ignoreOffer) return;

      if (pc.remoteDescription) {
        await pc.addIceCandidate(candidate);
      } else {
        link.pendingIce.push(candidate);
      }
    },
    [
      closePeer,
      currentPlan,
      ensurePeer,
      participantId,
      signalForCurrentSession
    ]
  );

  const drainQueuedSignals = useCallback(
    async (peerParticipantId: string) => {
      const queued =
        queuedSignalsRef.current.get(peerParticipantId) ?? [];
      queuedSignalsRef.current.delete(peerParticipantId);

      for (const message of queued) {
        await applySignal(message);
      }
    },
    [applySignal]
  );

  const reconcile = useCallback(async () => {
    const state = stateRef.current;
    if (!state || !joined) {
      cleanupAllPeers();
      return;
    }

    const currentPlans = buildGroupPeerPlans(state, participantId);
    const desiredPeers = new Set(
      currentPlans.map((plan) => plan.peerParticipantId)
    );

    for (const peerId of [...linksRef.current.keys()]) {
      if (!desiredPeers.has(peerId)) {
        closePeer(peerId);
      }
    }

    for (const plan of currentPlans) {
      const link = ensurePeer(plan.peerParticipantId);
      const localTrack = localStreamRef.current?.getAudioTracks()[0];

      if (plan.sendLocal && localTrack && !link.sender) {
        link.sender = link.pc.addTrack(
          localTrack,
          localStreamRef.current!
        );
      } else if (!plan.sendLocal && link.sender) {
        link.pc.removeTrack(link.sender);
        link.sender = undefined;
      }

      if (!plan.receiveRemote) {
        setRemoteStreams((current) => {
          if (!current[plan.peerParticipantId]) return current;
          const next = { ...current };
          delete next[plan.peerParticipantId];
          return next;
        });
      }

      await drainQueuedSignals(plan.peerParticipantId);
    }
  }, [
    cleanupAllPeers,
    closePeer,
    drainQueuedSignals,
    ensurePeer,
    joined,
    participantId
  ]);

  useEffect(() => {
    void reconcile().catch((cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not reconcile group media routes."
      );
    });
  }, [groupState, reconcile]);

  useEffect(() => {
    let cancelled = false;

    async function processSignals() {
      for (const message of signalInbox) {
        if (
          cancelled ||
          processingRef.current.has(message.requestId)
        ) {
          continue;
        }

        processingRef.current.add(message.requestId);
        try {
          const plan = currentPlan(message.fromParticipantId);
          if (!plan) {
            const queued =
              queuedSignalsRef.current.get(
                message.fromParticipantId
              ) ?? [];
            queued.push(message);
            queuedSignalsRef.current.set(
              message.fromParticipantId,
              queued
            );
          } else {
            await applySignal(message);
          }
        } catch (cause) {
          setError(
            cause instanceof Error
              ? cause.message
              : "Group media signaling failed."
          );
        } finally {
          consumeSignal(message.requestId);
          processingRef.current.delete(message.requestId);
        }
      }
    }

    void processSignals();
    return () => {
      cancelled = true;
    };
  }, [
    applySignal,
    consumeSignal,
    currentPlan,
    signalInbox
  ]);

  useEffect(() => {
    if (roomConnected) return;
    cleanupAllPeers();
    stopLocalMedia();
  }, [cleanupAllPeers, roomConnected, stopLocalMedia]);

  useEffect(() => {
    return () => {
      cleanupAllPeers();
      stopLocalMedia();
    };
  }, [cleanupAllPeers, stopLocalMedia]);

  const join = useCallback(() => {
    setError(null);
    return joinGroup();
  }, [joinGroup]);

  const leave = useCallback(() => {
    const sent = leaveGroup();
    cleanupAllPeers();
    stopLocalMedia();
    return sent;
  }, [cleanupAllPeers, leaveGroup, stopLocalMedia]);

  const enableMicrophone = useCallback(async () => {
    if (!joined) {
      setError("Join group media before publishing a microphone.");
      return false;
    }

    if (
      mediaContextLabel({
        pageUrl: window.location.href,
        secureContext: window.isSecureContext
      }) !== "secure"
    ) {
      setError("Microphone access requires HTTPS or localhost.");
      return false;
    }

    if (!rtcConfig || configExpired(rtcConfig)) {
      setError("Usable ICE configuration is required first.");
      return false;
    }

    try {
      if (!localStreamRef.current) {
        localStreamRef.current =
          await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });
      }

      const sent = publishMicrophone();
      if (!sent) {
        stopLocalMedia();
        setError("Could not publish the microphone source.");
        return false;
      }

      setError(null);
      return true;
    } catch (cause) {
      stopLocalMedia();
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the microphone."
      );
      return false;
    }
  }, [
    joined,
    publishMicrophone,
    rtcConfig,
    stopLocalMedia
  ]);

  const disableMicrophone = useCallback(() => {
    if (ownSource) {
      unpublishSource(ownSource.sourceId);
    }

    for (const link of linksRef.current.values()) {
      if (link.sender) {
        link.pc.removeTrack(link.sender);
        link.sender = undefined;
      }
    }

    stopLocalMedia();
  }, [ownSource, stopLocalMedia, unpublishSource]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const next = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !next;
    });
    setMuted(next);
  }, [muted]);

  return {
    joined,
    ownSource,
    plans,
    remoteStreams,
    peerStates,
    muted,
    error,
    microphoneEnabled: Boolean(localStreamRef.current),
    routerMode: groupState?.routerMode,
    join,
    leave,
    enableMicrophone,
    disableMicrophone,
    toggleMute,
    subscribeSource,
    unsubscribeSource
  };
}
