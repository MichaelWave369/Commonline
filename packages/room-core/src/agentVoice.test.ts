import { describe, expect, it } from "vitest";
import {
  activeAgentVoiceGrant,
  bootstrapAgentVoiceAuthority,
  createRoom,
  grantAgentVoice,
  joinParticipant,
  revokeAgentVoice,
  SILENT_AGENT_PARTICIPANT_ID
} from "./index";

function roomWithSteward() {
  return joinParticipant(
    createRoom({
      roomId: "voice-room",
      purpose: "agent voice authority proof"
    }),
    {
      participantId: "alice",
      name: "Alice",
      requestedRole: "participant"
    }
  );
}

describe("P0-m agent voice authority", () => {
  it("does not give Vessie voice authority by default", () => {
    const room = roomWithSteward();

    expect(
      room.grants.some(
        (grant) =>
          grant.subjectParticipantId === SILENT_AGENT_PARTICIPANT_ID &&
          grant.capability === "SPEAK"
      )
    ).toBe(false);
    expect(activeAgentVoiceGrant(room, SILENT_AGENT_PARTICIPANT_ID)).toBeUndefined();
  });

  it("requires an explicit one-time bootstrap from exact ACCEPT_OUTCOME authority", () => {
    const room = roomWithSteward();
    const accept = room.grants.find(
      (grant) =>
        grant.subjectParticipantId === "alice" &&
        grant.capability === "ACCEPT_OUTCOME"
    )!;

    const bootstrapped = bootstrapAgentVoiceAuthority(room, {
      bootstrapId: "bootstrap-1",
      actorParticipantId: "alice",
      acceptAuthorityGrantId: accept.grantId
    });

    expect(bootstrapped.ok).toBe(true);
    if (!bootstrapped.ok) return;

    const managerGrant = bootstrapped.room.grants.find(
      (grant) => grant.grantId === bootstrapped.receipt.issuedGrantId
    );
    expect(managerGrant?.capability).toBe("MANAGE_AGENT_VOICE");

    const replay = bootstrapAgentVoiceAuthority(bootstrapped.room, {
      bootstrapId: "bootstrap-1",
      actorParticipantId: "alice",
      acceptAuthorityGrantId: accept.grantId
    });
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.replayed).toBe(true);
  });

  it("requires MANAGE_AGENT_VOICE to issue a voice-id-bound grant", () => {
    const room = roomWithSteward();
    const denied = grantAgentVoice(room, {
      grantRequestId: "voice-grant-1",
      actorParticipantId: "alice",
      agentParticipantId: SILENT_AGENT_PARTICIPANT_ID,
      voiceId: "vessie-local-v1",
      authorityGrantId: "not-a-grant"
    });
    expect(denied.ok).toBe(false);

    const accept = room.grants.find(
      (grant) =>
        grant.subjectParticipantId === "alice" &&
        grant.capability === "ACCEPT_OUTCOME"
    )!;
    const boot = bootstrapAgentVoiceAuthority(room, {
      bootstrapId: "bootstrap-2",
      actorParticipantId: "alice",
      acceptAuthorityGrantId: accept.grantId
    });
    if (!boot.ok) throw new Error(boot.message);

    const managerGrantId = boot.receipt.issuedGrantId;
    const granted = grantAgentVoice(boot.room, {
      grantRequestId: "voice-grant-1",
      actorParticipantId: "alice",
      agentParticipantId: SILENT_AGENT_PARTICIPANT_ID,
      voiceId: "vessie-local-v1",
      authorityGrantId: managerGrantId
    });

    expect(granted.ok).toBe(true);
    if (!granted.ok) return;
    expect(granted.receipt.voiceId).toBe("vessie-local-v1");
    expect(granted.receipt.audienceMode).toBe("explicit-subscription");
    expect(
      activeAgentVoiceGrant(
        granted.room,
        SILENT_AGENT_PARTICIPANT_ID
      )?.voiceGrantId
    ).toBe(granted.receipt.voiceGrantId);
  });

  it("revokes the exact voice grant without revoking the agent itself", () => {
    const room = roomWithSteward();
    const accept = room.grants.find(
      (grant) =>
        grant.subjectParticipantId === "alice" &&
        grant.capability === "ACCEPT_OUTCOME"
    )!;
    const boot = bootstrapAgentVoiceAuthority(room, {
      bootstrapId: "bootstrap-3",
      actorParticipantId: "alice",
      acceptAuthorityGrantId: accept.grantId
    });
    if (!boot.ok) throw new Error(boot.message);

    const granted = grantAgentVoice(boot.room, {
      grantRequestId: "voice-grant-3",
      actorParticipantId: "alice",
      agentParticipantId: SILENT_AGENT_PARTICIPANT_ID,
      voiceId: "vessie-local-v1",
      authorityGrantId: boot.receipt.issuedGrantId
    });
    if (!granted.ok) throw new Error(granted.message);

    const revoked = revokeAgentVoice(granted.room, {
      revokeRequestId: "revoke-3",
      actorParticipantId: "alice",
      voiceGrantId: granted.receipt.voiceGrantId,
      authorityGrantId: boot.receipt.issuedGrantId
    });
    expect(revoked.ok).toBe(true);
    if (!revoked.ok) return;

    expect(
      activeAgentVoiceGrant(
        revoked.room,
        SILENT_AGENT_PARTICIPANT_ID
      )
    ).toBeUndefined();
    expect(
      revoked.room.participants.some(
        (participant) =>
          participant.id === SILENT_AGENT_PARTICIPANT_ID &&
          participant.kind === "agent"
      )
    ).toBe(true);
  });
});
