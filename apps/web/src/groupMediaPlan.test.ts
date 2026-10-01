import { describe, expect, it } from "vitest";
import type { GroupMediaStateMessage } from "@commonline/protocol";
import { buildGroupPeerPlans } from "./groupMediaPlan";

describe("group route plan", () => {
  it("requires a subscription before creating a peer route", () => {
    const state: GroupMediaStateMessage = {
      type: "group_media_state",
      requestId: "r",
      roomId: "room",
      mediaSessionId: "m1",
      generation: 1,
      routerMode: "mesh-p0",
      maxParticipants: 3,
      participants: [
        { participantId: "p1", joinedAt: "now" },
        { participantId: "p2", joinedAt: "now" }
      ],
      sources: [
        {
          sourceId: "s1",
          ownerParticipantId: "p1",
          kind: "microphone",
          publishedAt: "now"
        },
        {
          sourceId: "s2",
          ownerParticipantId: "p2",
          kind: "microphone",
          publishedAt: "now"
        }
      ],
      subscriptions: []
    };

    expect(buildGroupPeerPlans(state, "p1")).toEqual([]);

    state.subscriptions.push({
      subscriberParticipantId: "p1",
      sourceId: "s2",
      createdAt: "now"
    });

    expect(buildGroupPeerPlans(state, "p1")).toEqual([
      {
        peerParticipantId: "p2",
        sendLocal: false,
        receiveRemote: true,
        peerSourceId: "s2"
      }
    ]);
  });
});
