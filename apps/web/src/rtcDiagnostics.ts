export type CandidateType =
  | "host"
  | "srflx"
  | "prflx"
  | "relay"
  | "unknown";

export type CallRoute = "direct" | "relay" | "unknown";

export interface RtcMetrics {
  route: CallRoute;
  localCandidateType: CandidateType;
  remoteCandidateType: CandidateType;
  protocol?: string;
  relayProtocol?: string;
  currentRoundTripTimeMs?: number;
  packetsLost?: number;
  packetsReceived?: number;
  jitterMs?: number;
  bytesSent?: number;
  bytesReceived?: number;
}

export interface RtcStatLike {
  id: string;
  type: string;
  [key: string]: unknown;
}

function candidateType(value: unknown): CandidateType {
  return value === "host" ||
    value === "srflx" ||
    value === "prflx" ||
    value === "relay"
    ? value
    : "unknown";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function routeFromCandidates(
  local: CandidateType,
  remote: CandidateType
): CallRoute {
  if (local === "relay" || remote === "relay") return "relay";
  if (local !== "unknown" && remote !== "unknown") return "direct";
  return "unknown";
}

export function extractRtcMetrics(entries: Iterable<RtcStatLike>): RtcMetrics {
  const stats = [...entries];
  const byId = new Map(stats.map((entry) => [entry.id, entry]));

  const transport = stats.find((entry) => entry.type === "transport");
  const selectedPairId =
    typeof transport?.selectedCandidatePairId === "string"
      ? transport.selectedCandidatePairId
      : undefined;

  const selectedPair =
    (selectedPairId ? byId.get(selectedPairId) : undefined) ??
    stats.find(
      (entry) =>
        entry.type === "candidate-pair" &&
        entry.state === "succeeded" &&
        entry.nominated === true
    );

  const localCandidate =
    typeof selectedPair?.localCandidateId === "string"
      ? byId.get(selectedPair.localCandidateId)
      : undefined;
  const remoteCandidate =
    typeof selectedPair?.remoteCandidateId === "string"
      ? byId.get(selectedPair.remoteCandidateId)
      : undefined;

  const localType = candidateType(localCandidate?.candidateType);
  const remoteType = candidateType(remoteCandidate?.candidateType);

  const inbound = stats.find(
    (entry) =>
      entry.type === "inbound-rtp" &&
      entry.kind === "audio" &&
      entry.isRemote !== true
  );
  const outbound = stats.find(
    (entry) =>
      entry.type === "outbound-rtp" &&
      entry.kind === "audio" &&
      entry.isRemote !== true
  );

  const rttSeconds = finiteNumber(selectedPair?.currentRoundTripTime);
  const jitterSeconds = finiteNumber(inbound?.jitter);

  return {
    route: routeFromCandidates(localType, remoteType),
    localCandidateType: localType,
    remoteCandidateType: remoteType,
    protocol:
      typeof localCandidate?.protocol === "string"
        ? localCandidate.protocol
        : undefined,
    relayProtocol:
      typeof localCandidate?.relayProtocol === "string"
        ? localCandidate.relayProtocol
        : undefined,
    currentRoundTripTimeMs:
      rttSeconds === undefined ? undefined : Math.round(rttSeconds * 1000),
    packetsLost: finiteNumber(inbound?.packetsLost),
    packetsReceived: finiteNumber(inbound?.packetsReceived),
    jitterMs:
      jitterSeconds === undefined
        ? undefined
        : Math.round(jitterSeconds * 1000),
    bytesSent: finiteNumber(outbound?.bytesSent),
    bytesReceived: finiteNumber(inbound?.bytesReceived)
  };
}
