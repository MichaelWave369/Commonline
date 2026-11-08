// Optional agent-to-agent exchange sidecar. It does not change the frozen P0 room wire profile.
export const AGENT_EXCHANGE_SCHEMA = "commonline.agent-exchange.v1" as const;
export const AGENT_EXCHANGE_EVENT_TYPE = "commonline.agent_exchange.v1" as const;

export type AgentExchangeKind =
  | "offer_work"
  | "accept_work"
  | "decline_work"
  | "request_context"
  | "propose_outcome"
  | "report_blocker"
  | "receipt";

export interface AgentExchangeEnvelope {
  schema: typeof AGENT_EXCHANGE_SCHEMA;
  messageId: string;
  threadId: string;
  sender: string;
  recipient: string;
  kind: AgentExchangeKind;
  issuedAt: string;
  expiresAt: string;
  summary: string;
  /** Opaque, access-controlled reference, never the context or credential itself. */
  contextRef?: string;
  /** Optional exact source revision for evidence-bound cross-repo requests. */
  sourceSha?: string;
  /** Communication is not a grant, and cannot be promoted to one by a transport. */
  authority: "advisory-only";
}

const KINDS: ReadonlySet<string> = new Set([
  "offer_work", "accept_work", "decline_work", "request_context",
  "propose_outcome", "report_blocker", "receipt"
]);
const REQUIRED = [
  "schema", "messageId", "threadId", "sender", "recipient",
  "kind", "issuedAt", "expiresAt", "summary", "authority"
];
const OPTIONAL = ["contextRef", "sourceSha"];
const FIELDS = new Set([...REQUIRED, ...OPTIONAL]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const MAX_BYTES = 8192;
const MAX_TTL_MS = 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function utcTime(value: unknown, field: string): number {
  if (typeof value !== "string") throw new Error(field + "_INVALID");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(field + "_INVALID");
  }
  return parsed;
}

/**
 * Strict parser for an untrusted message body, not an authentication mechanism.
 * Callers must independently authenticate the sender, authorize recipient/context,
 * enforce room policy, and deduplicate messageId in their own durable inbox.
 */
export function parseAgentExchange(input: unknown, nowMs: number = Date.now()): AgentExchangeEnvelope {
  if (!record(input)) throw new Error("ENVELOPE_INVALID");
  let encoded: string;
  try { encoded = JSON.stringify(input); } catch { throw new Error("ENVELOPE_INVALID"); }
  if (typeof encoded !== "string" || new TextEncoder().encode(encoded).byteLength > MAX_BYTES) {
    throw new Error("ENVELOPE_TOO_LARGE");
  }
  if (Object.keys(input).some((key) => !FIELDS.has(key)) ||
      REQUIRED.some((key) => !Object.hasOwn(input, key))) {
    throw new Error("FIELDS_INVALID");
  }
  for (const field of ["messageId", "threadId", "sender", "recipient"]) {
    if (typeof input[field] !== "string" || !ID.test(input[field])) {
      throw new Error(field + "_INVALID");
    }
  }
  if (input.sender === input.recipient) throw new Error("SELF_DELIVERY_FORBIDDEN");
  if (input.schema !== AGENT_EXCHANGE_SCHEMA || !KINDS.has(String(input.kind))) {
    throw new Error("SCHEMA_OR_KIND_INVALID");
  }
  if (input.authority !== "advisory-only") throw new Error("AUTHORITY_FORBIDDEN");
  if (typeof input.summary !== "string" || !input.summary.trim() ||
      input.summary.length > 2048) {
    throw new Error("SUMMARY_INVALID");
  }
  if (input.contextRef !== undefined &&
      (typeof input.contextRef !== "string" || !input.contextRef.trim() ||
       input.contextRef.length > 512)) {
    throw new Error("CONTEXT_REF_INVALID");
  }
  if (input.sourceSha !== undefined &&
      (typeof input.sourceSha !== "string" || !SHA.test(input.sourceSha))) {
    throw new Error("SOURCE_SHA_INVALID");
  }
  const issued = utcTime(input.issuedAt, "ISSUED_AT");
  const expires = utcTime(input.expiresAt, "EXPIRES_AT");
  if (!Number.isFinite(nowMs) || issued > nowMs + FUTURE_SKEW_MS ||
      expires <= nowMs || expires <= issued || expires - issued > MAX_TTL_MS) {
    throw new Error("TIME_WINDOW_INVALID");
  }
  return Object.freeze({
    schema: AGENT_EXCHANGE_SCHEMA,
    messageId: input.messageId as string,
    threadId: input.threadId as string,
    sender: input.sender as string,
    recipient: input.recipient as string,
    kind: input.kind as AgentExchangeKind,
    issuedAt: input.issuedAt as string,
    expiresAt: input.expiresAt as string,
    summary: input.summary as string,
    ...(input.contextRef !== undefined ? { contextRef: input.contextRef as string } : {}),
    ...(input.sourceSha !== undefined ? { sourceSha: input.sourceSha as string } : {}),
    authority: "advisory-only" as const
  });
}
