import type { MockSilentAgent } from "@commonline/agent-runtime";
import type {
  ConversationExchange,
  ListeningShareStatus
} from "@commonline/protocol";
import { hasCapability } from "@commonline/room-core";
import type { ConversationExchangeRegistry } from "./conversationExchangeRegistry";
import type { GroupMediaRegistry } from "./groupMediaRegistry";
import type {
  LocalSpeechRecognizer,
  SpeechRecognitionResult
} from "./localSpeechRecognizer";
import type { ListeningShareRegistry } from "./listeningShareRegistry";
import type { RoomService } from "./roomService";

export interface ListeningShareRuntimeStatus {
  engine: string;
  ready: boolean;
  local: boolean;
  busyRooms: number;
  detail: string;
}

export interface ListeningShareRuntimeResult {
  transcript: string;
  engine: string;
  sampleCount: number;
  durationMs: number;
  observedWordCount: number;
  exchange: ConversationExchange;
}

function decodePcm16(input: {
  sampleRate: number;
  sampleCount: number;
  pcm16Base64: string;
}) {
  if (
    input.sampleRate !== 16000 ||
    !Number.isInteger(input.sampleCount) ||
    input.sampleCount < 1600 ||
    input.sampleCount > 80000 ||
    typeof input.pcm16Base64 !== "string" ||
    input.pcm16Base64.length < 4 ||
    input.pcm16Base64.length > 220000
  ) {
    throw new Error("LISTENING_AUDIO_INVALID");
  }

  const bytes = Buffer.from(input.pcm16Base64, "base64");
  if (bytes.length !== input.sampleCount * 2) {
    throw new Error("LISTENING_AUDIO_INVALID");
  }

  const samples = new Int16Array(input.sampleCount);
  for (let index = 0; index < input.sampleCount; index += 1) {
    samples[index] = bytes.readInt16LE(index * 2);
  }

  return samples;
}

export class ListeningShareRuntime {
  private readonly busy = new Set<string>();

  constructor(
    private readonly service: RoomService,
    private readonly groupMedia: GroupMediaRegistry,
    private readonly leases: ListeningShareRegistry,
    private readonly exchanges: ConversationExchangeRegistry,
    private readonly recognizer: LocalSpeechRecognizer,
    private readonly agent: MockSilentAgent
  ) {}

  status(): ListeningShareRuntimeStatus {
    const recognizer = this.recognizer.status();
    return {
      engine: recognizer.engine,
      ready: recognizer.ready,
      local: recognizer.local,
      busyRooms: this.busy.size,
      detail: recognizer.detail
    };
  }

  async submit(input: {
    roomId: string;
    humanParticipantId: string;
    agentParticipantId: string;
    leaseId: string;
    shareId: string;
    sampleRate: number;
    sampleCount: number;
    pcm16Base64: string;
    onState?: (
      state: ListeningShareStatus,
      errorCode?: string
    ) => void;
  }): Promise<ListeningShareRuntimeResult> {
    const room = this.service.getRoom(input.roomId);
    if (!room) throw new Error("ROOM_NOT_FOUND");

    const human = room.participants.find(
      (participant) =>
        participant.id === input.humanParticipantId &&
        participant.kind === "human"
    );
    const agentParticipant = room.participants.find(
      (participant) =>
        participant.id === input.agentParticipantId &&
        participant.kind === "agent"
    );
    if (!human || !agentParticipant) {
      throw new Error("NOT_AUTHORIZED");
    }

    if (
      !this.groupMedia.currentForParticipant(
        input.roomId,
        input.humanParticipantId
      )
    ) {
      throw new Error("VOICE_GROUP_MEDIA_REQUIRED");
    }

    if (
      !hasCapability(
        room,
        input.agentParticipantId,
        "READ_SELECTED_CONTEXT"
      )
    ) {
      throw new Error("NOT_AUTHORIZED");
    }

    if (!this.recognizer.status().ready) {
      throw new Error("STT_UNAVAILABLE");
    }

    const samples = decodePcm16(input);
    const busyKey =
      `${input.roomId}::${input.humanParticipantId}::${input.agentParticipantId}`;
    if (this.busy.has(busyKey)) {
      throw new Error("LISTENING_SHARE_BUSY");
    }

    const consumed = this.leases.consume({
      roomId: input.roomId,
      leaseId: input.leaseId,
      humanParticipantId: input.humanParticipantId,
      agentParticipantId: input.agentParticipantId
    });
    if (!consumed.ok) {
      throw new Error(consumed.code);
    }

    const maxSamples = Math.floor(
      (consumed.lease.maxDurationMs / 1000) * 16000
    );
    if (samples.length > maxSamples) {
      throw new Error("LISTENING_AUDIO_INVALID");
    }

    this.busy.add(busyKey);

    try {
      input.onState?.("received");
      input.onState?.("transcribing");

      let recognized: SpeechRecognitionResult;
      try {
        recognized = await this.recognizer.transcribe({
          sampleRate: 16000,
          samples
        });
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "STT_UNAVAILABLE"
        ) {
          throw error;
        }
        throw new Error("STT_FAILED");
      }

      const transcript = recognized.text.trim();
      if (!transcript || transcript.length > 4000) {
        throw new Error("STT_FAILED");
      }

      const observation =
        await this.agent.observeSharedTranscript(transcript);

      const exchange = this.exchanges.create({
        roomId: input.roomId,
        humanParticipantId: input.humanParticipantId,
        agentParticipantId: input.agentParticipantId,
        listeningShareId: input.shareId,
        transcript
      });

      input.onState?.("delivered");

      return {
        transcript,
        engine: recognized.engine,
        sampleCount: samples.length,
        durationMs: Math.round((samples.length / 16000) * 1000),
        observedWordCount: observation.wordCount,
        exchange
      };
    } catch (error) {
      input.onState?.(
        "failed",
        error instanceof Error ? error.message : "STT_FAILED"
      );
      throw error;
    } finally {
      this.busy.delete(busyKey);
    }
  }
}
