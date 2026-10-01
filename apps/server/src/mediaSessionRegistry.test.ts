import { describe, expect, it } from "vitest";
import {
  isPolitePeer,
  MediaSessionRegistry
} from "./mediaSessionRegistry";

describe("P0-h media session registry", () => {
  it("coalesces simultaneous opens for the same participant pair", () => {
    const registry = new MediaSessionRegistry();

    const first = registry.open({
      roomId: "room",
      initiatorParticipantId: "alice",
      targetParticipantId: "bob"
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = registry.open({
      roomId: "room",
      initiatorParticipantId: "bob",
      targetParticipantId: "alice"
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    expect(second.coalesced).toBe(true);
    expect(second.session.callId).toBe(first.session.callId);
    expect(second.session.generation).toBe(first.session.generation);
  });

  it("allows only one active media session per participant", () => {
    const registry = new MediaSessionRegistry();

    expect(
      registry.open({
        roomId: "room",
        initiatorParticipantId: "alice",
        targetParticipantId: "bob"
      }).ok
    ).toBe(true);

    const busy = registry.open({
      roomId: "room",
      initiatorParticipantId: "alice",
      targetParticipantId: "charlie"
    });

    expect(busy.ok).toBe(false);
    if (!busy.ok) expect(busy.code).toBe("MEDIA_BUSY");
  });

  it("rejects stale signaling and increments generation after hangup", () => {
    const registry = new MediaSessionRegistry();

    const first = registry.open({
      roomId: "room",
      initiatorParticipantId: "alice",
      targetParticipantId: "bob"
    });
    if (!first.ok) throw new Error(first.message);

    expect(
      registry.validate({
        roomId: "room",
        callId: first.session.callId,
        generation: first.session.generation,
        actorParticipantId: "alice",
        targetParticipantId: "bob"
      }).ok
    ).toBe(true);

    registry.end({
      roomId: "room",
      callId: first.session.callId,
      generation: first.session.generation
    });

    const stale = registry.validate({
      roomId: "room",
      callId: first.session.callId,
      generation: first.session.generation,
      actorParticipantId: "alice",
      targetParticipantId: "bob"
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.code).toBe("MEDIA_SESSION_STALE");

    const second = registry.open({
      roomId: "room",
      initiatorParticipantId: "alice",
      targetParticipantId: "bob"
    });
    if (!second.ok) throw new Error(second.message);

    expect(second.session.callId).not.toBe(first.session.callId);
    expect(second.session.generation).toBe(
      first.session.generation + 1
    );
  });

  it("ends the exact call when either participant leaves", () => {
    const registry = new MediaSessionRegistry();
    const opened = registry.open({
      roomId: "room",
      initiatorParticipantId: "alice",
      targetParticipantId: "bob"
    });
    if (!opened.ok) throw new Error(opened.message);

    const ended = registry.endForParticipant("room", "alice");
    expect(ended).toHaveLength(1);
    expect(ended[0]?.callId).toBe(opened.session.callId);
    expect(registry.currentForParticipant("room", "bob")).toBeUndefined();
  });

  it("chooses exactly one polite peer deterministically", () => {
    expect(isPolitePeer("alice", "bob")).not.toBe(
      isPolitePeer("bob", "alice")
    );
  });
});
