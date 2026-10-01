import { describe, expect, it } from "vitest";
import {
  extractRtcMetrics,
  routeFromCandidates
} from "./rtcDiagnostics";

describe("P0-g RTC diagnostics", () => {
  it("classifies TURN-selected calls as relayed", () => {
    expect(routeFromCandidates("relay", "srflx")).toBe("relay");
    expect(routeFromCandidates("host", "srflx")).toBe("direct");
    expect(routeFromCandidates("unknown", "srflx")).toBe("unknown");
  });

  it("extracts the selected candidate pair and audio health metrics", () => {
    const metrics = extractRtcMetrics([
      {
        id: "transport-1",
        type: "transport",
        selectedCandidatePairId: "pair-1"
      },
      {
        id: "pair-1",
        type: "candidate-pair",
        localCandidateId: "local-1",
        remoteCandidateId: "remote-1",
        state: "succeeded",
        nominated: true,
        currentRoundTripTime: 0.084
      },
      {
        id: "local-1",
        type: "local-candidate",
        candidateType: "relay",
        protocol: "udp",
        relayProtocol: "udp"
      },
      {
        id: "remote-1",
        type: "remote-candidate",
        candidateType: "srflx"
      },
      {
        id: "in-audio",
        type: "inbound-rtp",
        kind: "audio",
        packetsLost: 3,
        packetsReceived: 997,
        jitter: 0.012,
        bytesReceived: 456789
      },
      {
        id: "out-audio",
        type: "outbound-rtp",
        kind: "audio",
        bytesSent: 123456
      }
    ]);

    expect(metrics).toMatchObject({
      route: "relay",
      localCandidateType: "relay",
      remoteCandidateType: "srflx",
      protocol: "udp",
      relayProtocol: "udp",
      currentRoundTripTimeMs: 84,
      packetsLost: 3,
      packetsReceived: 997,
      jitterMs: 12,
      bytesSent: 123456,
      bytesReceived: 456789
    });
  });
});
