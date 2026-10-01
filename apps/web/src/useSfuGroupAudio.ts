import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Device } from "mediasoup-client";
import type {
  GroupMediaStateMessage,
  JsonObject,
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
  publishMicrophone: () => boolean;
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
  publishMicrophone,
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
  const producerRef = useRef<{
    sourceId: string;
    producer: ClientProducer;
  } | null>(null);
  const producerCreatingRef = useRef<string | null>(null);
  const consumersRef = useRef(
    new Map<string, ClientConsumer>()
  );
  const consumerCreatingRef = useRef(new Set<string>());
  const localStreamRef = useRef<MediaStream | null>(null);

  const [remoteStreams, setRemoteStreams] = useState<
    Record<string, MediaStream>
  >({});
  const [muted, setMuted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendState, setSendState] = useState("closed");
  const [recvState, setRecvState] = useState("closed");
  const [sfuReady, setSfuReady] = useState(false);

  stateRef.current = groupState;

  const joined = Boolean(
    groupState?.participants.some(
      (participant) =>
        participant.participantId === participantId
    )
  );

  const ownSource = useMemo(
    () =>
      groupState?.sources.find(
        (source) =>
          source.ownerParticipantId === participantId
      ),
    [groupState, participantId]
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
  }, []);

  const closeProducer = useCallback(() => {
    producerRef.current?.producer.close();
    producerRef.current = null;
    producerCreatingRef.current = null;
  }, []);

  const stopLocalMedia = useCallback(() => {
    localStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());
    localStreamRef.current = null;
    setMuted(false);
  }, []);

  const closeSfu = useCallback(
    (stopMicrophone: boolean) => {
      closeProducer();

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

      if (stopMicrophone) {
        stopLocalMedia();
      }
    },
    [closeConsumer, closeProducer, stopLocalMedia]
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
    async (sourceId: string) => {
      if (
        producerRef.current?.sourceId === sourceId ||
        producerCreatingRef.current === sourceId
      ) {
        return;
      }

      const stream = localStreamRef.current;
      const track = stream?.getAudioTracks()[0];
      if (!stream || !track || track.readyState === "ended") {
        return;
      }

      producerCreatingRef.current = sourceId;

      try {
        const transport = await ensureSendTransport();
        closeProducer();

        const producer = await transport.produce({
          track,
          stopTracks: false,
          appData: { sourceId }
        });

        producer.on("transportclose", () => {
          if (producerRef.current?.producer === producer) {
            producerRef.current = null;
          }
        });
        producer.on("trackended", () => {
          const current = stateRef.current;
          const source = current?.sources.find(
            (candidate) =>
              candidate.sourceId === sourceId
          );
          if (source) {
            unpublishSource(sourceId);
          }
          producerRef.current = null;
          stopLocalMedia();
        });

        producerRef.current = { sourceId, producer };
        setError(null);
      } finally {
        producerCreatingRef.current = null;
      }
    },
    [
      closeProducer,
      ensureSendTransport,
      stopLocalMedia,
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

        // A subscription may arrive a few milliseconds before the owner has
        // completed transport.produce(). The server broadcasts group state
        // again after the producer is live, which gives this effect a retry.
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
    if (!joined || !ownSource) {
      closeProducer();
      return;
    }

    void ensureProducer(ownSource.sourceId).catch((cause) => {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not publish the governed microphone source."
      );
    });
  }, [
    closeProducer,
    ensureProducer,
    groupState,
    joined,
    ownSource
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

      if (!publishMicrophone()) {
        stopLocalMedia();
        setError(
          "Could not publish the microphone source."
        );
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
    ensureDevice,
    joined,
    publishMicrophone,
    stopLocalMedia
  ]);

  const disableMicrophone = useCallback(() => {
    if (ownSource) {
      unpublishSource(ownSource.sourceId);
    }
    closeProducer();
    stopLocalMedia();
  }, [
    closeProducer,
    ownSource,
    stopLocalMedia,
    unpublishSource
  ]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;

    const nextMuted = !muted;
    stream.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  }, [muted]);

  return {
    joined,
    ownSource,
    remoteStreams,
    muted,
    error,
    microphoneEnabled: Boolean(localStreamRef.current),
    routerMode: groupState?.routerMode,
    sfuReady,
    sendState,
    recvState,
    consumerCount: consumersRef.current.size,
    join,
    leave,
    enableMicrophone,
    disableMicrophone,
    toggleMute,
    subscribeSource,
    unsubscribeSource
  };
}
