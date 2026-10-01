import type { ListeningShareLease } from "@commonline/protocol";

const DEFAULT_TTL_MS = 60_000;
const MAX_DURATION_MS = 5_000;

type ListeningLeaseFailureCode =
  | "LISTENING_LEASE_NOT_FOUND"
  | "LISTENING_LEASE_NOT_OWNED"
  | "LISTENING_LEASE_EXPIRED"
  | "LISTENING_LEASE_CONSUMED"
  | "LISTENING_LEASE_REVOKED";

export type ListeningLeaseResult =
  | { ok: true; lease: ListeningShareLease }
  | {
      ok: false;
      code: ListeningLeaseFailureCode;
      message: string;
      lease?: ListeningShareLease;
    };

function cloneLease(lease: ListeningShareLease): ListeningShareLease {
  return { ...lease };
}

export class ListeningShareRegistry {
  private readonly leases = new Map<string, ListeningShareLease>();

  grant(input: {
    roomId: string;
    humanParticipantId: string;
    agentParticipantId: string;
    ttlMs?: number;
  }) {
    this.expireDue();

    for (const lease of this.leases.values()) {
      if (
        lease.roomId === input.roomId &&
        lease.humanParticipantId === input.humanParticipantId &&
        lease.agentParticipantId === input.agentParticipantId &&
        lease.state === "active"
      ) {
        lease.state = "revoked";
      }
    }

    const issuedAt = new Date();
    const ttlMs = Math.min(
      120_000,
      Math.max(10_000, input.ttlMs ?? DEFAULT_TTL_MS)
    );

    const lease: ListeningShareLease = {
      leaseId: `listen-${crypto.randomUUID()}`,
      roomId: input.roomId,
      humanParticipantId: input.humanParticipantId,
      agentParticipantId: input.agentParticipantId,
      state: "active",
      issuedAt: issuedAt.toISOString(),
      expiresAt: new Date(issuedAt.getTime() + ttlMs).toISOString(),
      maxDurationMs: MAX_DURATION_MS
    };

    this.leases.set(lease.leaseId, lease);
    return cloneLease(lease);
  }

  consume(input: {
    roomId: string;
    leaseId: string;
    humanParticipantId: string;
    agentParticipantId: string;
  }): ListeningLeaseResult {
    const lease = this.resolveState(input.leaseId);

    if (
      !lease ||
      lease.roomId !== input.roomId ||
      lease.agentParticipantId !== input.agentParticipantId
    ) {
      return {
        ok: false,
        code: "LISTENING_LEASE_NOT_FOUND",
        message:
          "No matching bounded listening-share lease exists for this room and agent."
      };
    }

    if (lease.humanParticipantId !== input.humanParticipantId) {
      return {
        ok: false,
        code: "LISTENING_LEASE_NOT_OWNED",
        message:
          "This listening-share lease belongs to a different human participant.",
        lease: cloneLease(lease)
      };
    }

    if (lease.state === "expired") {
      return {
        ok: false,
        code: "LISTENING_LEASE_EXPIRED",
        message: "The bounded listening-share lease has expired.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "consumed") {
      return {
        ok: false,
        code: "LISTENING_LEASE_CONSUMED",
        message: "This listening-share lease has already been consumed.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "revoked") {
      return {
        ok: false,
        code: "LISTENING_LEASE_REVOKED",
        message: "The listening-share lease was revoked before use.",
        lease: cloneLease(lease)
      };
    }

    lease.state = "consumed";
    return { ok: true, lease: cloneLease(lease) };
  }

  revoke(input: {
    roomId: string;
    leaseId: string;
    humanParticipantId: string;
  }): ListeningLeaseResult {
    const lease = this.resolveState(input.leaseId);

    if (!lease || lease.roomId !== input.roomId) {
      return {
        ok: false,
        code: "LISTENING_LEASE_NOT_FOUND",
        message: "The requested listening-share lease does not exist."
      };
    }

    if (lease.humanParticipantId !== input.humanParticipantId) {
      return {
        ok: false,
        code: "LISTENING_LEASE_NOT_OWNED",
        message:
          "Only the human who granted this listening-share lease may revoke it.",
        lease: cloneLease(lease)
      };
    }

    if (lease.state === "expired") {
      return {
        ok: false,
        code: "LISTENING_LEASE_EXPIRED",
        message: "The listening-share lease has expired.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "consumed") {
      return {
        ok: false,
        code: "LISTENING_LEASE_CONSUMED",
        message: "The listening-share lease has already been consumed.",
        lease: cloneLease(lease)
      };
    }
    if (lease.state === "revoked") {
      return {
        ok: false,
        code: "LISTENING_LEASE_REVOKED",
        message: "The listening-share lease has already been revoked.",
        lease: cloneLease(lease)
      };
    }

    lease.state = "revoked";
    return { ok: true, lease: cloneLease(lease) };
  }

  get(leaseId: string) {
    const lease = this.resolveState(leaseId);
    return lease ? cloneLease(lease) : undefined;
  }

  removeParticipant(roomId: string, humanParticipantId: string) {
    for (const [leaseId, lease] of this.leases.entries()) {
      if (
        lease.roomId === roomId &&
        lease.humanParticipantId === humanParticipantId
      ) {
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
