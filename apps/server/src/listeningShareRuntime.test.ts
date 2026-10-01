import { describe, expect, it } from "vitest";
import { MockSilentAgent } from "@commonline/agent-runtime";
import {
  createRoom,
  joinParticipant,
  SILENT_AGENT_PARTICIPANT_ID
} from "@commonline/room-core";
import { GroupMediaRegistry } from "./groupMediaRegistry";
import { DeterministicSpeechRecognizer } from "./localSpeechRecognizer";
import { ListeningShareRegistry } from "./listeningShareRegistry";
import { ListeningShareRuntime } from "./listeningShareRuntime";
import { InMemoryRoomStore } from "./roomStore";
import { RoomService } from "./roomService";

function pcmBase64(sampleCount: number) {
  const bytes = Buffer.alloc(sampleCount * 2);
  for (let index = 0; index < sampleCount; index += 1) {
    bytes.writeInt16LE((index % 64) * 250 - 8000, index * 2);
  }
  return bytes.toString("base64");
}

describe("P0-p listening share runtime", () => {
  it("delivers one explicitly shared clip to Vessie as ephemeral selected context", async () => {
    const store = new InMemoryRoomStore();
    const service = new RoomService("listen proof", store);
    service.join({
      roomId: "room",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const group = new GroupMediaRegistry();
    group.join({ roomId: "room", participantId: "alice" });

    const leases = new ListeningShareRegistry();
    const lease = leases.grant({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: SILENT_AGENT_PARTICIPANT_ID
    });

    const runtime = new ListeningShareRuntime(
      service,
      group,
      leases,
      new DeterministicSpeechRecognizer(),
      new MockSilentAgent("Vessie")
    );

    const states: string[] = [];
    const result = await runtime.submit({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: SILENT_AGENT_PARTICIPANT_ID,
      leaseId: lease.leaseId,
      shareId: "share-1",
      sampleRate: 16000,
      sampleCount: 3200,
      pcm16Base64: pcmBase64(3200),
      onState: (state) => states.push(state)
    });

    expect(result.transcript).toContain("3200 PCM16 samples");
    expect(result.observedWordCount).toBeGreaterThan(0);
    expect(states).toEqual(["received", "transcribing", "delivered"]);
    expect(leases.get(lease.leaseId)?.state).toBe("consumed");
  });

  it("refuses replay of a consumed listening share lease", async () => {
    const store = new InMemoryRoomStore();
    const service = new RoomService("listen proof", store);
    service.join({
      roomId: "room",
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant",
      acknowledgedVersion: 0
    });

    const group = new GroupMediaRegistry();
    group.join({ roomId: "room", participantId: "alice" });
    const leases = new ListeningShareRegistry();
    const lease = leases.grant({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: SILENT_AGENT_PARTICIPANT_ID
    });

    const runtime = new ListeningShareRuntime(
      service,
      group,
      leases,
      new DeterministicSpeechRecognizer(),
      new MockSilentAgent("Vessie")
    );

    const input = {
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: SILENT_AGENT_PARTICIPANT_ID,
      leaseId: lease.leaseId,
      shareId: "share",
      sampleRate: 16000,
      sampleCount: 3200,
      pcm16Base64: pcmBase64(3200)
    };

    await runtime.submit(input);

    await expect(
      runtime.submit({ ...input, shareId: "share-replay" })
    ).rejects.toThrow("LISTENING_LEASE_CONSUMED");
  });
});
