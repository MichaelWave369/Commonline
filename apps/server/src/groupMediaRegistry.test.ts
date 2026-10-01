import { describe, expect, it } from "vitest";
import { GroupMediaRegistry } from "./groupMediaRegistry";

describe("P0-i group media registry", () => {
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

    expect(registry.current("room")?.participants).toHaveLength(3);
  });

  it("publishes one microphone source per participant idempotently", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });

    const first = registry.publishMicrophone({
      roomId: "room",
      participantId: "alice"
    });
    const second = registry.publishMicrophone({
      roomId: "room",
      participantId: "alice"
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.session.sources).toHaveLength(1);
    expect(second.session.sources).toHaveLength(1);
    expect(second.changed).toBe(false);
  });

  it("requires an explicit directed subscription before pair signaling", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });
    registry.join({ roomId: "room", participantId: "bob" });

    const published = registry.publishMicrophone({
      roomId: "room",
      participantId: "bob"
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
    if (!before.ok) {
      expect(before.code).toBe("MEDIA_SUBSCRIPTION_INVALID");
    }

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

  it("removes owned sources and dependent subscriptions on leave", () => {
    const registry = new GroupMediaRegistry();
    registry.join({ roomId: "room", participantId: "alice" });
    registry.join({ roomId: "room", participantId: "bob" });

    const published = registry.publishMicrophone({
      roomId: "room",
      participantId: "bob"
    });
    if (!published.ok) throw new Error(published.message);
    const sourceId = published.session.sources[0]!.sourceId;

    registry.subscribe({
      roomId: "room",
      participantId: "alice",
      sourceId
    });

    const remaining = registry.leave({
      roomId: "room",
      participantId: "bob"
    });

    expect(remaining?.sources).toHaveLength(0);
    expect(remaining?.subscriptions).toHaveLength(0);
    expect(remaining?.participants.map((item) => item.participantId)).toEqual([
      "alice"
    ]);
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
});
