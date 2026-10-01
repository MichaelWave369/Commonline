export type ConversationExchangeState =
  | "heard"
  | "responded"
  | "expired";

export interface ConversationExchangeView {
  exchangeId: string;
  roomId: string;
  humanParticipantId: string;
  agentParticipantId: string;
  listeningShareId: string;
  state: ConversationExchangeState;
  createdAt: string;
  expiresAt: string;
}

interface ConversationExchangeRecord extends ConversationExchangeView {
  transcript: string;
  responseInFlight: boolean;
}

export type ConversationExchangeClaimResult =
  | {
      ok: true;
      exchange: ConversationExchangeView;
      transcript: string;
    }
  | {
      ok: false;
      code:
        | "EXCHANGE_NOT_FOUND"
        | "EXCHANGE_NOT_OWNED"
        | "EXCHANGE_EXPIRED"
        | "EXCHANGE_ALREADY_RESPONDED"
        | "EXCHANGE_BUSY";
      message: string;
      exchange?: ConversationExchangeView;
    };

const DEFAULT_TTL_MS = 120_000;

function view(record: ConversationExchangeRecord): ConversationExchangeView {
  const {
    transcript: _transcript,
    responseInFlight: _responseInFlight,
    ...publicView
  } = record;
  return { ...publicView };
}

export class ConversationExchangeRegistry {
  private readonly exchanges = new Map<
    string,
    ConversationExchangeRecord
  >();

  create(input: {
    roomId: string;
    humanParticipantId: string;
    agentParticipantId: string;
    listeningShareId: string;
    transcript: string;
    ttlMs?: number;
  }) {
    this.expireDue();

    for (const exchange of this.exchanges.values()) {
      if (
        exchange.roomId === input.roomId &&
        exchange.humanParticipantId === input.humanParticipantId &&
        exchange.agentParticipantId === input.agentParticipantId &&
        exchange.state === "heard"
      ) {
        exchange.state = "expired";
        exchange.responseInFlight = false;
      }
    }

    const createdAt = new Date();
    const ttlMs = Math.min(
      300_000,
      Math.max(15_000, input.ttlMs ?? DEFAULT_TTL_MS)
    );

    const record: ConversationExchangeRecord = {
      exchangeId: `exchange-${crypto.randomUUID()}`,
      roomId: input.roomId,
      humanParticipantId: input.humanParticipantId,
      agentParticipantId: input.agentParticipantId,
      listeningShareId: input.listeningShareId,
      state: "heard",
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(createdAt.getTime() + ttlMs).toISOString(),
      transcript: input.transcript,
      responseInFlight: false
    };

    this.exchanges.set(record.exchangeId, record);
    return view(record);
  }

  claimResponse(input: {
    roomId: string;
    exchangeId: string;
    humanParticipantId: string;
    agentParticipantId: string;
  }): ConversationExchangeClaimResult {
    const record = this.resolveState(input.exchangeId);

    if (
      !record ||
      record.roomId !== input.roomId ||
      record.agentParticipantId !== input.agentParticipantId
    ) {
      return {
        ok: false,
        code: "EXCHANGE_NOT_FOUND",
        message:
          "No matching conversation exchange exists for this room and agent."
      };
    }

    if (record.humanParticipantId !== input.humanParticipantId) {
      return {
        ok: false,
        code: "EXCHANGE_NOT_OWNED",
        message:
          "This conversation exchange belongs to a different human participant.",
        exchange: view(record)
      };
    }

    if (record.state === "expired") {
      return {
        ok: false,
        code: "EXCHANGE_EXPIRED",
        message:
          "The bounded conversation exchange expired before a reply was authorized.",
        exchange: view(record)
      };
    }

    if (record.state === "responded") {
      return {
        ok: false,
        code: "EXCHANGE_ALREADY_RESPONDED",
        message:
          "This bounded conversation exchange has already received its one authorized reply.",
        exchange: view(record)
      };
    }

    if (record.responseInFlight) {
      return {
        ok: false,
        code: "EXCHANGE_BUSY",
        message:
          "A reply is already being produced for this conversation exchange.",
        exchange: view(record)
      };
    }

    record.responseInFlight = true;
    return {
      ok: true,
      exchange: view(record),
      transcript: record.transcript
    };
  }

  completeResponse(exchangeId: string) {
    const record = this.exchanges.get(exchangeId);
    if (!record) return undefined;

    record.responseInFlight = false;
    if (record.state === "heard") {
      record.state = "responded";
    }

    return view(record);
  }

  releaseResponse(exchangeId: string) {
    const record = this.exchanges.get(exchangeId);
    if (!record) return undefined;

    record.responseInFlight = false;
    return view(record);
  }

  get(exchangeId: string) {
    const record = this.resolveState(exchangeId);
    return record ? view(record) : undefined;
  }

  removeParticipant(roomId: string, humanParticipantId: string) {
    for (const [exchangeId, exchange] of this.exchanges.entries()) {
      if (
        exchange.roomId === roomId &&
        exchange.humanParticipantId === humanParticipantId
      ) {
        this.exchanges.delete(exchangeId);
      }
    }
  }

  count(roomId?: string) {
    this.expireDue();
    if (!roomId) return this.exchanges.size;
    return [...this.exchanges.values()].filter(
      (exchange) => exchange.roomId === roomId
    ).length;
  }

  private resolveState(exchangeId: string) {
    const record = this.exchanges.get(exchangeId);
    if (!record) return undefined;

    if (
      record.state === "heard" &&
      Date.parse(record.expiresAt) <= Date.now()
    ) {
      record.state = "expired";
      record.responseInFlight = false;
    }

    return record;
  }

  private expireDue() {
    for (const exchange of this.exchanges.values()) {
      this.resolveState(exchange.exchangeId);
    }
  }
}
