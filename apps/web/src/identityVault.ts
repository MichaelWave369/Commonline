import type {
  IdentityChallengeMessage,
  IdentityPublicKey
} from "@commonline/protocol";

const DB_NAME = "commonline-identity-v1";
const STORE_NAME = "keys";
const PROOF_PREFIX = "commonline-identity-v1";

export interface LocalIdentity {
  participantId: string;
  publicKey: IdentityPublicKey;
  privateKey: CryptoKey;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.addEventListener("upgradeneeded", () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "participantId" });
      }
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

async function readIdentity(
  participantId: string
): Promise<LocalIdentity | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(participantId);

    request.addEventListener("success", () => {
      const value = request.result as LocalIdentity | undefined;
      resolve(value);
      db.close();
    });
    request.addEventListener("error", () => {
      reject(request.error);
      db.close();
    });
  });
}

async function writeIdentity(identity: LocalIdentity) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(identity);
    transaction.addEventListener("complete", () => {
      resolve();
      db.close();
    });
    transaction.addEventListener("error", () => {
      reject(transaction.error);
      db.close();
    });
  });
}

function asIdentityPublicKey(jwk: JsonWebKey): IdentityPublicKey {
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    !jwk.x ||
    !jwk.y
  ) {
    throw new Error("Generated identity key was not an EC P-256 key.");
  }

  return {
    kty: "EC",
    crv: "P-256",
    x: jwk.x,
    y: jwk.y,
    ext: true,
    key_ops: ["verify"]
  };
}

async function generateIdentity(
  participantId: string
): Promise<LocalIdentity> {
  const generated = (await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    true,
    ["sign", "verify"]
  )) as CryptoKeyPair;

  const publicJwk = await crypto.subtle.exportKey(
    "jwk",
    generated.publicKey
  );
  const privateJwk = await crypto.subtle.exportKey(
    "jwk",
    generated.privateKey
  );

  // Re-import the private key as non-exportable before placing it in IndexedDB.
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    {
      name: "ECDSA",
      namedCurve: "P-256"
    },
    false,
    ["sign"]
  );

  const identity: LocalIdentity = {
    participantId,
    publicKey: asIdentityPublicKey(publicJwk),
    privateKey
  };

  await writeIdentity(identity);
  return identity;
}

export async function getOrCreateIdentity(
  participantId: string
): Promise<LocalIdentity> {
  return (await readIdentity(participantId)) ?? generateIdentity(participantId);
}

export async function rotateLocalIdentity(
  participantId: string
): Promise<LocalIdentity> {
  return generateIdentity(participantId);
}

function proofPayload(challenge: IdentityChallengeMessage) {
  return [
    PROOF_PREFIX,
    challenge.challengeId,
    challenge.participantId,
    challenge.sessionId,
    challenge.nonce
  ].join("|");
}

function base64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export async function signIdentityChallenge(
  identity: LocalIdentity,
  challenge: IdentityChallengeMessage
) {
  if (identity.participantId !== challenge.participantId) {
    throw new Error("Identity challenge belongs to a different participant.");
  }

  const signature = await crypto.subtle.sign(
    {
      name: "ECDSA",
      hash: "SHA-256"
    },
    identity.privateKey,
    new TextEncoder().encode(proofPayload(challenge))
  );

  return base64Url(signature);
}
