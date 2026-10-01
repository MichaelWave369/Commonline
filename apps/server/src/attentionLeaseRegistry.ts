import type {
  AttentionLease,
  AttentionLeaseState
} from "@commonline/protocol";

const DEFAULT_TTL_MS = 120_000;

type LeaseFailureCode =
  | "ATTENTION_LEASE_NOT_FOUND"
  | "ATTENTION_LEASE_NOT_OWNED"
  | "ATTENTION_LEASE_EXPIRED"
  | "ATTENTION_LEASE_CONSUMED"
  | "ATTENTION_LEASE_REVOKED";

export type AttentionLeaseConsumeResult =
  | { ok: true; lease: AttentionLease }
  | {
      ok: false;
      code: LeaseFailureCode;
      message: string;
      lease?: AttentionLease;
    };

function cloneLease(lease: AttentionLease): AttentionLease {
  return { ...lease };
}

export class AttentionLeaseRegistry {
  private readonly leases = new Map<string, AttentionLease>();

  grant(input: {
    roomId: string;
    agentParticipantId: string;
    grantedByParticipantId: string;
    ttlMs?: number;
  }) {
    this.expireDue();

    for (const lease of this.leases.values()) {
      if (
        lease.roomId === input.roomId &&
        lease.agentParticipantId === input.agentParticipantId &&
        lease.grantedByParticipantId === input.grantedByParticipantId &&
        lease.state === "active"
      ) {
        lease.state = "revoked";
      }
    }

    const issuedAt = new Date();
    const ttlMs = Math.min(
      300_000,
      Math.max(10_000, input.ttlMs ?? DEFAULT_TTL_MS)
    );
    const lease: AttentionLease = {
      leaseId: `attention-${crypto.randomUUID()}`,
      roomId: input.roomId,
      agentParticipantId: input.agentParticipantId,
      grantedByParticipantId: input.grantedByParticipantId,
      mode: "one-turn",
      state: "active",
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
      maxTurns: 1,
      turnsConsumed: 0
    };

    this.leases.set(lease.leaseId, lease);
    return cloneLease(lease);
  }

  revoke(input: {
    roomId: string;
    leaseId: string;
    actorParticipantId: string;
  }): AttentionLeaseConsumeResult {
    const lease = this.resolveState(input.leaseId);

    if (!lease || lease.roomId !== input.roomId) {
      return {
        ok: false,
        code: "ATTENTION_LEASE_NOT_FOUND",
        message: "The requested attention lease does not exist."
      };
    }

    if (lease.grantedByParticipantId !== input.actorParticipantId) {
      return {
        ok: false,
        code: "ATTENTION_LEASE_NOT_OWNED",
        message:
          "Only the participant who granted this attention lease may revoke it.",
        lease: cloneLease(lease)
      };
    }

    if (lease.state === "expired") {
      return {
        ok: false,
        code: "ATTENTION_LEASE_EXPIRED",
        message: "The attention lease has expired.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "consumed") {
      return {
        ok: false,
        code: "ATTENTION_LEASE_CONSUMED",
        message: "The attention lease has already been consumed.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "revoked") {
      return {
        ok: false,
        code: "ATTENTION_LEASE_REVOKED",
        message: "The attention lease has already been revoked.",
        lease: cloneLease(lease)
      };
    }

    lease.state = "revoked";
    return { ok: true, lease: cloneLease(lease) };
  }

  consume(input: {
    roomId: string;
    leaseId: string;
    actorParticipantId: string;
    agentParticipantId: string;
  }): AttentionLeaseConsumeResult {
    const lease = this.resolveState(input.leaseId);

    if (
      !lease ||
      lease.roomId !== input.roomId ||
      lease.agentParticipantId !== input.agentParticipantId
    ) {
      return {
        ok: false,
        code: "ATTENTION_LEASE_NOT_FOUND",
        message:
          "No matching attention lease exists for this room and agent."
      };
    }

    if (lease.grantedByParticipantId !== input.actorParticipantId) {
      return {
        ok: false,
        code: "ATTENTION_LEASE_NOT_OWNED",
        message:
          "The attention lease belongs to a different requesting participant.",
        lease: cloneLease(lease)
      };
    }

    if (lease.state === "expired") {
      return {
        ok: false,
        code: "ATTENTION_LEASE_EXPIRED",
        message: "The attention lease expired before the turn began.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "consumed") {
      return {
        ok: false,
        code: "ATTENTION_LEASE_CONSUMED",
        message:
          "This one-turn attention lease has already been consumed.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "revoked") {
      return {
        ok: false,
        code: "ATTENTION_LEASE_REVOKED",
        message: "The attention lease was revoked before use.",
        lease: cloneLease(lease)
      };
    }

    lease.turnsConsumed = 1;
    lease.state = "consumed";
    return { ok: true, lease: cloneLease(lease) };
  }

  get(leaseId: string) {
    const lease = this.resolveState(leaseId);
    return lease ? cloneLease(lease) : undefined;
  }

  removeParticipant(roomId: string, participantId: string) {
    for (const [leaseId, lease] of this.leases.entries()) {
      if (
        lease.roomId === roomId &&
        lease.grantedByParticipantId === participantId
      ) {
        this.leases.delete(leaseId);
      }
    }
  }

  removeRoom(roomId: string) {
    for (const [leaseId, lease] of this.leases.entries()) {
      if (lease.roomId === roomId) {
        this.leases.delete(leaseId);
      }
    }
  }

  count(roomId?: string) {
    this.expireDue();
    if (!roomId) return this.leases.size;
    return [...this.leases.values()].filter(
      (lease) => lease.roomId === roomId
    ).length;
  }

  private resolveState(leaseId: string) {
    const lease = this.leases.get(leaseId);
    if (!lease) return undefined;
    if (
      lease.state === "active" &&
      Date.parse(lease.expiresAt) <= Date.now()
    ) {
      lease.state = "expired";
    }
    return lease;
  }

  private expireDue() {
    for (const lease of this.leases.values()) {
      this.resolveState(lease.leaseId);
    }
  }
}
