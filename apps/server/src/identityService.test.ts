import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IdentityPublicKey } from "@commonline/protocol";
import type {
  DurableIdentityStore,
  IdentityRecord
} from "./identityStore";
import { IdentityService } from "./identityService";

class MemoryIdentityStore implements DurableIdentityStore {
  readonly records = new Map<string, IdentityRecord>();

  getIdentity(participantId: string) {
    return this.records.get(participantId);
  }

  enrollIdentity(record: IdentityRecord) {
    if (this.records.has(record.participantId)) {
      throw new Error("identity already exists");
    }
    this.records.set(record.participantId, record);
  }

  rotateIdentity(input: {
    participantId: string;
    publicKey: IdentityPublicKey;
    recoveryHash: string;
    rotatedAt: string;
  }) {
    const prior = this.records.get(input.participantId);
    if (!prior) throw new Error("missing identity");
    this.records.set(input.participantId, {
      ...prior,
      publicKey: input.publicKey,
      recoveryHash: input.recoveryHash,
      rotatedAt: input.rotatedAt
    });
  }
}

async function keyPair() {
  const pair = await webcrypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    true,
    ["sign", "verify"]
  );
  if (!("privateKey" in pair)) {
    throw new Error("expected an ECDSA key pair");
  }

  const jwk = await webcrypto.subtle.exportKey("jwk", pair.publicKey);
  if (!jwk.x || !jwk.y) throw new Error("missing EC coordinates");

  const publicKey: IdentityPublicKey = {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
    ext: true,
    key_ops: ["verify"]
  };

  return { pair, publicKey };
}

type SigningKey = Parameters<typeof webcrypto.subtle.sign>[1];

async function sign(
  privateKey: SigningKey,
  challenge: {
    challengeId: string;
    participantId: string;
    sessionId: string;
    nonce: string;
  }
) {
  const payload = IdentityService.proofPayload(challenge);
  const signature = await webcrypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    privateKey,
    new TextEncoder().encode(payload)
  );
  return Buffer.from(signature).toString("base64url");
}

describe("P0-f identity challenge and recovery", () => {
  it("enrolls by proof of key possession, then authenticates without returning the recovery secret again", async () => {
    const store = new MemoryIdentityStore();
    const service = new IdentityService(store);
    const { pair, publicKey } = await keyPair();

    const begun = service.begin({
      requestId: "begin-1",
      participantId: "human-alice",
      sessionId: "session-1",
      publicKey
    });
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(begun.message.purpose).toBe("enroll");

    const enrolled = service.prove({
      challengeId: begun.message.challengeId,
      signature: await sign(pair.privateKey, begun.message)
    });
    expect(enrolled.ok).toBe(true);
    if (!enrolled.ok) return;
    expect(enrolled.enrolled).toBe(true);
    expect(enrolled.recoveryCode).toBeTruthy();
    expect(store.getIdentity("human-alice")?.recoveryHash).toBeTruthy();

    const next = service.begin({
      requestId: "begin-2",
      participantId: "human-alice",
      sessionId: "session-2"
    });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.message.purpose).toBe("authenticate");

    const authenticated = service.prove({
      challengeId: next.message.challengeId,
      signature: await sign(pair.privateKey, next.message)
    });
    expect(authenticated.ok).toBe(true);
    if (!authenticated.ok) return;
    expect(authenticated.enrolled).toBe(false);
    expect(authenticated.recoveryCode).toBeUndefined();
  });

  it("rotates the key and recovery code without changing participant identity", async () => {
    const store = new MemoryIdentityStore();
    const service = new IdentityService(store);
    const original = await keyPair();

    const begun = service.begin({
      requestId: "begin",
      participantId: "human-alice",
      sessionId: "session-a",
      publicKey: original.publicKey
    });
    if (!begun.ok) throw new Error(begun.message);

    const enrolled = service.prove({
      challengeId: begun.message.challengeId,
      signature: await sign(original.pair.privateKey, begun.message)
    });
    if (!enrolled.ok || !enrolled.recoveryCode) {
      throw new Error("enrollment failed");
    }

    const replacement = await keyPair();
    const recovered = service.recover({
      participantId: "human-alice",
      sessionId: "session-b",
      recoveryCode: enrolled.recoveryCode,
      newPublicKey: replacement.publicKey
    });
    expect(recovered.ok).toBe(true);
    if (!recovered.ok) return;
    expect(recovered.participantId).toBe("human-alice");
    expect(recovered.recovered).toBe(true);
    expect(recovered.recoveryCode).toBeTruthy();
    expect(recovered.recoveryCode).not.toBe(enrolled.recoveryCode);

    const oldKeyChallenge = service.begin({
      requestId: "old",
      participantId: "human-alice",
      sessionId: "session-c"
    });
    if (!oldKeyChallenge.ok) throw new Error(oldKeyChallenge.message);

    const oldKeyProof = service.prove({
      challengeId: oldKeyChallenge.message.challengeId,
      signature: await sign(
        original.pair.privateKey,
        oldKeyChallenge.message
      )
    });
    expect(oldKeyProof.ok).toBe(false);
    if (!oldKeyProof.ok) {
      expect(oldKeyProof.code).toBe("IDENTITY_PROOF_INVALID");
    }

    const newKeyChallenge = service.begin({
      requestId: "new",
      participantId: "human-alice",
      sessionId: "session-d"
    });
    if (!newKeyChallenge.ok) throw new Error(newKeyChallenge.message);

    const newKeyProof = service.prove({
      challengeId: newKeyChallenge.message.challengeId,
      signature: await sign(
        replacement.pair.privateKey,
        newKeyChallenge.message
      )
    });
    expect(newKeyProof.ok).toBe(true);
  });

  it("consumes challenges and rejects an incorrect recovery code", async () => {
    const store = new MemoryIdentityStore();
    const service = new IdentityService(store);
    const original = await keyPair();

    const begun = service.begin({
      requestId: "begin",
      participantId: "human-alice",
      sessionId: "session-a",
      publicKey: original.publicKey
    });
    if (!begun.ok) throw new Error(begun.message);

    const signature = await sign(original.pair.privateKey, begun.message);
    expect(
      service.prove({
        challengeId: begun.message.challengeId,
        signature
      }).ok
    ).toBe(true);

    const replay = service.prove({
      challengeId: begun.message.challengeId,
      signature
    });
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.code).toBe("IDENTITY_CHALLENGE_INVALID");
    }

    const replacement = await keyPair();
    const recovery = service.recover({
      participantId: "human-alice",
      sessionId: "session-b",
      recoveryCode: "definitely-wrong",
      newPublicKey: replacement.publicKey
    });
    expect(recovery.ok).toBe(false);
    if (!recovery.ok) {
      expect(recovery.code).toBe("IDENTITY_RECOVERY_INVALID");
    }
  });
});
