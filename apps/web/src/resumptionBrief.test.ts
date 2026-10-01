import { describe, expect, it } from "vitest";
import type { RoomEvent, RoomSnapshot } from "@commonline/protocol";
import { buildResumptionBrief } from "./resumptionBrief";

function roomFixture(
  overrides: Partial<RoomSnapshot> = {}
): RoomSnapshot {
  return {
    schemaVersion: "p0-u.1",
    roomId: "room-resume",
    purpose: "prove selective resumption",
    version: 12,
    episodeActive: false,
    participants: [],
    grants: [],
    grantRevocations: [],
    authorityTransfers: [],
    voiceAuthorityBootstraps: [],
    agentVoiceGrants: [],
    agentVoiceRevocations: [],
    workItems: [],
    artifacts: [],
    acceptances: [],
    ...overrides
  };
}

describe("P0-r selective resumption brief", () => {
  it("shows accepted work by durable title without copying artifact bodies", () => {
    const room = roomFixture({
      workItems: [
        {
          id: "work-accepted",
          requestedBy: "alice",
          prompt: "Produce a compact comparison.",
          status: "accepted",
          createdAt: "2026-10-01T19:00:00.000Z"
        }
      ],
      artifacts: [
        {
          id: "artifact-accepted",
          sourceWorkId: "work-accepted",
          title: "Accepted comparison",
          body: "DURABLE_BODY_NOT_NEEDED_IN_RESUME_BRIEF",
          producedBy: "agent-vessie",
          status: "accepted",
          createdAt: "2026-10-01T19:01:00.000Z"
        }
      ],
      acceptances: [
        {
          receiptId: "receipt-1",
          acceptId: "accept-1",
          roomId: "room-resume",
          workItemId: "work-accepted",
          artifactId: "artifact-accepted",
          actorParticipantId: "alice",
          authorityGrantId: "grant-accept",
          committedVersion: 10,
          acceptedAt: "2026-10-01T19:02:00.000Z"
        }
      ]
    });

    const brief = buildResumptionBrief(room, []);

    expect(brief.acceptedWork).toEqual([
      {
        workItemId: "work-accepted",
        artifactId: "artifact-accepted",
        title: "Accepted comparison",
        acceptedAt: "2026-10-01T19:02:00.000Z"
      }
    ]);
    expect(JSON.stringify(brief)).not.toContain(
      "DURABLE_BODY_NOT_NEEDED_IN_RESUME_BRIEF"
    );
  });

  it("keeps proposed and failed work unresolved and prioritizes proposal review", () => {
    const room = roomFixture({
      workItems: [
        {
          id: "work-failed",
          requestedBy: "alice",
          prompt: "Try the failed branch again.",
          status: "failed",
          createdAt: "2026-10-01T19:00:00.000Z"
        },
        {
          id: "work-proposed",
          requestedBy: "bob",
          prompt: "Draft a migration note.",
          status: "proposed",
          createdAt: "2026-10-01T19:03:00.000Z"
        }
      ],
      artifacts: [
        {
          id: "artifact-proposed",
          sourceWorkId: "work-proposed",
          title: "Migration note",
          body: "proposal body",
          producedBy: "agent-vessie",
          status: "proposed",
          createdAt: "2026-10-01T19:04:00.000Z"
        }
      ]
    });

    const brief = buildResumptionBrief(room, []);

    expect(brief.unresolvedWork.map((item) => item.status)).toEqual([
      "failed",
      "proposed"
    ]);
    expect(brief.nextAction).toEqual({
      kind: "review-proposal",
      summary:
        "Review proposal “Migration note” and explicitly accept it or leave it unresolved.",
      workItemId: "work-proposed",
      artifactId: "artifact-proposed"
    });
  });

  it("uses only the supplied durable resume delta and does not invent history", () => {
    const delta: RoomEvent[] = [
      {
        id: "event-11",
        roomId: "room-resume",
        version: 11,
        type: "artifact_accepted",
        actorId: "alice",
        summary: "Alice accepted artifact Migration note",
        occurredAt: "2026-10-01T19:05:00.000Z"
      }
    ];

    const brief = buildResumptionBrief(roomFixture(), delta);

    expect(brief.missedDurableEvents).toEqual(delta);
    expect(brief.missedDurableEvents).not.toBe(delta);
    expect(brief.nextAction.kind).toBe("submit-work");
  });
});
