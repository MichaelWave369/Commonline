import { randomInt } from "node:crypto";
import * as mediasoup from "mediasoup";
import type {
  Consumer,
  DirectTransport,
  DtlsParameters,
  Producer,
  Router,
  RouterRtpCodecCapability,
  RtpCapabilities,
  RtpParameters,
  WebRtcServer,
  WebRtcTransport,
  Worker
} from "mediasoup/types";
import type {
  JsonObject,
  SfuTransportDirection,
  SfuTransportOptions
} from "@commonline/protocol";
import type { GroupMediaSession } from "./groupMediaRegistry";
import {
  buildPcmuRtpPacket,
  pcm16ToPcmu,
  resamplePcm16,
  type Pcm16Audio
} from "./audioPcm";

interface ParticipantSfuState {
  sendTransport?: WebRtcTransport;
  recvTransport?: WebRtcTransport;
  producers: Map<string, Producer>;
  consumers: Map<string, Consumer>;
}

interface DirectAudioState {
  sequence: number;
  timestamp: number;
  ssrc: number;
  lastSentAt?: number;
  queue: Promise<void>;
}

interface RoomSfuState {
  mediaSessionId: string;
  generation: number;
  router: Router;
  directTransport?: DirectTransport;
  directAudio: Map<string, DirectAudioState>;
  participants: Map<string, ParticipantSfuState>;
  sourceProducers: Map<
    string,
    { ownerParticipantId: string; producer: Producer }
  >;
}

export interface MediasoupSfuConfig {
  listenIp: string;
  announcedAddress?: string;
  port?: number;
}

export function mediasoupConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env
): MediasoupSfuConfig {
  const listenIp =
    env.COMMONLINE_SFU_LISTEN_IP?.trim() || "127.0.0.1";
  const announcedAddress =
    env.COMMONLINE_SFU_ANNOUNCED_ADDRESS?.trim() || undefined;

  const rawPort = env.COMMONLINE_SFU_PORT?.trim();
  const port =
    rawPort === undefined || rawPort === ""
      ? 44444
      : Number(rawPort);

  if (
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(
      "COMMONLINE_SFU_PORT must be an integer from 1 through 65535."
    );
  }

  if (
    (listenIp === "0.0.0.0" || listenIp === "::") &&
    !announcedAddress
  ) {
    throw new Error(
      "COMMONLINE_SFU_ANNOUNCED_ADDRESS is required when the SFU listens on a wildcard address."
    );
  }

  return {
    listenIp,
    announcedAddress,
    port
  };
}

const AUDIO_CODECS: RouterRtpCodecCapability[] = [
  {
    kind: "audio",
    mimeType: "audio/opus",
    clockRate: 48000,
    channels: 2,
    parameters: {
      useinbandfec: 1
    }
  },
  {
    kind: "audio",
    mimeType: "audio/PCMU",
    preferredPayloadType: 0,
    clockRate: 8000,
    channels: 1
  }
];

function participantState(): ParticipantSfuState {
  return {
    producers: new Map(),
    consumers: new Map()
  };
}

function asJsonObject(value: unknown) {
  return value as JsonObject;
}

export class MediasoupSfuAdapter {
  private readonly rooms = new Map<string, RoomSfuState>();

  private constructor(
    private readonly worker: Worker,
    private readonly webRtcServer: WebRtcServer
  ) {}

  static async create(config: MediasoupSfuConfig) {
    const worker = await mediasoup.createWorker({
      logLevel: "warn"
    });

    const base = {
      ip: config.listenIp,
      announcedAddress: config.announcedAddress,
      port: config.port
    };

    const webRtcServer = await worker.createWebRtcServer({
      listenInfos: [
        {
          protocol: "udp",
          ...base
        },
        {
          protocol: "tcp",
          ...base
        }
      ]
    });

    return new MediasoupSfuAdapter(worker, webRtcServer);
  }

  status() {
    return {
      workerPid: this.worker.pid,
      roomCount: this.rooms.size
    };
  }

  async routerCapabilities(session: GroupMediaSession) {
    const room = await this.ensureRoom(session);
    return asJsonObject(room.router.rtpCapabilities);
  }

  async createTransport(input: {
    session: GroupMediaSession;
    participantId: string;
    direction: SfuTransportDirection;
  }): Promise<SfuTransportOptions> {
    const room = await this.ensureRoom(input.session);
    const participant = this.ensureParticipant(
      room,
      input.participantId
    );

    const existing =
      input.direction === "send"
        ? participant.sendTransport
        : participant.recvTransport;

    if (existing) {
      existing.close();
      if (input.direction === "send") {
        participant.sendTransport = undefined;
        this.clearParticipantProducers(
          room,
          input.participantId
        );
      } else {
        participant.recvTransport = undefined;
        this.clearParticipantConsumers(participant);
      }
    }

    const transport = await room.router.createWebRtcTransport({
      webRtcServer: this.webRtcServer,
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
      initialAvailableOutgoingBitrate: 800_000,
      appData: {
        roomId: input.session.roomId,
        mediaSessionId: input.session.mediaSessionId,
        generation: input.session.generation,
        participantId: input.participantId,
        direction: input.direction
      }
    });

    transport.on("dtlsstatechange", (state) => {
      if (state === "closed") transport.close();
    });

    transport.on("routerclose", () => {
      if (input.direction === "send") {
        participant.sendTransport = undefined;
      } else {
        participant.recvTransport = undefined;
      }
    });

    if (input.direction === "send") {
      participant.sendTransport = transport;
    } else {
      participant.recvTransport = transport;
    }

    return {
      id: transport.id,
      iceParameters: asJsonObject(transport.iceParameters),
      iceCandidates: transport.iceCandidates.map((candidate) =>
        asJsonObject(candidate)
      ),
      dtlsParameters: asJsonObject(transport.dtlsParameters),
      sctpParameters: transport.sctpParameters
        ? asJsonObject(transport.sctpParameters)
        : undefined
    };
  }

  async connectTransport(input: {
    roomId: string;
    participantId: string;
    transportId: string;
    dtlsParameters: JsonObject;
  }) {
    const transport = this.transport(
      input.roomId,
      input.participantId,
      input.transportId
    );

    await transport.connect({
      dtlsParameters: input.dtlsParameters as unknown as DtlsParameters
    });
  }

  async produce(input: {
    session: GroupMediaSession;
    participantId: string;
    transportId: string;
    sourceId: string;
    kind: "audio";
    rtpParameters: JsonObject;
    appData?: JsonObject;
  }) {
    const room = await this.ensureRoom(input.session);
    const participant = this.ensureParticipant(
      room,
      input.participantId
    );
    const transport = participant.sendTransport;

    if (!transport || transport.id !== input.transportId) {
      throw new Error("SFU_TRANSPORT_NOT_FOUND");
    }

    const old = room.sourceProducers.get(input.sourceId);
    if (old) {
      old.producer.close();
      room.sourceProducers.delete(input.sourceId);
      old &&
        this.removeProducerFromParticipant(
          room,
          old.ownerParticipantId,
          input.sourceId
        );
    }

    const producer = await transport.produce({
      kind: input.kind,
      rtpParameters:
        input.rtpParameters as unknown as RtpParameters,
      appData: {
        ...(input.appData ?? {}),
        roomId: input.session.roomId,
        mediaSessionId: input.session.mediaSessionId,
        generation: input.session.generation,
        participantId: input.participantId,
        sourceId: input.sourceId
      }
    });

    participant.producers.set(input.sourceId, producer);
    room.sourceProducers.set(input.sourceId, {
      ownerParticipantId: input.participantId,
      producer
    });

    producer.on("transportclose", () => {
      participant.producers.delete(input.sourceId);
      const current = room.sourceProducers.get(input.sourceId);
      if (current?.producer === producer) {
        room.sourceProducers.delete(input.sourceId);
      }
    });

    producer.observer.on("close", () => {
      participant.producers.delete(input.sourceId);
      const current = room.sourceProducers.get(input.sourceId);
      if (current?.producer === producer) {
        room.sourceProducers.delete(input.sourceId);
      }
    });

    return producer.id;
  }

  async ensureDirectAudioProducer(input: {
    session: GroupMediaSession;
    ownerParticipantId: string;
    sourceId: string;
  }) {
    const room = await this.ensureRoom(input.session);
    const existing = room.sourceProducers.get(input.sourceId);
    if (existing && !existing.producer.closed) {
      return existing.producer.id;
    }

    if (!room.directTransport || room.directTransport.closed) {
      room.directTransport = await room.router.createDirectTransport({
        appData: {
          roomId: input.session.roomId,
          mediaSessionId: input.session.mediaSessionId,
          generation: input.session.generation,
          purpose: "server-local-audio"
        }
      });
    }

    const ssrc = randomInt(1, 0x100000000);
    const producer = await room.directTransport.produce({
      kind: "audio",
      rtpParameters: {
        codecs: [
          {
            mimeType: "audio/PCMU",
            payloadType: 0,
            clockRate: 8000,
            channels: 1,
            parameters: {},
            rtcpFeedback: []
          }
        ],
        encodings: [{ ssrc }]
      },
      appData: {
        roomId: input.session.roomId,
        mediaSessionId: input.session.mediaSessionId,
        generation: input.session.generation,
        participantId: input.ownerParticipantId,
        sourceId: input.sourceId,
        sourceTransport: "direct-pcmu"
      }
    });

    room.sourceProducers.set(input.sourceId, {
      ownerParticipantId: input.ownerParticipantId,
      producer
    });
    room.directAudio.set(input.sourceId, {
      sequence: randomInt(0, 0x10000),
      timestamp: randomInt(0, 0x100000000) >>> 0,
      ssrc,
      queue: Promise.resolve()
    });

    producer.observer.on("close", () => {
      const current = room.sourceProducers.get(input.sourceId);
      if (current?.producer === producer) {
        room.sourceProducers.delete(input.sourceId);
      }
      room.directAudio.delete(input.sourceId);
    });

    return producer.id;
  }

  async injectDirectPcm16(input: {
    session: GroupMediaSession;
    ownerParticipantId: string;
    sourceId: string;
    audio: Pcm16Audio;
  }) {
    await this.ensureDirectAudioProducer(input);
    const room = this.rooms.get(input.session.roomId);
    const current = room?.sourceProducers.get(input.sourceId);
    const state = room?.directAudio.get(input.sourceId);

    if (!room || !current || !state || current.producer.closed) {
      throw new Error("SFU_SOURCE_NOT_READY");
    }

    const pcm8k = resamplePcm16(input.audio, 8000);
    const pcmu = pcm16ToPcmu(pcm8k);
    const frameSamples = 160;

    const send = async () => {
      if (state.lastSentAt) {
        const elapsedMs = Math.max(0, Date.now() - state.lastSentAt);
        state.timestamp =
          (state.timestamp + Math.round(elapsedMs * 8)) >>> 0;
      }

      for (let offset = 0; offset < pcmu.length; offset += frameSamples) {
        if (current.producer.closed) {
          throw new Error("SFU_SOURCE_NOT_READY");
        }

        const payload = pcmu.subarray(
          offset,
          Math.min(pcmu.length, offset + frameSamples)
        );
        const packet = buildPcmuRtpPacket({
          payload,
          sequence: state.sequence,
          timestamp: state.timestamp,
          ssrc: state.ssrc,
          marker: offset === 0,
          payloadType: 0
        });

        current.producer.send(packet);
        state.sequence = (state.sequence + 1) & 0xffff;
        state.timestamp =
          (state.timestamp + payload.length) >>> 0;
        state.lastSentAt = Date.now();

        if (offset + frameSamples < pcmu.length) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
      }
    };

    state.queue = state.queue.then(send, send);
    await state.queue;

    return {
      producerId: current.producer.id,
      samplesSent: pcm8k.length,
      durationMs: Math.round((pcm8k.length / 8000) * 1000)
    };
  }

  async consume(input: {
    session: GroupMediaSession;
    participantId: string;
    transportId: string;
    sourceId: string;
    rtpCapabilities: JsonObject;
  }) {
    const room = await this.ensureRoom(input.session);
    const participant = this.ensureParticipant(
      room,
      input.participantId
    );
    const transport = participant.recvTransport;

    if (!transport || transport.id !== input.transportId) {
      throw new Error("SFU_TRANSPORT_NOT_FOUND");
    }

    const source = room.sourceProducers.get(input.sourceId);
    if (!source) {
      throw new Error("SFU_SOURCE_NOT_READY");
    }

    const rtpCapabilities =
      input.rtpCapabilities as unknown as RtpCapabilities;

    if (
      !room.router.canConsume({
        producerId: source.producer.id,
        rtpCapabilities
      })
    ) {
      throw new Error("SFU_CANNOT_CONSUME");
    }

    const old = participant.consumers.get(input.sourceId);
    if (old) {
      old.close();
      participant.consumers.delete(input.sourceId);
    }

    const consumer = await transport.consume({
      producerId: source.producer.id,
      rtpCapabilities,
      paused: true,
      appData: {
        roomId: input.session.roomId,
        mediaSessionId: input.session.mediaSessionId,
        generation: input.session.generation,
        participantId: input.participantId,
        sourceId: input.sourceId,
        ownerParticipantId: source.ownerParticipantId
      }
    });

    participant.consumers.set(input.sourceId, consumer);

    consumer.on("transportclose", () => {
      participant.consumers.delete(input.sourceId);
    });

    consumer.on("producerclose", () => {
      participant.consumers.delete(input.sourceId);
    });

    consumer.observer.on("close", () => {
      participant.consumers.delete(input.sourceId);
    });

    return {
      consumerId: consumer.id,
      producerId: source.producer.id,
      kind: consumer.kind,
      rtpParameters: asJsonObject(consumer.rtpParameters),
      producerPaused: source.producer.paused
    };
  }

  async resumeConsumer(input: {
    roomId: string;
    participantId: string;
    consumerId: string;
  }) {
    const room = this.rooms.get(input.roomId);
    const participant = room?.participants.get(
      input.participantId
    );

    const consumer = [...(participant?.consumers.values() ?? [])]
      .find((candidate) => candidate.id === input.consumerId);

    if (!consumer) {
      throw new Error("SFU_SOURCE_NOT_READY");
    }

    await consumer.resume();
  }

  reconcile(session: GroupMediaSession | undefined) {
    if (!session) return;

    const room = this.rooms.get(session.roomId);
    if (!room) return;

    if (
      room.mediaSessionId !== session.mediaSessionId ||
      room.generation !== session.generation
    ) {
      this.closeRoom(session.roomId);
      return;
    }

    const participants = new Set(
      session.participants.map(
        (participant) => participant.participantId
      )
    );

    for (const participantId of [...room.participants.keys()]) {
      if (!participants.has(participantId)) {
        this.closeParticipant(session.roomId, participantId);
      }
    }

    const sources = new Map(
      session.sources.map((source) => [source.sourceId, source])
    );

    for (const [
      sourceId,
      current
    ] of [...room.sourceProducers.entries()]) {
      const source = sources.get(sourceId);
      if (
        !source ||
        source.ownerParticipantId !==
          current.ownerParticipantId
      ) {
        current.producer.close();
        room.sourceProducers.delete(sourceId);
        room.directAudio.delete(sourceId);
        this.removeProducerFromParticipant(
          room,
          current.ownerParticipantId,
          sourceId
        );
      }
    }

    const allowed = new Set(
      session.subscriptions.map(
        (subscription) =>
          `${subscription.subscriberParticipantId}::${subscription.sourceId}`
      )
    );

    for (const [
      participantId,
      participant
    ] of room.participants.entries()) {
      for (const [
        sourceId,
        consumer
      ] of [...participant.consumers.entries()]) {
        if (!allowed.has(`${participantId}::${sourceId}`)) {
          consumer.close();
          participant.consumers.delete(sourceId);
        }
      }
    }
  }

  closeParticipant(roomId: string, participantId: string) {
    const room = this.rooms.get(roomId);
    const participant = room?.participants.get(participantId);
    if (!room || !participant) return;

    for (const [sourceId, producer] of participant.producers) {
      producer.close();
      const current = room.sourceProducers.get(sourceId);
      if (current?.producer === producer) {
        room.sourceProducers.delete(sourceId);
      }
    }
    participant.producers.clear();

    this.clearParticipantConsumers(participant);
    participant.sendTransport?.close();
    participant.recvTransport?.close();
    participant.sendTransport = undefined;
    participant.recvTransport = undefined;

    room.participants.delete(participantId);
  }

  closeRoom(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    room.router.close();
    this.rooms.delete(roomId);
  }

  close() {
    for (const roomId of [...this.rooms.keys()]) {
      this.closeRoom(roomId);
    }
    this.webRtcServer.close();
    this.worker.close();
  }

  private async ensureRoom(session: GroupMediaSession) {
    const existing = this.rooms.get(session.roomId);

    if (
      existing &&
      existing.mediaSessionId === session.mediaSessionId &&
      existing.generation === session.generation
    ) {
      return existing;
    }

    if (existing) {
      this.closeRoom(session.roomId);
    }

    const router = await this.worker.createRouter({
      mediaCodecs: AUDIO_CODECS,
      appData: {
        roomId: session.roomId,
        mediaSessionId: session.mediaSessionId,
        generation: session.generation
      }
    });

    const room: RoomSfuState = {
      mediaSessionId: session.mediaSessionId,
      generation: session.generation,
      router,
      directAudio: new Map(),
      participants: new Map(),
      sourceProducers: new Map()
    };

    router.observer.on("close", () => {
      const current = this.rooms.get(session.roomId);
      if (current?.router === router) {
        this.rooms.delete(session.roomId);
      }
    });

    this.rooms.set(session.roomId, room);
    return room;
  }

  private ensureParticipant(
    room: RoomSfuState,
    participantId: string
  ) {
    let participant = room.participants.get(participantId);
    if (!participant) {
      participant = participantState();
      room.participants.set(participantId, participant);
    }
    return participant;
  }

  private transport(
    roomId: string,
    participantId: string,
    transportId: string
  ) {
    const participant = this.rooms
      .get(roomId)
      ?.participants.get(participantId);

    const transport =
      participant?.sendTransport?.id === transportId
        ? participant.sendTransport
        : participant?.recvTransport?.id === transportId
          ? participant.recvTransport
          : undefined;

    if (!transport) {
      throw new Error("SFU_TRANSPORT_NOT_FOUND");
    }

    return transport;
  }

  private clearParticipantProducers(
    room: RoomSfuState,
    participantId: string
  ) {
    const participant = room.participants.get(participantId);
    if (!participant) return;

    for (const [sourceId, producer] of participant.producers) {
      producer.close();
      const current = room.sourceProducers.get(sourceId);
      if (current?.producer === producer) {
        room.sourceProducers.delete(sourceId);
      }
    }
    participant.producers.clear();
  }

  private clearParticipantConsumers(
    participant: ParticipantSfuState
  ) {
    for (const consumer of participant.consumers.values()) {
      consumer.close();
    }
    participant.consumers.clear();
  }

  private removeProducerFromParticipant(
    room: RoomSfuState,
    participantId: string,
    sourceId: string
  ) {
    room.participants
      .get(participantId)
      ?.producers.delete(sourceId);
  }
}
