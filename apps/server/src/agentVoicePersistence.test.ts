import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SILENT_AGENT_PARTICIPANT_ID } from "@commonline/room-core";
import { RoomService } from "./roomService";
import { SQLiteRoomStore } from "./sqliteRoomStore";

describe("P0-m voice authority persistence", () => {
  it("survives restart and preserves grant/revocation provenance", () => {
    const dir = mkdtempSync(join(tmpdir(), "commonline-p0m-"));
    const path = join(dir, "voice.db");

    try {
      const store1 = new SQLiteRoomStore(path);
      const service1 = new RoomService("voice persistence", store1);

      service1.join({
        roomId: "voice-room",
        participantId: "alice",
        name: "Alice",
        requestedRole: "participant",
        acknowledgedVersion: 0
      });

      const initial = service1.getRoom("voice-room")!;
      const acceptGrant = initial.grants.find(
        (grant) =>
          grant.subjectParticipantId === "alice" &&
          grant.capability === "ACCEPT_OUTCOME"
      )!;

      const boot = service1.applyIntent("alice", {
        type: "bootstrap_agent_voice_authority",
        requestId: "bootstrap-request",
        roomId: "voice-room",
        baseVersion: initial.version,
        bootstrapId: "bootstrap-stable",
        acceptAuthorityGrantId: acceptGrant.grantId
      });
      expect(boot.ok).toBe(true);
      if (!boot.ok || !boot.voiceAuthorityBootstrap) return;

      const granted = service1.applyIntent("alice", {
        type: "grant_agent_voice",
        requestId: "grant-request",
        roomId: "voice-room",
        baseVersion: boot.room.version,
        grantRequestId: "voice-grant-stable",
        agentParticipantId: SILENT_AGENT_PARTICIPANT_ID,
        voiceId: "vessie-local-v1",
        authorityGrantId: boot.voiceAuthorityBootstrap.issuedGrantId
      });
      expect(granted.ok).toBe(true);
      if (!granted.ok || !granted.agentVoiceGrant) return;

      const voiceGrantId = granted.agentVoiceGrant.voiceGrantId;
      const managerGrantId = boot.voiceAuthorityBootstrap.issuedGrantId;

      store1.close();

      const store2 = new SQLiteRoomStore(path);
      const service2 = new RoomService("voice persistence", store2);
      const recovered = service2.getRoom("voice-room")!;

      expect(recovered.voiceAuthorityBootstraps).toHaveLength(1);
      expect(recovered.agentVoiceGrants[0]?.voiceGrantId).toBe(
        voiceGrantId
      );
      expect(
        recovered.grants.some(
          (grant) =>
            grant.grantId === managerGrantId &&
            grant.capability === "MANAGE_AGENT_VOICE"
        )
      ).toBe(true);

      service2.join({
        roomId: "voice-room",
        participantId: "alice",
        name: "Alice",
        requestedRole: "participant",
        acknowledgedVersion: recovered.version
      });

      const current = service2.getRoom("voice-room")!;
      const revoked = service2.applyIntent("alice", {
        type: "revoke_agent_voice",
        requestId: "revoke-request",
        roomId: "voice-room",
        baseVersion: current.version,
        revokeRequestId: "voice-revoke-stable",
        voiceGrantId,
        authorityGrantId: managerGrantId
      });
      expect(revoked.ok).toBe(true);
      if (!revoked.ok || !revoked.agentVoiceRevocation) return;

      store2.close();

      const store3 = new SQLiteRoomStore(path);
      const finalRoom = store3.loadRoom("voice-room")!;
      expect(finalRoom.agentVoiceRevocations[0]?.voiceGrantId).toBe(
        voiceGrantId
      );

      const durable = store3.durableDebugRows();
      expect(durable.voice_authority_bootstraps).toHaveLength(1);
      expect(durable.agent_voice_grants).toHaveLength(1);
      expect(durable.agent_voice_revocations).toHaveLength(1);
      expect(Object.keys(durable)).not.toContain("agent_voice_audio");
      expect(Object.keys(durable)).not.toContain("tts_audio");

      store3.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
