import { describe, expect, it } from "vitest";
import { SessionRegistry } from "./sessionRegistry";

describe("SessionRegistry", () => {
  it("coalesces reconnects onto one logical participant", () => {
    const registry = new SessionRegistry<object>();
    const oldConnection = {};
    const newConnection = {};

    expect(
      registry.bind("room", {
        participantId: "human-mikey",
        sessionId: "session-a",
        connection: oldConnection
      })
    ).toBeUndefined();

    const prior = registry.bind("room", {
      participantId: "human-mikey",
      sessionId: "session-b",
      connection: newConnection
    });

    expect(prior?.connection).toBe(oldConnection);
    expect(registry.current("room", "human-mikey")?.connection).toBe(newConnection);

    expect(
      registry.unbindIfCurrent("room", "human-mikey", oldConnection)
    ).toBe(false);
    expect(registry.current("room", "human-mikey")?.connection).toBe(newConnection);

    expect(
      registry.unbindIfCurrent("room", "human-mikey", newConnection)
    ).toBe(true);
    expect(registry.current("room", "human-mikey")).toBeUndefined();
  });
});
