import type { RoomEvent, RoomSnapshot } from "@commonline/protocol";

export interface DurableRoomStore {
  loadRoom(roomId: string): RoomSnapshot | undefined;
  loadEvents(roomId: string): RoomEvent[];
  saveTransition(input: {
    room: RoomSnapshot;
    event: RoomEvent;
    expectedPreviousVersion: number;
  }): void;
}

export class PersistenceConflictError extends Error {
  constructor(
    public readonly roomId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number | null
  ) {
    super(
      `Persistence conflict for ${roomId}: expected v${expectedVersion}, found ${actualVersion === null ? "no room" : `v${actualVersion}`}.`
    );
    this.name = "PersistenceConflictError";
  }
}
