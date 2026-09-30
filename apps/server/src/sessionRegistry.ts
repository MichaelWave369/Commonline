export interface SessionBinding<TConnection> {
  participantId: string;
  sessionId: string;
  connection: TConnection;
}

export class SessionRegistry<TConnection> {
  private readonly rooms = new Map<
    string,
    Map<string, SessionBinding<TConnection>>
  >();

  bind(
    roomId: string,
    binding: SessionBinding<TConnection>
  ): SessionBinding<TConnection> | undefined {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = new Map();
      this.rooms.set(roomId, room);
    }

    const prior = room.get(binding.participantId);
    room.set(binding.participantId, binding);
    return prior;
  }

  current(roomId: string, participantId: string) {
    return this.rooms.get(roomId)?.get(participantId);
  }

  unbindIfCurrent(
    roomId: string,
    participantId: string,
    connection: TConnection
  ) {
    const room = this.rooms.get(roomId);
    const current = room?.get(participantId);
    if (!room || !current || current.connection !== connection) {
      return false;
    }

    room.delete(participantId);
    if (room.size === 0) this.rooms.delete(roomId);
    return true;
  }
}
