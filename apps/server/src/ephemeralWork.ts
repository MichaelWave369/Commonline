import type { AgentWorkState } from "@commonline/protocol";

export interface ScratchEntry {
  roomId: string;
  workItemId: string;
  participantId: string;
  content: string;
  expiresAt: string;
}

export interface AgentWorkStatus {
  roomId: string;
  workItemId: string;
  participantId: string;
  state: AgentWorkState;
}

function key(roomId: string, workItemId: string) {
  return `${roomId}::${workItemId}`;
}

export class EphemeralWorkPlane {
  private readonly scratch = new Map<string, ScratchEntry>();
  private readonly statuses = new Map<string, AgentWorkStatus>();

  begin(input: {
    roomId: string;
    workItemId: string;
    participantId: string;
    ttlMs?: number;
  }) {
    const ttlMs = input.ttlMs ?? 5 * 60 * 1000;
    const entry: ScratchEntry = {
      roomId: input.roomId,
      workItemId: input.workItemId,
      participantId: input.participantId,
      content: "",
      expiresAt: new Date(Date.now() + ttlMs).toISOString()
    };
    this.scratch.set(key(input.roomId, input.workItemId), entry);

    const status: AgentWorkStatus = {
      roomId: input.roomId,
      workItemId: input.workItemId,
      participantId: input.participantId,
      state: "working"
    };
    this.statuses.set(key(input.roomId, input.workItemId), status);
    return status;
  }

  writeScratch(input: {
    roomId: string;
    workItemId: string;
    participantId: string;
    content: string;
  }) {
    const current = this.scratch.get(key(input.roomId, input.workItemId));
    if (!current) {
      throw new Error("Scratch workspace does not exist.");
    }
    if (current.participantId !== input.participantId) {
      throw new Error("Scratch workspace belongs to a different participant.");
    }

    this.scratch.set(key(input.roomId, input.workItemId), {
      ...current,
      content: input.content
    });
  }

  setStatus(input: AgentWorkStatus) {
    this.statuses.set(key(input.roomId, input.workItemId), input);
    return input;
  }

  getStatus(roomId: string, workItemId: string) {
    return this.statuses.get(key(roomId, workItemId));
  }

  getScratch(roomId: string, workItemId: string) {
    const entry = this.scratch.get(key(roomId, workItemId));
    if (!entry) return undefined;
    if (Date.parse(entry.expiresAt) <= Date.now()) {
      this.scratch.delete(key(roomId, workItemId));
      return undefined;
    }
    return entry;
  }

  finish(input: {
    roomId: string;
    workItemId: string;
    participantId: string;
    state?: Extract<AgentWorkState, "completed" | "failed">;
  }) {
    this.scratch.delete(key(input.roomId, input.workItemId));
    const status: AgentWorkStatus = {
      roomId: input.roomId,
      workItemId: input.workItemId,
      participantId: input.participantId,
      state: input.state ?? "completed"
    };
    this.statuses.set(key(input.roomId, input.workItemId), status);
    return status;
  }

  clearExpired(now = Date.now()) {
    for (const [scratchKey, entry] of this.scratch.entries()) {
      if (Date.parse(entry.expiresAt) <= now) {
        this.scratch.delete(scratchKey);
      }
    }
  }
}
