import { describe, expect, it, vi } from "vitest";
import { AttentionLeaseRegistry } from "./attentionLeaseRegistry";

describe("P0-o attention leases", () => {
  it("consumes a one-turn lease exactly once", () => {
    const registry = new AttentionLeaseRegistry();
    const lease = registry.grant({
      roomId: "room",
      agentParticipantId: "agent-vessie",
      grantedByParticipantId: "alice"
    });

    const first = registry.consume({
      roomId: "room",
      leaseId: lease.leaseId,
      actorParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.lease.state).toBe("consumed");
    expect(first.lease.turnsConsumed).toBe(1);

    const second = registry.consume({
      roomId: "room",
      leaseId: lease.leaseId,
      actorParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.code).toBe("ATTENTION_LEASE_CONSUMED");
    }
  });

  it("does not let another human spend or revoke someone else's lease", () => {
    const registry = new AttentionLeaseRegistry();
    const lease = registry.grant({
      roomId: "room",
      agentParticipantId: "agent-vessie",
      grantedByParticipantId: "alice"
    });

    const consume = registry.consume({
      roomId: "room",
      leaseId: lease.leaseId,
      actorParticipantId: "bob",
      agentParticipantId: "agent-vessie"
    });
    expect(consume.ok).toBe(false);
    if (!consume.ok) {
      expect(consume.code).toBe("ATTENTION_LEASE_NOT_OWNED");
    }

    const revoke = registry.revoke({
      roomId: "room",
      leaseId: lease.leaseId,
      actorParticipantId: "bob"
    });
    expect(revoke.ok).toBe(false);
    if (!revoke.ok) {
      expect(revoke.code).toBe("ATTENTION_LEASE_NOT_OWNED");
    }
  });

  it("expires leases without making them durable", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T17:00:00Z"));

    const registry = new AttentionLeaseRegistry();
    const lease = registry.grant({
      roomId: "room",
      agentParticipantId: "agent-vessie",
      grantedByParticipantId: "alice",
      ttlMs: 10_000
    });

    vi.advanceTimersByTime(10_001);

    const consumed = registry.consume({
      roomId: "room",
      leaseId: lease.leaseId,
      actorParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });
    expect(consumed.ok).toBe(false);
    if (!consumed.ok) {
      expect(consumed.code).toBe("ATTENTION_LEASE_EXPIRED");
    }

    vi.useRealTimers();
  });

  it("supersedes an older active lease for the same human and agent", () => {
    const registry = new AttentionLeaseRegistry();
    const first = registry.grant({
      roomId: "room",
      agentParticipantId: "agent-vessie",
      grantedByParticipantId: "alice"
    });
    const second = registry.grant({
      roomId: "room",
      agentParticipantId: "agent-vessie",
      grantedByParticipantId: "alice"
    });

    expect(registry.get(first.leaseId)?.state).toBe("revoked");
    expect(registry.get(second.leaseId)?.state).toBe("active");
  });
});
