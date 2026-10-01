import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Device } from "mediasoup-client";
import type {
  GroupMediaSource,
  GroupMediaStateMessage,
  JsonObject,
  MediaSourceKind,
  SfuCapabilitiesRequestMessage,
  SfuConsumeMessage,
  SfuConsumerResumeMessage,
  SfuProduceMessage,
  SfuTransportConnectMessage,
  SfuTransportCreateMessage
} from "@commonline/protocol";
import type { SfuServerResponse } from "./useCommonlineRoom";
import { mediaContextLabel } from "./transportSecurity";

type SendTransport = ReturnType<Device["createSendTransport"]>;
type RecvTransport = ReturnType<Device["createRecvTransport"]>;
type ClientProducer = Awaited<ReturnType<SendTransport["produce"]>>;
type ClientConsumer = Awaited<ReturnType<RecvTransport["consume"]>>;

export interface SfuConsumerEvidence {
  sourceId: string;
  consumerId: string;
  trackState: MediaStreamTrackState;
  bytesReceived: number;
  packetsReceived: number;
  jitterSeconds?: number;
  updatedAt: string;
}

interface UseSfuGroupAudioInput {
  participantId: string;
  roomConnected: boolean;
  groupState: GroupMediaStateMessage | null;
  requestSfu: (
    message:
      | SfuCapabilitiesRequestMessage
      | SfuTransportCreateMessage
      | SfuTransportConnectMessage
      | SfuProduceMessage
      | SfuConsumeMessage
      | SfuConsumerResumeMessage
  ) => Promise<SfuServerResponse>;
  joinGroup: () => boolean;
  leaveGroup: () => boolean;
  publishSource: (kind: MediaSourceKind, label: string) => boolean;
  unpublishSource: (sourceId: string) => boolean;
  subscribeSource: (sourceId: string) => boolean;
  unsubscribeSource: (sourceId: string) => boolean;
}

function sessionKey(state: GroupMediaStateMessage | null) {
  return state
    ? `${state.mediaSessionId}:${state.generation}`
    : null;
}

export function useSfuGroupAudio({
  participantId,
  roomConnected,
  groupState,
  requestSfu,
  joinGroup,
  leaveGroup,
  publishSource,
  unpublishSource,
  subscribeSource,
  unsubscribeSource
}: UseSfuGroupAudioInput) {
  const stateRef = useRef<GroupMediaStateMessage | null>(groupState);
  const sessionKeyRef = useRef<string | null>(null);
  const deviceRef = useRef<Device | null>(null);
  const devicePromiseRef = useRef<Promise<Device> | null>(null);
  const sendTransportRef = useRef<SendTransport | null>(null);
  const sendTransportPromiseRef =
    useRef<Promise<SendTransport> | null>(null);
  const recvTransportRef = useRef<RecvTransport | null>(null);
  const recvTransportPromiseRef =
    useRef<Promise<RecvTransport> | null>(null);
  const producersRef = useRef(new Map<string, ClientProducer>());
  const producerCreatingRef = useRef(new Set<string>());
  const consumersRef = useRef(new Map<string, ClientConsumer>());
  const consumerCreatingRef = useRef(new Set<string>());
  const localTracksRef = useRef(
    new Map<MediaSourceKind, MediaStreamTrack>()
  );
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const cueContextRef = useRef<AudioContext | null>(null);
  const cueDestinationRef =
    useRef<MediaStreamAudioDestinationNode | null>(null);

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [consumerEvidence, setConsumerEvidence] = useState<
    Record<string, SfuConsumerEvidence>
  >({});
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendState, setSendState] = useState("closed");
  const [recvState, setRecvState] = useState("closed");
  const [sfuReady, setSfuReady] = useState(false);
  const [producingSourceIds, setProducingSourceIds] = useState<string[]>([]);

  stateRef.current = groupState;

  const joined = Boolean(
    groupState?.participants.some(
      (participant) =>
        participant.participantId === participantId
    )
  );

  const ownSources = useMemo(
    () =>
      groupState?.sources.filter(
        (source) =>
          source.ownerParticipantId === participantId
      ) ?? [],
    [groupState, participantId]
  );

  const microphoneSource = ownSources.find(
    (source) => source.kind === "human-microphone"
  );
  const soundEffectSource = ownSources.find(
    (source) => source.kind === "sound-effect"
  );

  const desiredSubscriptions = useMemo(
    () =>
      new Set(
        groupState?.subscriptions
          .filter(
            (subscription) =>
              subscription.subscriberParticipantId ===
              participantId
          )
          .map((subscription) => subscription.sourceId) ?? []
      ),
    [groupState, participantId]
  );

  const setProducing = useCallback(
    (sourceId: string, producing: boolean) => {
      setProducingSourceIds((current) => {
        const next = new Set(current);
        if (producing) next.add(sourceId);
        else next.delete(sourceId);
        return [...next];
      });
    },
    []
  );

  const closeConsumer = useCallback((sourceId: string) => {
    const consumer = consumersRef.current.get(sourceId);
    if (consumer) {
      consumer.close();
      consumersRef.current.delete(sourceId);
    }

    setRemoteStreams((current) => {
      if (!current[sourceId]) return current;
      const next = { ...current };
      delete next[sourceId];
      return next;
    });

    setConsumerEvidence((current) => {
      if (!current[sourceId]) return current;
      const next = { ...current };
      delete next[sourceId];
      return next;
    });
  }, []);

  const closeProducer = useCallback(
    (sourceId: string) => {
      const producer = producersRef.current.get(sourceId);
      if (producer) {
        producer.close();
        producersRef.current.delete(sourceId);
      }
      producerCreatingRef.current.delete(sourceId);
      setProducing(sourceId, false);
    },
    [setProducing]
  );

  const closeAllProducers = useCallback(() => {
    for (const sourceId of [...producersRef.current.keys()]) {
      closeProducer(sourceId);
    }
  }, [closeProducer]);

  const stopMicrophone = useCallback(() => {
    microphoneStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());
    microphoneStreamRef.current = null;
    localTracksRef.current.delete("human-microphone");
    setMuted(false);
  }, []);

  const stopSoundEffectBus = useCallback(() => {
    const track = localTracksRef.current.get("sound-effect");
    track?.stop();
    localTracksRef.current.delete("sound-effect");
    cueDestinationRef.current = null;

    const context = cueContextRef.current;
    cueContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close();
    }
  }, []);

  const closeSfu = useCallback(
    (stopLocalSources: boolean) => {
      closeAllProducers();

      for (const sourceId of [
        ...consumersRef.current.keys()
      ]) {
        closeConsumer(sourceId);
      }

      sendTransportRef.current?.close();
      recvTransportRef.current?.close();
      sendTransportRef.current = null;
      recvTransportRef.current = null;
      sendTransportPromiseRef.current = null;
      recvTransportPromiseRef.current = null;
      deviceRef.current = null;
      devicePromiseRef.current = null;
      consumerCreatingRef.current.clear();
      sessionKeyRef.current = null;
      setSfuReady(false);
      setSendState("closed");
      setRecvState("closed");

      if (stopLocalSources) {
        stopMicrophone();
        stopSoundEffectBus();
      }
    },
    [
      closeAllProducers,
      closeConsumer,
      stopMicrophone,
      stopSoundEffectBus
    ]
  );

  const assertCurrentSession = useCallback(() => {
    const state = stateRef.current;
    if (
      !state ||
      !state.participants.some(
        (participant) =>
          participant.participantId === participantId
      )
    ) {
      throw new Error(
        "Join the active group media session first."
      );
    }

    if (state.routerMode !== "mediasoup-p0") {
      throw new Error(
        `Unsupported group media router mode ${state.routerMode}.`
      );
    }

    return state;
  }, [participantId]);

  const ensureDevice = useCallback(async () => {
    const state = assertCurrentSession();
    const key = sessionKey(state)!;

    if (
      deviceRef.current &&
      sessionKeyRef.current === key
    ) {
      return deviceRef.current;
    }

    if (
      devicePromiseRef.current &&
      sessionKeyRef.current === key
    ) {
      return devicePromiseRef.current;
    }

    if (
      sessionKeyRef.current &&
      sessionKeyRef.current !== key
    ) {
      closeSfu(false);
    }

    sessionKeyRef.current = key;

    const promise = (async () => {
      const response = await requestSfu({
        type: "sfu_capabilities_request",
        requestId: crypto.randomUUID(),
        roomId: state.roomId,
        mediaSessionId: state.mediaSessionId,
        generation: state.generation
      });

      if (response.type !== "sfu_capabilities") {
        throw new Error(
          `Expected sfu_capabilities, received ${response.type}.`
        );
      }

      const device = new Device();
      await device.load({
        routerRtpCapabilities:
          response.routerRtpCapabilities as unknown as
            Parameters<Device["load"]>[0]["routerRtpCapabilities"]
      });

      if (!device.canProduce("audio")) {
        throw new Error(
          "This browser cannot produce Opus audio to the Commonline SFU."
        );
      }

      deviceRef.current = device;
      setSfuReady(true);
      return device;
    })();

    devicePromiseRef.current = promise;

    try {
      return await promise;
    } finally {
      devicePromiseRef.current = null;
    }
  }, [
    assertCurrentSession,
    closeSfu,
    requestSfu
  ]);

  const connectTransport = useCallback(
    async (
      transportId: string,
      dtlsParameters: JsonObject
    ) => {
      const state = assertCurrentSession();
      const response = await requestSfu({
        type: "sfu_transport_connect",
        requestId: crypto.randomUUID(),
        roomId: state.roomId,
        mediaSessionId: state.mediaSessionId,
        generation: state.generation,
        transportId,
        dtlsParameters
      });

      if (response.type !== "sfu_transport_connected") {
        throw new Error(
          `Expected sfu_transport_connected, received ${response.type}.`
        );
      }
    },
    [assertCurrentSession, requestSfu]
  );

  const ensureSendTransport = useCallback(async () => {
    if (sendTransportRef.current) {
      return sendTransportRef.current;
    }
    if (sendTransportPromiseRef.current) {
      return sendTransportPromiseRef.current;
    }

    const promise = (async () => {
      const state = assertCurrentSession();
      const device = await ensureDevice();

      const response = await requestSfu({
        type: "sfu_transport_create",
        requestId: crypto.randomUUID(),
        roomId: state.roomId,
        mediaSessionId: state.mediaSessionId,
        generation: state.generation,
        direction: "send"
      });

      if (
        response.type !== "sfu_transport_created" ||
        response.direction !== "send"
      ) {
        throw new Error(
          `Expected send sfu_transport_created, received ${response.type}.`
        );
      }

      const transport = device.createSendTransport(
        response.transport as unknown as
          Parameters<Device["createSendTransport"]>[0]
      );

      transport.on(
        "connect",
        ({ dtlsParameters }, callback, errback) => {
          void connectTransport(
            transport.id,
            dtlsParameters as unknown as JsonObject
          )
            .then(callback)
            .catch((cause) => {
              errback(
                cause instanceof Error
                  ? cause
                  : new Error(String(cause))
              );
            });
        }
      );

      transport.on(
        "produce",
        (
          { kind, rtpParameters, appData },
          callback,
          errback
        ) => {
          const sourceId =
            typeof appData.sourceId === "string"
              ? appData.sourceId
              : undefined;
          const current = stateRef.current;

          if (
            !sourceId ||
            !current ||
            kind !== "audio"
          ) {
            errback(
              new Error(
                "SFU producer is missing its governed audio source id."
              )
            );
            return;
          }

          void requestSfu({
            type: "sfu_produce",
            requestId: crypto.randomUUID(),
            roomId: current.roomId,
            mediaSessionId: current.mediaSessionId,
            generation: current.generation,
            transportId: transport.id,
            sourceId,
            kind: "audio",
            rtpParameters:
              rtpParameters as unknown as JsonObject,
            appData: appData as unknown as JsonObject
          })
            .then((produceResponse) => {
              if (produceResponse.type !== "sfu_produced") {
                throw new Error(
                  `Expected sfu_produced, received ${produceResponse.type}.`
                );
              }
              callback({ id: produceResponse.producerId });
            })
            .catch((cause) => {
              errback(
                cause instanceof Error
                  ? cause
                  : new Error(String(cause))
              );
            });
        }
      );

      transport.on("connectionstatechange", (state) => {
        setSendState(state);
        if (state === "failed" || state === "closed") {
          sendTransportRef.current = null;
        }
      });

      sendTransportRef.current = transport;
      return transport;
    })();

    sendTransportPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      sendTransportPromiseRef.current = null;
    }
  }, [
    assertCurrentSession,
    connectTransport,
    ensureDevice,
    requestSfu
  ]);

  const ensureRecvTransport = useCallback(async () => {
    if (recvTransportRef.current) {
      return recvTransportRef.current;
    }
    if (recvTransportPromiseRef.current) {
      return recvTransportPromiseRef.current;
    }

    const promise = (async () => {
      const state = assertCurrentSession();
      const device = await ensureDevice();

      const response = await requestSfu({
        type: "sfu_transport_create",
        requestId: crypto.randomUUID(),
        roomId: state.roomId,
        mediaSessionId: state.mediaSessionId,
        generation: state.generation,
        direction: "recv"
      });

      if (
        response.type !== "sfu_transport_created" ||
        response.direction !== "recv"
      ) {
        throw new Error(
          `Expected recv sfu_transport_created, received ${response.type}.`
        );
      }

      const transport = device.createRecvTransport(
        response.transport as unknown as
          Parameters<Device["createRecvTransport"]>[0]
      );

      transport.on(
        "connect",
        ({ dtlsParameters }, callback, errback) => {
          void connectTransport(
            transport.id,
            dtlsParameters as unknown as JsonObject
          )
            .then(callback)
            .catch((cause) => {
              errback(
                cause instanceof Error
                  ? cause
                  : new Error(String(cause))
              );
            });
        }
      );

      transport.on("connectionstatechange", (state) => {
        setRecvState(state);
        if (state === "failed" || state === "closed") {
          recvTransportRef.current = null;
        }
      });

      recvTransportRef.current = transport;
      return transport;
    })();

    recvTransportPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      recvTransportPromiseRef.current = null;
    }
  }, [
    assertCurrentSession,
    connectTransport,
    ensureDevice,
    requestSfu
  ]);

  const ensureProducer = useCallback(
    async (source: GroupMediaSource) => {
      if (
        producersRef.current.has(source.sourceId) ||
        producerCreatingRef.current.has(source.sourceId)
      ) {
        return;
      }

      const track = localTracksRef.current.get(source.kind);
      if (!track || track.readyState === "ended") {
        return;
      }

      producerCreatingRef.current.add(source.sourceId);

      try {
        const transport = await ensureSendTransport();
        const producer = await transport.produce({
          track,
          stopTracks: false,
          appData: {
            sourceId: source.sourceId,
            sourceKind: source.kind,
            policyId: source.policyId
          }
        });

        producer.on("transportclose", () => {
          if (producersRef.current.get(source.sourceId) === producer) {
            producersRef.current.delete(source.sourceId);
            setProducing(source.sourceId, false);
          }
        });

        producer.on("trackended", () => {
          if (producersRef.current.get(source.sourceId) === producer) {
            producersRef.current.delete(source.sourceId);
            setProducing(source.sourceId, false);
          }
          unpublishSource(source.sourceId);

          if (source.kind === "human-microphone") {
            stopMicrophone();
          } else if (source.kind === "sound-effect") {
            stopSoundEffectBus();
          }
        });

        producersRef.current.set(source.sourceId, producer);
        setProducing(source.sourceId, true);
        setError(null);
      } finally {
        producerCreatingRef.current.delete(source.sourceId);
      }
    },
    [
      ensureSendTransport,
      setProducing,
      stopMicrophone,
      stopSoundEffectBus,
      unpublishSource
    ]
  );

  const ensureConsumer = useCallback(
    async (sourceId: string) => {
      if (
        consumersRef.current.has(sourceId) ||
        consumerCreatingRef.current.has(sourceId)
      ) {
        return;
      }

      const state = assertCurrentSession();
      if (
        !state.subscriptions.some(
          (subscription) =>
            subscription.subscriberParticipantId ===
              participantId &&
            subscription.sourceId === sourceId
        )
      ) {
        return;
      }

      consumerCreatingRef.current.add(sourceId);

      try {
        const device = await ensureDevice();
        const transport = await ensureRecvTransport();

        const response = await requestSfu({
          type: "sfu_consume",
          requestId: crypto.randomUUID(),
          roomId: state.roomId,
          mediaSessionId: state.mediaSessionId,
          generation: state.generation,
          transportId: transport.id,
          sourceId,
          rtpCapabilities:
            device.rtpCapabilities as unknown as JsonObject
        });

        if (response.type !== "sfu_consumed") {
          throw new Error(
            `Expected sfu_consumed, received ${response.type}.`
          );
        }

        const latest = stateRef.current;
        if (
          !latest ||
          !latest.subscriptions.some(
            (subscription) =>
              subscription.subscriberParticipantId ===
                participantId &&
              subscription.sourceId === sourceId
          )
        ) {
          return;
        }

        const consumer = await transport.consume({
          id: response.consumerId,
          producerId: response.producerId,
          kind: response.kind,
          rtpParameters:
            response.rtpParameters as unknown as
              Parameters<RecvTransport["consume"]>[0]["rtpParameters"],
          appData: { sourceId }
        });

        consumersRef.current.set(sourceId, consumer);
        setRemoteStreams((current) => ({
          ...current,
          [sourceId]: new MediaStream([consumer.track])
        }));

        const remove = () => closeConsumer(sourceId);
        consumer.on("transportclose", remove);
        consumer.on("trackended", remove);

        const resumed = await requestSfu({
          type: "sfu_consumer_resume",
          requestId: crypto.randomUUID(),
          roomId: latest.roomId,
          mediaSessionId: latest.mediaSessionId,
          generation: latest.generation,
          consumerId: consumer.id
        });

        if (resumed.type !== "sfu_consumer_resumed") {
          throw new Error(
            `Expected sfu_consumer_resumed, received ${resumed.type}.`
          );
        }

        setError(null);
      } catch (cause) {
        const message =
          cause instanceof Error
            ? cause.message
            : String(cause);

        if (!message.includes("SFU_SOURCE_NOT_READY")) {
          setError(message);
        }
      } finally {
        consumerCreatingRef.current.delete(sourceId);
      }
    },
    [
      assertCurrentSession,
      closeConsumer,
      ensureDevice,
      ensureRecvTransport,
      participantId,
      requestSfu
    ]
  );

  useEffect(() => {
    const key = sessionKey(groupState);

    if (!joined || !groupState) {
      if (sessionKeyRef.current) {
        closeSfu(false);
      }
      return;
    }

    if (
      sessionKeyRef.current &&
      sessionKeyRef.current !== key
    ) {
      closeSfu(false);
    }

    void ensureDevice().catch((cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not initialize the Commonline SFU device."
      );
    });
  }, [
    closeSfu,
    ensureDevice,
    groupState,
    joined
  ]);

  useEffect(() => {
    const activeOwnIds = new Set(
      ownSources.map((source) => source.sourceId)
    );

    for (const sourceId of [...producersRef.current.keys()]) {
      if (!activeOwnIds.has(sourceId)) {
        closeProducer(sourceId);
      }
    }

    if (!joined) return;

    for (const source of ownSources) {
      void ensureProducer(source).catch((cause) => {
        setError(
          cause instanceof Error
            ? cause.message
            : `Could not publish ${source.kind} to the SFU.`
        );
      });
    }
  }, [
    closeProducer,
    ensureProducer,
    joined,
    ownSources
  ]);

  useEffect(() => {
    if (!joined || !groupState) {
      for (const sourceId of [
        ...consumersRef.current.keys()
      ]) {
        closeConsumer(sourceId);
      }
      return;
    }

    for (const sourceId of [
      ...consumersRef.current.keys()
    ]) {
      if (!desiredSubscriptions.has(sourceId)) {
        closeConsumer(sourceId);
      }
    }

    for (const sourceId of desiredSubscriptions) {
      void ensureConsumer(sourceId);
    }
  }, [
    closeConsumer,
    desiredSubscriptions,
    ensureConsumer,
    groupState,
    joined
  ]);

  const refreshConsumerEvidence = useCallback(async () => {
    const next: Record<string, SfuConsumerEvidence> = {};

    await Promise.all(
      [...consumersRef.current.entries()].map(
        async ([sourceId, consumer]) => {
          let bytesReceived = 0;
          let packetsReceived = 0;
          let jitterSeconds: number | undefined;

          try {
            const report = await consumer.getStats();
            report.forEach((stat) => {
              const value = stat as unknown as Record<string, unknown>;
              if (
                value.type !== "inbound-rtp" ||
                (value.kind !== undefined &&
                  value.kind !== "audio" &&
                  value.mediaType !== "audio")
              ) {
                return;
              }

              if (typeof value.bytesReceived === "number") {
                bytesReceived += value.bytesReceived;
              }
              if (typeof value.packetsReceived === "number") {
                packetsReceived += value.packetsReceived;
              }
              if (typeof value.jitter === "number") {
                jitterSeconds = value.jitter;
              }
            });
          } catch {
            // Acceptance evidence must observe media without being able to
            // disrupt the media path if browser stats are temporarily absent.
          }

          next[sourceId] = {
            sourceId,
            consumerId: consumer.id,
            trackState: consumer.track.readyState,
            bytesReceived,
            packetsReceived,
            jitterSeconds,
            updatedAt: new Date().toISOString()
          };
        }
      )
    );

    setConsumerEvidence(next);
  }, []);

  useEffect(() => {
    if (!joined) {
      setConsumerEvidence({});
      return;
    }

    void refreshConsumerEvidence();
    const timer = window.setInterval(() => {
      void refreshConsumerEvidence();
    }, 500);

    return () => window.clearInterval(timer);
  }, [joined, refreshConsumerEvidence]);

  useEffect(() => {
    if (roomConnected) return;
    closeSfu(true);
  }, [closeSfu, roomConnected]);

  useEffect(
    () => () => {
      closeSfu(true);
    },
    [closeSfu]
  );

  const join = useCallback(() => {
    setError(null);
    return joinGroup();
  }, [joinGroup]);

  const leave = useCallback(() => {
    const sent = leaveGroup();
    closeSfu(true);
    return sent;
  }, [closeSfu, leaveGroup]);

  const enableMicrophone = useCallback(async () => {
    if (!joined) {
      setError(
        "Join group media before publishing a microphone."
      );
      return false;
    }

    if (
      mediaContextLabel({
        pageUrl: window.location.href,
        secureContext: window.isSecureContext
      }) !== "secure"
    ) {
      setError(
        "Microphone access requires HTTPS or localhost."
      );
      return false;
    }

    try {
      await ensureDevice();

      if (!microphoneStreamRef.current) {
        microphoneStreamRef.current =
          await navigator.mediaDevices.getUserMedia({
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            },
            video: false
          });
      }

      const track =
        microphoneStreamRef.current.getAudioTracks()[0];
      if (!track) {
        throw new Error("Browser returned no microphone track.");
      }
      localTracksRef.current.set("human-microphone", track);

      if (
        !publishSource(
          "human-microphone",
          "Human microphone"
        )
      ) {
        stopMicrophone();
        setError(
          "Could not register the governed microphone source."
        );
        return false;
      }

      setError(null);
      return true;
    } catch (cause) {
      stopMicrophone();
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not open the microphone."
      );
      return false;
    }
  }, [
    ensureDevice,
    joined,
    publishSource,
    stopMicrophone
  ]);

  const disableMicrophone = useCallback(() => {
    if (microphoneSource) {
      unpublishSource(microphoneSource.sourceId);
      closeProducer(microphoneSource.sourceId);
    }
    stopMicrophone();
  }, [
    closeProducer,
    microphoneSource,
    stopMicrophone,
    unpublishSource
  ]);

  const toggleMute = useCallback(() => {
    const stream = microphoneStreamRef.current;
    if (!stream) return;

    const nextMuted = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }, [muted]);

  const enableSoundEffects = useCallback(async () => {
    if (!joined) {
      setError(
        "Join group media before publishing a sound-effect source."
      );
      return false;
    }

    try {
      await ensureDevice();

      if (!cueContextRef.current || !cueDestinationRef.current) {
        const context = new AudioContext();
        const destination = context.createMediaStreamDestination();
        await context.resume();

        const track = destination.stream.getAudioTracks()[0];
        if (!track) {
          await context.close();
          throw new Error(
            "Browser could not create the sound-effect media track."
          );
        }

        cueContextRef.current = context;
        cueDestinationRef.current = destination;
        localTracksRef.current.set("sound-effect", track);
      }

      if (
        !publishSource(
          "sound-effect",
          "Governed sound effects"
        )
      ) {
        stopSoundEffectBus();
        setError(
          "Could not register the governed sound-effect source."
        );
        return false;
      }

      setError(null);
      return true;
    } catch (cause) {
      stopSoundEffectBus();
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not create the sound-effect source."
      );
      return false;
    }
  }, [
    ensureDevice,
    joined,
    publishSource,
    stopSoundEffectBus
  ]);

  const disableSoundEffects = useCallback(() => {
    if (soundEffectSource) {
      unpublishSource(soundEffectSource.sourceId);
      closeProducer(soundEffectSource.sourceId);
    }
    stopSoundEffectBus();
  }, [
    closeProducer,
    soundEffectSource,
    stopSoundEffectBus,
    unpublishSource
  ]);

  const triggerSoundEffect = useCallback(async () => {
    const context = cueContextRef.current;
    const destination = cueDestinationRef.current;

    if (
      !context ||
      !destination ||
      !soundEffectSource ||
      !producingSourceIds.includes(soundEffectSource.sourceId)
    ) {
      setError(
        "Publish the governed sound-effect source and wait for its SFU Producer first."
      );
      return;
    }

    await context.resume();

    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const now = context.currentTime;

    oscillator.type = "sawtooth";
    oscillator.frequency.setValueAtTime(118, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      52,
      now + 0.42
    );

    filter.type = "lowpass";
    filter.frequency.setValueAtTime(460, now);
    filter.Q.setValueAtTime(0.7, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(
      0.0001,
      now + 0.46
    );

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(destination);

    oscillator.start(now);
    oscillator.stop(now + 0.48);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    });

    setError(null);
  }, [producingSourceIds, soundEffectSource]);

  return {
    joined,
    ownSources,
    microphoneSource,
    soundEffectSource,
    remoteStreams,
    consumerEvidence,
    muted,
    error,
    microphoneEnabled: Boolean(microphoneStreamRef.current),
    soundEffectsEnabled: Boolean(cueContextRef.current),
    soundEffectReady: Boolean(
      soundEffectSource &&
        producingSourceIds.includes(soundEffectSource.sourceId)
    ),
    routerMode: groupState?.routerMode,
    sourcePolicies: groupState?.sourcePolicies ?? [],
    sfuReady,
    sendState,
    recvState,
    consumerCount: consumersRef.current.size,
    producerCount: producingSourceIds.length,
    join,
    leave,
    enableMicrophone,
    disableMicrophone,
    toggleMute,
    enableSoundEffects,
    disableSoundEffects,
    triggerSoundEffect,
    subscribeSource,
    unsubscribeSource
  };
}
