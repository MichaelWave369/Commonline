import { describe, expect, it } from "vitest";
import { GroupMediaRegistry } from "./groupMediaRegistry";
import { mediaSourcePolicy } from "./mediaSourcePolicy";

function policy(kind: "human-microphone" | "sound-effect") {
  const resolved = mediaSourcePolicy(kind);
  if (!resolved) throw new Error("missing source policy");
  return resolved;
}

describe("P0-n group media registry", () => {
  it("admits at most three humans", () => {
    const registry = new GroupMediaRegistry();

    for (const participantId of ["alice", "bob", "charlie"]) {
      const joined = registry.join({
        roomId: "room",
        participantId
      });
      expect(joined.ok).toBe(true);
    }

    const fourth = registry.join({
      roomId: "room",
      participantId: "dana"
    });
    expect(fourth.ok).toBe(false);
    if (!fourth.ok) expect(fourth.code).toBe("GROUP_MEDIA_FULL");
  });

  it("publishes one source per kind idempotently while allowing distinct kinds", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });

    const mic = registry.publishSource({
      roomId: "room",
      participantId: "alice",
      kind: "human-microphone",
      label: "Alice mic",
      policy: policy("human-microphone")
    });
    const micAgain = registry.publishSource({
      roomId: "room",
      participantId: "alice",
      kind: "human-microphone",
      label: "ignored duplicate",
      policy: policy("human-microphone")
    });
    const effect = registry.publishSource({
      roomId: "room",
      participantId: "alice",
      kind: "sound-effect",
      label: "Governed cue",
      policy: policy("sound-effect")
    });

    expect(mic.ok).toBe(true);
    expect(micAgain.ok).toBe(true);
    expect(effect.ok).toBe(true);
    if (!mic.ok || !micAgain.ok || !effect.ok) return;

    expect(micAgain.changed).toBe(false);
    expect(effect.session.sources).toHaveLength(2);
    expect(effect.session.sources.map((source) => source.kind)).toEqual([
      "human-microphone",
      "sound-effect"
    ]);
  });

  it("exposes the source policy catalog in group state", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });

    const state = registry.stateMessage({
      requestId: "state",
      roomId: "room"
    });

    expect(
      state?.sourcePolicies.find(
        (item) => item.kind === "sound-effect"
      )?.executionState
    ).toBe("executable");
    expect(
      state?.sourcePolicies.find(
        (item) => item.kind === "agent-voice"
      )?.executionState
    ).toBe("executable");
  });

  it("requires an explicit directed subscription before pair signaling", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });
    registry.join({ roomId: "room", participantId: "bob" });

    const published = registry.publishSource({
      roomId: "room",
      participantId: "bob",
      kind: "human-microphone",
      label: "Bob mic",
      policy: policy("human-microphone")
    });
    if (!published.ok) throw new Error(published.message);
    const source = published.session.sources[0]!;

    const before = registry.validateSignal({
      roomId: "room",
      mediaSessionId: published.session.mediaSessionId,
      generation: published.session.generation,
      actorParticipantId: "alice",
      targetParticipantId: "bob"
    });
    expect(before.ok).toBe(false);

    const subscribed = registry.subscribe({
      roomId: "room",
      participantId: "alice",
      sourceId: source.sourceId
    });
    expect(subscribed.ok).toBe(true);
    if (!subscribed.ok) return;

    expect(
      registry.validateSignal({
        roomId: "room",
        mediaSessionId: subscribed.session.mediaSessionId,
        generation: subscribed.session.generation,
        actorParticipantId: "alice",
        targetParticipantId: "bob"
      }).ok
    ).toBe(true);
  });

  it("removes all owned source kinds and dependent subscriptions on leave", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });
    registry.join({ roomId: "room", participantId: "bob" });

    for (const kind of ["human-microphone", "sound-effect"] as const) {
      const published = registry.publishSource({
        roomId: "room",
        participantId: "bob",
        kind,
        label: kind,
        policy: policy(kind)
      });
      if (!published.ok) throw new Error(published.message);

      const source = published.session.sources.find(
        (candidate) => candidate.kind === kind
      )!;
      registry.subscribe({
        roomId: "room",
        participantId: "alice",
        sourceId: source.sourceId
      });
    }

    const remaining = registry.leave({
      roomId: "room",
      participantId: "bob"
    });

    expect(remaining?.sources).toHaveLength(0);
    expect(remaining?.subscriptions).toHaveLength(0);
  });

  it("starts a new generation only after the group becomes empty", () => {
    const registry = new GroupMediaRegistry();
    const first = registry.join({
      roomId: "room",
      participantId: "alice"
    });
    if (!first.ok) throw new Error(first.message);

    registry.leave({
      roomId: "room",
      participantId: "alice"
    });

    const second = registry.join({
      roomId: "room",
      participantId: "alice"
    });
    if (!second.ok) throw new Error(second.message);

    expect(second.session.mediaSessionId).not.toBe(
      first.session.mediaSessionId
    );
    expect(second.session.generation).toBe(
      first.session.generation + 1
    );
  });
  it("publishes and removes a trusted agent voice source without adding the agent as a human media participant", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });
    const agentPolicy = mediaSourcePolicy("agent-voice");
    if (!agentPolicy) throw new Error("missing agent voice policy");

    const published = registry.publishTrustedSource({
      roomId: "room",
      ownerParticipantId: "agent-vessie",
      kind: "agent-voice",
      label: "Vessie voice",
      policy: agentPolicy
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;

    expect(
      published.session.participants.some(
        (participant) => participant.participantId === "agent-vessie"
      )
    ).toBe(false);
    expect(
      published.session.sources.find(
        (source) => source.kind === "agent-voice"
      )?.ownerParticipantId
    ).toBe("agent-vessie");

    registry.subscribe({
      roomId: "room",
      participantId: "alice",
      sourceId: published.session.sources.find(
        (source) => source.kind === "agent-voice"
      )!.sourceId
    });

    const remaining = registry.unpublishTrustedSource({
      roomId: "room",
      ownerParticipantId: "agent-vessie",
      kind: "agent-voice"
    });
    expect(
      remaining?.sources.some((source) => source.kind === "agent-voice")
    ).toBe(false);
    expect(remaining?.subscriptions).toHaveLength(0);
  });

});
