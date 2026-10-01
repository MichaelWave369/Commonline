import { describe, expect, it, vi } from "vitest";
import { ConversationExchangeRegistry } from "./conversationExchangeRegistry";

describe("P0-q conversation exchange registry", () => {
  it("binds one heard transcript to one response claim", () => {
    const registry = new ConversationExchangeRegistry();
    const exchange = registry.create({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      listeningShareId: "share-1",
      transcript: "hello vessie"
    });

    const claim = registry.claimResponse({
      roomId: "room",
      exchangeId: exchange.exchangeId,
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });

    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(claim.transcript).toBe("hello vessie");

    expect(
      registry.claimResponse({
        roomId: "room",
        exchangeId: exchange.exchangeId,
        humanParticipantId: "alice",
        agentParticipantId: "agent-vessie"
      })
    ).toMatchObject({ ok: false, code: "EXCHANGE_BUSY" });

    expect(
      registry.completeResponse(exchange.exchangeId)?.state
    ).toBe("responded");

    expect(
      registry.claimResponse({
        roomId: "room",
        exchangeId: exchange.exchangeId,
        humanParticipantId: "alice",
        agentParticipantId: "agent-vessie"
      })
    ).toMatchObject({
      ok: false,
      code: "EXCHANGE_ALREADY_RESPONDED"
    });
  });

  it("allows retry after a failed response attempt but still requires new attention elsewhere", () => {
    const registry = new ConversationExchangeRegistry();
    const exchange = registry.create({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      listeningShareId: "share-1",
      transcript: "retry me"
    });

    expect(
      registry.claimResponse({
        roomId: "room",
        exchangeId: exchange.exchangeId,
        humanParticipantId: "alice",
        agentParticipantId: "agent-vessie"
      }).ok
    ).toBe(true);

    registry.releaseResponse(exchange.exchangeId);

    expect(
      registry.claimResponse({
        roomId: "room",
        exchangeId: exchange.exchangeId,
        humanParticipantId: "alice",
        agentParticipantId: "agent-vessie"
      }).ok
    ).toBe(true);
  });

  it("prevents another human from claiming the exchange", () => {
    const registry = new ConversationExchangeRegistry();
    const exchange = registry.create({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      listeningShareId: "share-1",
      transcript: "private selected context"
    });

    const result = registry.claimResponse({
      roomId: "room",
      exchangeId: exchange.exchangeId,
      humanParticipantId: "bob",
      agentParticipantId: "agent-vessie"
    });

    expect(result).toMatchObject({
      ok: false,
      code: "EXCHANGE_NOT_OWNED"
    });
  });

  it("expires old exchanges and supersedes prior unheard reply opportunities", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T19:00:00Z"));

    const registry = new ConversationExchangeRegistry();
    const first = registry.create({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      listeningShareId: "share-1",
      transcript: "first",
      ttlMs: 15_000
    });
    const second = registry.create({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      listeningShareId: "share-2",
      transcript: "second",
      ttlMs: 15_000
    });

    expect(registry.get(first.exchangeId)?.state).toBe("expired");
    expect(registry.get(second.exchangeId)?.state).toBe("heard");

    vi.advanceTimersByTime(15_001);
    expect(registry.get(second.exchangeId)?.state).toBe("expired");

    vi.useRealTimers();
  });
  it("does not expire or supersede an exchange while its authorized reply is in flight", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T19:00:00Z"));

    const registry = new ConversationExchangeRegistry();
    const first = registry.create({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      listeningShareId: "share-1",
      transcript: "first",
      ttlMs: 15_000
    });

    const claimed = registry.claimResponse({
      roomId: "room",
      exchangeId: first.exchangeId,
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie"
    });
    expect(claimed.ok).toBe(true);

    vi.advanceTimersByTime(20_000);

    const second = registry.create({
      roomId: "room",
      humanParticipantId: "alice",
      agentParticipantId: "agent-vessie",
      listeningShareId: "share-2",
      transcript: "second"
    });

    expect(registry.get(first.exchangeId)?.state).toBe("heard");
    expect(registry.get(second.exchangeId)?.state).toBe("heard");
    expect(
      registry.completeResponse(first.exchangeId)?.state
    ).toBe("responded");

    vi.useRealTimers();
  });


});
