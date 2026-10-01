import { describe, expect, it, vi } from "vitest";
import { ListeningShareRegistry } from "./listeningShareRegistry";

describe("P0-p listening share leases", () => {
  it("consumes a bounded share exactly once", () => {
    const registry = new ListeningShareRegistry();
    const lease = registry.grant({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });

    const first = registry.consume({
      roomId: "room",
      leaseId: lease.leaseId,
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.lease.state).toBe("consumed");

    const second = registry.consume({
      roomId: "room",
      leaseId: lease.leaseId,
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("LISTENING_LEASE_CONSUMED");
    }
  });

  it("does not let another human spend or revoke the lease", () => {
    const registry = new ListeningShareRegistry();
    const lease = registry.grant({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });

    const spent = registry.consume({
      roomId: "room",
      leaseId: lease.leaseId,
      humanParticipantId: "bob",
      agentParticipantId: "agent-vessie"
    });
    expect(spent.ok).toBe(false);
    if (!spent.ok) {
      expect(spent.code).toBe("LISTENING_LEASE_NOT_OWNED");
    }

    const revoked = registry.revoke({
      roomId: "room",
      leaseId: lease.leaseId,
      humanParticipantId: "bob"
    });
    expect(revoked.ok).toBe(false);
    if (!revoked.ok) {
      expect(revoked.code).toBe("LISTENING_LEASE_NOT_OWNED");
    }
  });

  it("expires and supersedes active shares", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T18:00:00Z"));

    const registry = new ListeningShareRegistry();
    const first = registry.grant({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      ttlMs: 10_000
    });
    const second = registry.grant({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      ttlMs: 10_000
    });

    expect(registry.get(first.leaseId)?.state).toBe("revoked");
    expect(registry.get(second.leaseId)?.state).toBe("active");

    vi.advanceTimersByTime(10_001);
    expect(registry.get(second.leaseId)?.state).toBe("expired");

    vi.useRealTimers();
  });
});
