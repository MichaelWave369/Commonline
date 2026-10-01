import {
  createHash,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify
} from "node:crypto";
import type {
  IdentityChallengeMessage,
  IdentityChallengePurpose,
  IdentityPublicKey
} from "@commonline/protocol";
import type { DurableIdentityStore } from "./identityStore";

const CHALLENGE_TTL_MS = 60_000;
const PROOF_PREFIX = "commonline-identity-v1";

interface PendingChallenge {
  challengeId: string;
  participantId: string;
  sessionId: string;
  nonce: string;
  purpose: IdentityChallengePurpose;
  expiresAt: string;
  enrollmentPublicKey?: IdentityPublicKey;
}

export interface IdentityProofResult {
  ok: true;
  participantId: string;
  sessionId: string;
  enrolled: boolean;
  recovered: boolean;
  recoveryCode?: string;
}

export interface IdentityFailure {
  ok: false;
  code:
    | "IDENTITY_NOT_FOUND"
    | "IDENTITY_CHALLENGE_INVALID"
    | "IDENTITY_PROOF_INVALID"
    | "IDENTITY_RECOVERY_INVALID"
    | "INVALID_INTENT";
  message: string;
}

function base64Url(bytes: Buffer) {
  return bytes.toString("base64url");
}

function recoveryHash(participantId: string, recoveryCode: string) {
  return createHash("sha256")
    .update(`${participantId}\0${recoveryCode}`, "utf8")
    .digest("hex");
}

function proofPayload(challenge: PendingChallenge) {
  return [
    PROOF_PREFIX,
    challenge.challengeId,
    challenge.participantId,
    challenge.sessionId,
    challenge.nonce
  ].join("|");
}

function validPublicKey(key: IdentityPublicKey | undefined): key is IdentityPublicKey {
  return Boolean(
    key &&
      key.kty === "EC" &&
      key.crv === "P-256" &&
      typeof key.x === "string" &&
      key.x.length > 0 &&
      typeof key.y === "string" &&
      key.y.length > 0
  );
}

export class IdentityService {
  private readonly challenges = new Map<string, PendingChallenge>();

  constructor(private readonly store: DurableIdentityStore) {}

  begin(input: {
    requestId: string;
    participantId: string;
    sessionId: string;
    publicKey?: IdentityPublicKey;
  }):
    | { ok: true; message: IdentityChallengeMessage }
    | IdentityFailure {
    if (!input.participantId || !input.sessionId) {
      return {
        ok: false,
        code: "INVALID_INTENT",
        message: "Identity begin requires participantId and sessionId."
      };
    }

    const existing = this.store.getIdentity(input.participantId);
    const purpose: IdentityChallengePurpose = existing
      ? "authenticate"
      : "enroll";

    if (!existing && !validPublicKey(input.publicKey)) {
      return {
        ok: false,
        code: "INVALID_INTENT",
        message: "Initial identity enrollment requires a P-256 public key."
      };
    }

    const challenge: PendingChallenge = {
      challengeId: `identity-challenge-${crypto.randomUUID()}`,
      participantId: input.participantId,
      sessionId: input.sessionId,
      nonce: base64Url(randomBytes(32)),
      purpose,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS).toISOString(),
      enrollmentPublicKey:
        purpose === "enroll" ? input.publicKey : undefined
    };

    this.challenges.set(challenge.challengeId, challenge);

    return {
      ok: true,
      message: {
        type: "identity_challenge",
        requestId: input.requestId,
        challengeId: challenge.challengeId,
        participantId: challenge.participantId,
        sessionId: challenge.sessionId,
        nonce: challenge.nonce,
        purpose: challenge.purpose,
        expiresAt: challenge.expiresAt
      }
    };
  }

  prove(input: {
    challengeId: string;
    signature: string;
  }): IdentityProofResult | IdentityFailure {
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge) {
      return {
        ok: false,
        code: "IDENTITY_CHALLENGE_INVALID",
        message: "Identity challenge is missing or already consumed."
      };
    }

    this.challenges.delete(input.challengeId);

    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      return {
        ok: false,
        code: "IDENTITY_CHALLENGE_INVALID",
        message: "Identity challenge expired."
      };
    }

    const existing = this.store.getIdentity(challenge.participantId);
    const publicKey =
      challenge.purpose === "enroll"
        ? challenge.enrollmentPublicKey
        : existing?.publicKey;

    if (!validPublicKey(publicKey)) {
      return {
        ok: false,
        code: "IDENTITY_NOT_FOUND",
        message: "No usable identity key exists for this participant."
      };
    }

    let signature: Buffer;
    try {
      signature = Buffer.from(input.signature, "base64url");
    } catch {
      return {
        ok: false,
        code: "IDENTITY_PROOF_INVALID",
        message: "Identity proof signature is not valid base64url."
      };
    }

    let verified = false;
    try {
      const keyObject = createPublicKey({
        key: publicKey,
        format: "jwk"
      });
      verified = verify(
        "sha256",
        Buffer.from(proofPayload(challenge), "utf8"),
        {
          key: keyObject,
          dsaEncoding: "ieee-p1363"
        },
        signature
      );
    } catch {
      verified = false;
    }

    if (!verified) {
      return {
        ok: false,
        code: "IDENTITY_PROOF_INVALID",
        message: "Identity signature did not verify."
      };
    }

    if (challenge.purpose === "authenticate") {
      return {
        ok: true,
        participantId: challenge.participantId,
        sessionId: challenge.sessionId,
        enrolled: false,
        recovered: false
      };
    }

    const recoveryCode = base64Url(randomBytes(32));
    this.store.enrollIdentity({
      participantId: challenge.participantId,
      publicKey,
      recoveryHash: recoveryHash(
        challenge.participantId,
        recoveryCode
      ),
      createdAt: new Date().toISOString()
    });

    return {
      ok: true,
      participantId: challenge.participantId,
      sessionId: challenge.sessionId,
      enrolled: true,
      recovered: false,
      recoveryCode
    };
  }

  recover(input: {
    participantId: string;
    sessionId: string;
    recoveryCode: string;
    newPublicKey: IdentityPublicKey;
  }): IdentityProofResult | IdentityFailure {
    const existing = this.store.getIdentity(input.participantId);
    if (!existing) {
      return {
        ok: false,
        code: "IDENTITY_NOT_FOUND",
        message: "No enrolled identity exists for this participant."
      };
    }

    if (!validPublicKey(input.newPublicKey)) {
      return {
        ok: false,
        code: "INVALID_INTENT",
        message: "Recovery requires a valid replacement P-256 public key."
      };
    }

    const expected = Buffer.from(existing.recoveryHash, "hex");
    const actual = Buffer.from(
      recoveryHash(input.participantId, input.recoveryCode),
      "hex"
    );

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return {
        ok: false,
        code: "IDENTITY_RECOVERY_INVALID",
        message: "Recovery code did not match this participant identity."
      };
    }

    const nextRecoveryCode = base64Url(randomBytes(32));
    this.store.rotateIdentity({
      participantId: input.participantId,
      publicKey: input.newPublicKey,
      recoveryHash: recoveryHash(
        input.participantId,
        nextRecoveryCode
      ),
      rotatedAt: new Date().toISOString()
    });

    return {
      ok: true,
      participantId: input.participantId,
      sessionId: input.sessionId,
      enrolled: false,
      recovered: true,
      recoveryCode: nextRecoveryCode
    };
  }

  static proofPayload(input: {
    challengeId: string;
    participantId: string;
    sessionId: string;
    nonce: string;
  }) {
    return [
      PROOF_PREFIX,
      input.challengeId,
      input.participantId,
      input.sessionId,
      input.nonce
    ].join("|");
  }
}
