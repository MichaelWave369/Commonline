import type { IdentityPublicKey } from "@commonline/protocol";

export interface IdentityRecord {
  participantId: string;
  publicKey: IdentityPublicKey;
  recoveryHash: string;
  createdAt: string;
  rotatedAt?: string;
}

export interface DurableIdentityStore {
  getIdentity(participantId: string): IdentityRecord | undefined;
  enrollIdentity(record: IdentityRecord): void;
  rotateIdentity(input: {
    participantId: string;
    publicKey: IdentityPublicKey;
    recoveryHash: string;
    rotatedAt: string;
  }): void;
}
