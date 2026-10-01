import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  COMMONLINE_WIRE_SCHEMA_VERSION,
  type AcceptanceReceipt,
  type AgentVoiceGrantReceipt,
  type AgentVoiceRevocationReceipt,
  type Artifact,
  type AuthorityTransferReceipt,
  type Capability,
  type GrantReceipt,
  type GrantRevocationReceipt,
  type IdentityPublicKey,
  type Participant,
  type ParticipantRole,
  type PrincipalKind,
  type RoomEvent,
  type RoomEventType,
  type RoomSnapshot,
  type VoiceAuthorityBootstrapReceipt,
  type WorkItem,
  type WorkStatus
} from "@commonline/protocol";
import type {
  DurableIdentityStore,
  IdentityRecord
} from "./identityStore";
import {
  type DurableRoomStore,
  PersistenceConflictError
} from "./roomStore";

export const COMMONLINE_STORAGE_SCHEMA_VERSION = "p0-n.1" as const;
const MIGRATABLE_SCHEMA_PAIRS = new Set([
  "p0-e.1|p0-d.1",
  "p0-f.1|p0-f.1",
  "p0-g.1|p0-g.1",
  "p0-h.1|p0-h.1",
  "p0-i.1|p0-i.1",
  "p0-j.1|p0-j.1",
  "p0-k.1|p0-k.1",
  "p0-m.1|p0-m.1"
]);

type SqlValue = string | number | null;

function asString(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new Error(`Invalid persisted ${label}.`);
  }
  return value;
}

function asNumber(value: unknown, label: string) {
  if (typeof value !== "number") {
    throw new Error(`Invalid persisted ${label}.`);
  }
  return value;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function parsePublicKey(value: unknown): IdentityPublicKey {
  const parsed =
    typeof value === "string"
      ? (JSON.parse(value) as Record<string, unknown>)
      : null;

  if (
    !parsed ||
    parsed.kty !== "EC" ||
    parsed.crv !== "P-256" ||
    typeof parsed.x !== "string" ||
    typeof parsed.y !== "string"
  ) {
    throw new Error("Invalid persisted identity public key.");
  }

  return {
    kty: "EC",
    crv: "P-256",
    x: parsed.x,
    y: parsed.y,
    ext: typeof parsed.ext === "boolean" ? parsed.ext : undefined,
    key_ops: Array.isArray(parsed.key_ops)
      ? parsed.key_ops.filter((item): item is string => typeof item === "string")
      : undefined
  };
}

export class SQLiteRoomStore
  implements DurableRoomStore, DurableIdentityStore
{
  private readonly db: DatabaseSync;

  constructor(public readonly filename: string) {
    if (filename !== ":memory:") {
      mkdirSync(dirname(resolve(filename)), { recursive: true });
    }

    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    if (filename !== ":memory:") {
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = FULL;");
    }

    this.initialize();
  }

  close() {
    this.db.close();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL,
        version INTEGER NOT NULL,
        wire_schema_version TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS participants (
        room_id TEXT NOT NULL,
        participant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (room_id, participant_id),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS grant_receipts (
        grant_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        subject_participant_id TEXT NOT NULL,
        capability TEXT NOT NULL,
        issuer_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT,
        revoked_at TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS grant_revocations (
        revocation_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        grant_id TEXT NOT NULL,
        revoked_by_participant_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        revoked_at TEXT NOT NULL,
        UNIQUE (room_id, grant_id),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (grant_id) REFERENCES grant_receipts(grant_id)
      );

      CREATE TABLE IF NOT EXISTS work_items (
        work_item_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        requested_by TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        artifact_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        source_work_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        produced_by TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (source_work_id) REFERENCES work_items(work_item_id)
      );

      CREATE TABLE IF NOT EXISTS acceptance_receipts (
        receipt_id TEXT PRIMARY KEY,
        accept_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        actor_participant_id TEXT NOT NULL,
        authority_grant_id TEXT NOT NULL,
        committed_version INTEGER NOT NULL,
        accepted_at TEXT NOT NULL,
        UNIQUE (room_id, accept_id),
        UNIQUE (room_id, work_item_id),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id),
        FOREIGN KEY (artifact_id) REFERENCES artifacts(artifact_id),
        FOREIGN KEY (authority_grant_id) REFERENCES grant_receipts(grant_id)
      );

      CREATE TABLE IF NOT EXISTS authority_transfers (
        transfer_receipt_id TEXT PRIMARY KEY,
        transfer_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        from_participant_id TEXT NOT NULL,
        to_participant_id TEXT NOT NULL,
        revoked_grant_id TEXT NOT NULL,
        revocation_receipt_id TEXT NOT NULL,
        issued_grant_id TEXT NOT NULL,
        committed_version INTEGER NOT NULL,
        transferred_at TEXT NOT NULL,
        UNIQUE (room_id, transfer_id),
        UNIQUE (room_id, revoked_grant_id),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (revoked_grant_id) REFERENCES grant_receipts(grant_id),
        FOREIGN KEY (revocation_receipt_id) REFERENCES grant_revocations(revocation_id),
        FOREIGN KEY (issued_grant_id) REFERENCES grant_receipts(grant_id)
      );

      CREATE TABLE IF NOT EXISTS voice_authority_bootstraps (
        bootstrap_receipt_id TEXT PRIMARY KEY,
        bootstrap_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        actor_participant_id TEXT NOT NULL,
        accept_authority_grant_id TEXT NOT NULL,
        issued_grant_id TEXT NOT NULL,
        committed_version INTEGER NOT NULL,
        bootstrapped_at TEXT NOT NULL,
        UNIQUE (room_id, bootstrap_id),
        UNIQUE (room_id),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (accept_authority_grant_id) REFERENCES grant_receipts(grant_id),
        FOREIGN KEY (issued_grant_id) REFERENCES grant_receipts(grant_id)
      );

      CREATE TABLE IF NOT EXISTS agent_voice_grants (
        voice_grant_id TEXT PRIMARY KEY,
        grant_request_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        agent_participant_id TEXT NOT NULL,
        voice_id TEXT NOT NULL,
        audience_mode TEXT NOT NULL,
        issued_by_participant_id TEXT NOT NULL,
        authority_grant_id TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT,
        committed_version INTEGER NOT NULL,
        UNIQUE (room_id, grant_request_id),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (authority_grant_id) REFERENCES grant_receipts(grant_id)
      );

      CREATE TABLE IF NOT EXISTS agent_voice_revocations (
        voice_revocation_id TEXT PRIMARY KEY,
        revoke_request_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        voice_grant_id TEXT NOT NULL,
        revoked_by_participant_id TEXT NOT NULL,
        authority_grant_id TEXT NOT NULL,
        reason TEXT NOT NULL,
        revoked_at TEXT NOT NULL,
        committed_version INTEGER NOT NULL,
        UNIQUE (room_id, revoke_request_id),
        UNIQUE (room_id, voice_grant_id),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
        FOREIGN KEY (voice_grant_id) REFERENCES agent_voice_grants(voice_grant_id),
        FOREIGN KEY (authority_grant_id) REFERENCES grant_receipts(grant_id)
      );

      CREATE TABLE IF NOT EXISTS room_events (
        event_id TEXT PRIMARY KEY,
        room_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        type TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        UNIQUE (room_id, version),
        FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS identity_claims (
        participant_id TEXT PRIMARY KEY,
        public_key_jwk TEXT NOT NULL,
        recovery_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        rotated_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_room_events_room_version
        ON room_events(room_id, version);
      CREATE INDEX IF NOT EXISTS idx_work_items_room
        ON work_items(room_id);
      CREATE INDEX IF NOT EXISTS idx_artifacts_room
        ON artifacts(room_id);
      CREATE INDEX IF NOT EXISTS idx_grants_room_subject
        ON grant_receipts(room_id, subject_participant_id);
      CREATE INDEX IF NOT EXISTS idx_revocations_room
        ON grant_revocations(room_id);
      CREATE INDEX IF NOT EXISTS idx_transfers_room
        ON authority_transfers(room_id);
      CREATE INDEX IF NOT EXISTS idx_voice_grants_room_agent
        ON agent_voice_grants(room_id, agent_participant_id);
      CREATE INDEX IF NOT EXISTS idx_voice_revocations_room
        ON agent_voice_revocations(room_id);
    `);

    const getMeta = this.db.prepare(
      "SELECT value FROM schema_meta WHERE key = ?"
    );
    const storageRow = getMeta.get("storage_version") as
      | { value?: unknown }
      | undefined;
    const wireRow = getMeta.get("wire_schema_version") as
      | { value?: unknown }
      | undefined;

    if (!storageRow && !wireRow) {
      const insert = this.db.prepare(
        "INSERT INTO schema_meta(key, value) VALUES (?, ?)"
      );
      insert.run("storage_version", COMMONLINE_STORAGE_SCHEMA_VERSION);
      insert.run("wire_schema_version", COMMONLINE_WIRE_SCHEMA_VERSION);
      insert.run("created_at", new Date().toISOString());
      return;
    }

    const storageVersion = storageRow?.value;
    const wireVersion = wireRow?.value;

    if (
      MIGRATABLE_SCHEMA_PAIRS.has(
        `${String(storageVersion)}|${String(wireVersion)}`
      )
    ) {
      this.db.exec("BEGIN IMMEDIATE;");
      try {
        this.db
          .prepare("UPDATE schema_meta SET value = ? WHERE key = 'storage_version'")
          .run(COMMONLINE_STORAGE_SCHEMA_VERSION);
        this.db
          .prepare("UPDATE schema_meta SET value = ? WHERE key = 'wire_schema_version'")
          .run(COMMONLINE_WIRE_SCHEMA_VERSION);
        this.db
          .prepare(
            `INSERT INTO schema_meta(key, value) VALUES ('migrated_at', ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value`
          )
          .run(new Date().toISOString());
        this.db
          .prepare("UPDATE rooms SET wire_schema_version = ?")
          .run(COMMONLINE_WIRE_SCHEMA_VERSION);
        this.db.exec("COMMIT;");
      } catch (error) {
        this.db.exec("ROLLBACK;");
        throw error;
      }
      return;
    }

    if (storageVersion !== COMMONLINE_STORAGE_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported Commonline storage schema ${String(storageVersion)}; expected ${COMMONLINE_STORAGE_SCHEMA_VERSION}.`
      );
    }

    if (wireVersion !== COMMONLINE_WIRE_SCHEMA_VERSION) {
      throw new Error(
        `Stored wire schema ${String(wireVersion)} does not match runtime ${COMMONLINE_WIRE_SCHEMA_VERSION}.`
      );
    }
  }

  getIdentity(participantId: string): IdentityRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT participant_id, public_key_jwk, recovery_hash, created_at, rotated_at FROM identity_claims WHERE participant_id = ?"
      )
      .get(participantId) as Record<string, unknown> | undefined;

    if (!row) return undefined;

    return {
      participantId: asString(row.participant_id, "identity participant id"),
      publicKey: parsePublicKey(row.public_key_jwk),
      recoveryHash: asString(row.recovery_hash, "identity recovery hash"),
      createdAt: asString(row.created_at, "identity created_at"),
      rotatedAt: optionalString(row.rotated_at)
    };
  }

  enrollIdentity(record: IdentityRecord) {
    this.db
      .prepare(
        "INSERT INTO identity_claims(participant_id, public_key_jwk, recovery_hash, created_at, rotated_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(
        record.participantId,
        JSON.stringify(record.publicKey),
        record.recoveryHash,
        record.createdAt,
        record.rotatedAt ?? null
      );
  }

  rotateIdentity(input: {
    participantId: string;
    publicKey: IdentityPublicKey;
    recoveryHash: string;
    rotatedAt: string;
  }) {
    const result = this.db
      .prepare(
        "UPDATE identity_claims SET public_key_jwk = ?, recovery_hash = ?, rotated_at = ? WHERE participant_id = ?"
      )
      .run(
        JSON.stringify(input.publicKey),
        input.recoveryHash,
        input.rotatedAt,
        input.participantId
      );

    if (result.changes !== 1) {
      throw new Error("Identity rotation target does not exist.");
    }
  }

  loadRoom(roomId: string): RoomSnapshot | undefined {
    const roomRow = this.db
      .prepare(
        "SELECT room_id, purpose, version, wire_schema_version FROM rooms WHERE room_id = ?"
      )
      .get(roomId) as Record<string, unknown> | undefined;

    if (!roomRow) return undefined;

    if (roomRow.wire_schema_version !== COMMONLINE_WIRE_SCHEMA_VERSION) {
      throw new Error(
        `Room ${roomId} was stored with incompatible wire schema ${String(roomRow.wire_schema_version)}.`
      );
    }

    const participantRows = this.db
      .prepare(
        "SELECT participant_id, name, kind, role FROM participants WHERE room_id = ? ORDER BY rowid"
      )
      .all(roomId) as Record<string, unknown>[];

    const grantRows = this.db
      .prepare(
        "SELECT grant_id, subject_participant_id, capability, issuer_id, issued_at, expires_at, revoked_at FROM grant_receipts WHERE room_id = ? ORDER BY rowid"
      )
      .all(roomId) as Record<string, unknown>[];

    const revocationRows = this.db
      .prepare(
        "SELECT revocation_id, grant_id, revoked_by_participant_id, reason, revoked_at FROM grant_revocations WHERE room_id = ? ORDER BY rowid"
      )
      .all(roomId) as Record<string, unknown>[];

    const transferRows = this.db
      .prepare(
        "SELECT transfer_receipt_id, transfer_id, from_participant_id, to_participant_id, revoked_grant_id, revocation_receipt_id, issued_grant_id, committed_version, transferred_at FROM authority_transfers WHERE room_id = ? ORDER BY committed_version"
      )
      .all(roomId) as Record<string, unknown>[];

    const voiceBootstrapRows = this.db
      .prepare(
        "SELECT bootstrap_receipt_id, bootstrap_id, actor_participant_id, accept_authority_grant_id, issued_grant_id, committed_version, bootstrapped_at FROM voice_authority_bootstraps WHERE room_id = ? ORDER BY committed_version"
      )
      .all(roomId) as Record<string, unknown>[];

    const voiceGrantRows = this.db
      .prepare(
        "SELECT voice_grant_id, grant_request_id, agent_participant_id, voice_id, audience_mode, issued_by_participant_id, authority_grant_id, issued_at, expires_at, committed_version FROM agent_voice_grants WHERE room_id = ? ORDER BY committed_version"
      )
      .all(roomId) as Record<string, unknown>[];

    const voiceRevocationRows = this.db
      .prepare(
        "SELECT voice_revocation_id, revoke_request_id, voice_grant_id, revoked_by_participant_id, authority_grant_id, reason, revoked_at, committed_version FROM agent_voice_revocations WHERE room_id = ? ORDER BY committed_version"
      )
      .all(roomId) as Record<string, unknown>[];

    const workRows = this.db
      .prepare(
        "SELECT work_item_id, requested_by, prompt, status, created_at FROM work_items WHERE room_id = ? ORDER BY rowid"
      )
      .all(roomId) as Record<string, unknown>[];

    const artifactRows = this.db
      .prepare(
        "SELECT artifact_id, source_work_id, title, body, produced_by, status, created_at FROM artifacts WHERE room_id = ? ORDER BY rowid"
      )
      .all(roomId) as Record<string, unknown>[];

    const acceptanceRows = this.db
      .prepare(
        "SELECT receipt_id, accept_id, work_item_id, artifact_id, actor_participant_id, authority_grant_id, committed_version, accepted_at FROM acceptance_receipts WHERE room_id = ? ORDER BY committed_version"
      )
      .all(roomId) as Record<string, unknown>[];

    const participants: Participant[] = participantRows.map((row) => {
      const kind = asString(row.kind, "participant kind") as PrincipalKind;
      const role = asString(row.role, "participant role") as ParticipantRole;
      return {
        id: asString(row.participant_id, "participant id"),
        name: asString(row.name, "participant name"),
        kind,
        role,
        presence:
          kind === "agent" && role === "silent-worker" ? "online" : "offline"
      };
    });

    const grants: GrantReceipt[] = grantRows.map((row) => ({
      grantId: asString(row.grant_id, "grant id"),
      roomId,
      subjectParticipantId: asString(
        row.subject_participant_id,
        "grant subject"
      ),
      capability: asString(row.capability, "capability") as Capability,
      issuerId: asString(row.issuer_id, "grant issuer"),
      issuedAt: asString(row.issued_at, "grant issued_at"),
      expiresAt: optionalString(row.expires_at),
      revokedAt: optionalString(row.revoked_at)
    }));

    const grantRevocations: GrantRevocationReceipt[] = revocationRows.map(
      (row) => ({
        revocationId: asString(row.revocation_id, "revocation id"),
        roomId,
        grantId: asString(row.grant_id, "revoked grant id"),
        revokedByParticipantId: asString(
          row.revoked_by_participant_id,
          "revocation actor"
        ),
        reason: asString(
          row.reason,
          "revocation reason"
        ) as GrantRevocationReceipt["reason"],
        revokedAt: asString(row.revoked_at, "revocation time")
      })
    );

    const authorityTransfers: AuthorityTransferReceipt[] = transferRows.map(
      (row) => ({
        transferReceiptId: asString(
          row.transfer_receipt_id,
          "transfer receipt id"
        ),
        transferId: asString(row.transfer_id, "transfer id"),
        roomId,
        fromParticipantId: asString(
          row.from_participant_id,
          "transfer from participant"
        ),
        toParticipantId: asString(
          row.to_participant_id,
          "transfer to participant"
        ),
        revokedGrantId: asString(row.revoked_grant_id, "revoked grant id"),
        revocationReceiptId: asString(
          row.revocation_receipt_id,
          "revocation receipt id"
        ),
        issuedGrantId: asString(row.issued_grant_id, "issued grant id"),
        committedVersion: asNumber(
          row.committed_version,
          "transfer committed version"
        ),
        transferredAt: asString(row.transferred_at, "transfer time")
      })
    );

    const voiceAuthorityBootstraps: VoiceAuthorityBootstrapReceipt[] =
      voiceBootstrapRows.map((row) => ({
        bootstrapReceiptId: asString(
          row.bootstrap_receipt_id,
          "voice bootstrap receipt id"
        ),
        bootstrapId: asString(row.bootstrap_id, "voice bootstrap id"),
        roomId,
        actorParticipantId: asString(
          row.actor_participant_id,
          "voice bootstrap actor"
        ),
        acceptAuthorityGrantId: asString(
          row.accept_authority_grant_id,
          "voice bootstrap ACCEPT_OUTCOME grant"
        ),
        issuedGrantId: asString(
          row.issued_grant_id,
          "voice management issued grant"
        ),
        committedVersion: asNumber(
          row.committed_version,
          "voice bootstrap committed version"
        ),
        bootstrappedAt: asString(
          row.bootstrapped_at,
          "voice bootstrap time"
        )
      }));

    const agentVoiceGrants: AgentVoiceGrantReceipt[] =
      voiceGrantRows.map((row) => ({
        voiceGrantId: asString(row.voice_grant_id, "voice grant id"),
        grantRequestId: asString(
          row.grant_request_id,
          "voice grant request id"
        ),
        roomId,
        agentParticipantId: asString(
          row.agent_participant_id,
          "voice grant agent"
        ),
        voiceId: asString(row.voice_id, "voice id"),
        audienceMode: asString(
          row.audience_mode,
          "voice audience mode"
        ) as "explicit-subscription",
        issuedByParticipantId: asString(
          row.issued_by_participant_id,
          "voice grant issuer"
        ),
        authorityGrantId: asString(
          row.authority_grant_id,
          "voice grant authority"
        ),
        issuedAt: asString(row.issued_at, "voice grant issued_at"),
        expiresAt: optionalString(row.expires_at),
        committedVersion: asNumber(
          row.committed_version,
          "voice grant committed version"
        )
      }));

    const agentVoiceRevocations: AgentVoiceRevocationReceipt[] =
      voiceRevocationRows.map((row) => ({
        voiceRevocationId: asString(
          row.voice_revocation_id,
          "voice revocation id"
        ),
        revokeRequestId: asString(
          row.revoke_request_id,
          "voice revoke request id"
        ),
        roomId,
        voiceGrantId: asString(
          row.voice_grant_id,
          "revoked voice grant id"
        ),
        revokedByParticipantId: asString(
          row.revoked_by_participant_id,
          "voice revocation actor"
        ),
        authorityGrantId: asString(
          row.authority_grant_id,
          "voice revocation authority"
        ),
        reason: asString(
          row.reason,
          "voice revocation reason"
        ) as "manual",
        revokedAt: asString(row.revoked_at, "voice revoked_at"),
        committedVersion: asNumber(
          row.committed_version,
          "voice revocation committed version"
        )
      }));

    const workItems: WorkItem[] = workRows.map((row) => ({
      id: asString(row.work_item_id, "work item id"),
      requestedBy: asString(row.requested_by, "work requested_by"),
      prompt: asString(row.prompt, "work prompt"),
      status: asString(row.status, "work status") as WorkStatus,
      createdAt: asString(row.created_at, "work created_at")
    }));

    const artifacts: Artifact[] = artifactRows.map((row) => ({
      id: asString(row.artifact_id, "artifact id"),
      sourceWorkId: asString(row.source_work_id, "artifact source_work_id"),
      title: asString(row.title, "artifact title"),
      body: asString(row.body, "artifact body"),
      producedBy: asString(row.produced_by, "artifact produced_by"),
      status: asString(row.status, "artifact status") as Artifact["status"],
      createdAt: asString(row.created_at, "artifact created_at")
    }));

    const acceptances: AcceptanceReceipt[] = acceptanceRows.map((row) => ({
      receiptId: asString(row.receipt_id, "acceptance receipt id"),
      acceptId: asString(row.accept_id, "accept id"),
      roomId,
      workItemId: asString(row.work_item_id, "acceptance work item id"),
      artifactId: asString(row.artifact_id, "acceptance artifact id"),
      actorParticipantId: asString(
        row.actor_participant_id,
        "acceptance actor"
      ),
      authorityGrantId: asString(
        row.authority_grant_id,
        "acceptance authority grant"
      ),
      committedVersion: asNumber(
        row.committed_version,
        "acceptance committed version"
      ),
      acceptedAt: asString(row.accepted_at, "acceptance accepted_at")
    }));

    return {
      schemaVersion: COMMONLINE_WIRE_SCHEMA_VERSION,
      roomId,
      purpose: asString(roomRow.purpose, "room purpose"),
      version: asNumber(roomRow.version, "room version"),
      episodeActive: false,
      participants,
      grants,
      grantRevocations,
      authorityTransfers,
      voiceAuthorityBootstraps,
      agentVoiceGrants,
      agentVoiceRevocations,
      workItems,
      artifacts,
      acceptances
    };
  }

  loadEvents(roomId: string): RoomEvent[] {
    const rows = this.db
      .prepare(
        "SELECT event_id, version, type, actor_id, summary, occurred_at FROM room_events WHERE room_id = ? ORDER BY version"
      )
      .all(roomId) as Record<string, unknown>[];

    return rows.map((row) => ({
      id: asString(row.event_id, "event id"),
      roomId,
      version: asNumber(row.version, "event version"),
      type: asString(row.type, "event type") as RoomEventType,
      actorId: asString(row.actor_id, "event actor"),
      summary: asString(row.summary, "event summary"),
      occurredAt: asString(row.occurred_at, "event occurred_at")
    }));
  }

  saveTransition(input: {
    room: RoomSnapshot;
    event: RoomEvent;
    expectedPreviousVersion: number;
  }) {
    this.db.exec("BEGIN IMMEDIATE;");
    try {
      const existing = this.db
        .prepare("SELECT version FROM rooms WHERE room_id = ?")
        .get(input.room.roomId) as { version?: unknown } | undefined;

      const actualVersion =
        existing === undefined
          ? null
          : asNumber(existing.version, "room version");

      if (
        (actualVersion === null && input.expectedPreviousVersion !== 0) ||
        (actualVersion !== null &&
          actualVersion !== input.expectedPreviousVersion)
      ) {
        throw new PersistenceConflictError(
          input.room.roomId,
          input.expectedPreviousVersion,
          actualVersion
        );
      }

      this.db
        .prepare(
          `INSERT INTO rooms(room_id, purpose, version, wire_schema_version, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(room_id) DO UPDATE SET
             purpose = excluded.purpose,
             version = excluded.version,
             wire_schema_version = excluded.wire_schema_version,
             updated_at = excluded.updated_at`
        )
        .run(
          input.room.roomId,
          input.room.purpose,
          input.room.version,
          input.room.schemaVersion,
          new Date().toISOString()
        );

      this.db
        .prepare("DELETE FROM agent_voice_revocations WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM agent_voice_grants WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM voice_authority_bootstraps WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM authority_transfers WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM grant_revocations WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM acceptance_receipts WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM artifacts WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM work_items WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM grant_receipts WHERE room_id = ?")
        .run(input.room.roomId);
      this.db
        .prepare("DELETE FROM participants WHERE room_id = ?")
        .run(input.room.roomId);

      const insertParticipant = this.db.prepare(
        "INSERT INTO participants(room_id, participant_id, name, kind, role) VALUES (?, ?, ?, ?, ?)"
      );
      for (const participant of input.room.participants) {
        insertParticipant.run(
          input.room.roomId,
          participant.id,
          participant.name,
          participant.kind,
          participant.role
        );
      }

      const insertGrant = this.db.prepare(
        "INSERT INTO grant_receipts(grant_id, room_id, subject_participant_id, capability, issuer_id, issued_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const grant of input.room.grants) {
        insertGrant.run(
          grant.grantId,
          input.room.roomId,
          grant.subjectParticipantId,
          grant.capability,
          grant.issuerId,
          grant.issuedAt,
          grant.expiresAt ?? null,
          grant.revokedAt ?? null
        );
      }

      const insertRevocation = this.db.prepare(
        "INSERT INTO grant_revocations(revocation_id, room_id, grant_id, revoked_by_participant_id, reason, revoked_at) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const revocation of input.room.grantRevocations) {
        insertRevocation.run(
          revocation.revocationId,
          input.room.roomId,
          revocation.grantId,
          revocation.revokedByParticipantId,
          revocation.reason,
          revocation.revokedAt
        );
      }

      const insertVoiceBootstrap = this.db.prepare(
        "INSERT INTO voice_authority_bootstraps(bootstrap_receipt_id, bootstrap_id, room_id, actor_participant_id, accept_authority_grant_id, issued_grant_id, committed_version, bootstrapped_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const receipt of input.room.voiceAuthorityBootstraps) {
        insertVoiceBootstrap.run(
          receipt.bootstrapReceiptId,
          receipt.bootstrapId,
          input.room.roomId,
          receipt.actorParticipantId,
          receipt.acceptAuthorityGrantId,
          receipt.issuedGrantId,
          receipt.committedVersion,
          receipt.bootstrappedAt
        );
      }

      const insertVoiceGrant = this.db.prepare(
        "INSERT INTO agent_voice_grants(voice_grant_id, grant_request_id, room_id, agent_participant_id, voice_id, audience_mode, issued_by_participant_id, authority_grant_id, issued_at, expires_at, committed_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const receipt of input.room.agentVoiceGrants) {
        insertVoiceGrant.run(
          receipt.voiceGrantId,
          receipt.grantRequestId,
          input.room.roomId,
          receipt.agentParticipantId,
          receipt.voiceId,
          receipt.audienceMode,
          receipt.issuedByParticipantId,
          receipt.authorityGrantId,
          receipt.issuedAt,
          receipt.expiresAt ?? null,
          receipt.committedVersion
        );
      }

      const insertVoiceRevocation = this.db.prepare(
        "INSERT INTO agent_voice_revocations(voice_revocation_id, revoke_request_id, room_id, voice_grant_id, revoked_by_participant_id, authority_grant_id, reason, revoked_at, committed_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const receipt of input.room.agentVoiceRevocations) {
        insertVoiceRevocation.run(
          receipt.voiceRevocationId,
          receipt.revokeRequestId,
          input.room.roomId,
          receipt.voiceGrantId,
          receipt.revokedByParticipantId,
          receipt.authorityGrantId,
          receipt.reason,
          receipt.revokedAt,
          receipt.committedVersion
        );
      }

      const insertWork = this.db.prepare(
        "INSERT INTO work_items(work_item_id, room_id, requested_by, prompt, status, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const work of input.room.workItems) {
        insertWork.run(
          work.id,
          input.room.roomId,
          work.requestedBy,
          work.prompt,
          work.status,
          work.createdAt
        );
      }

      const insertArtifact = this.db.prepare(
        "INSERT INTO artifacts(artifact_id, room_id, source_work_id, title, body, produced_by, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const artifact of input.room.artifacts) {
        insertArtifact.run(
          artifact.id,
          input.room.roomId,
          artifact.sourceWorkId,
          artifact.title,
          artifact.body,
          artifact.producedBy,
          artifact.status,
          artifact.createdAt
        );
      }

      const insertAcceptance = this.db.prepare(
        "INSERT INTO acceptance_receipts(receipt_id, accept_id, room_id, work_item_id, artifact_id, actor_participant_id, authority_grant_id, committed_version, accepted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const receipt of input.room.acceptances) {
        insertAcceptance.run(
          receipt.receiptId,
          receipt.acceptId,
          input.room.roomId,
          receipt.workItemId,
          receipt.artifactId,
          receipt.actorParticipantId,
          receipt.authorityGrantId,
          receipt.committedVersion,
          receipt.acceptedAt
        );
      }

      const insertTransfer = this.db.prepare(
        "INSERT INTO authority_transfers(transfer_receipt_id, transfer_id, room_id, from_participant_id, to_participant_id, revoked_grant_id, revocation_receipt_id, issued_grant_id, committed_version, transferred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      for (const transfer of input.room.authorityTransfers) {
        insertTransfer.run(
          transfer.transferReceiptId,
          transfer.transferId,
          input.room.roomId,
          transfer.fromParticipantId,
          transfer.toParticipantId,
          transfer.revokedGrantId,
          transfer.revocationReceiptId,
          transfer.issuedGrantId,
          transfer.committedVersion,
          transfer.transferredAt
        );
      }

      this.db
        .prepare(
          "INSERT INTO room_events(event_id, room_id, version, type, actor_id, summary, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(
          input.event.id,
          input.event.roomId,
          input.event.version,
          input.event.type,
          input.event.actorId,
          input.event.summary,
          input.event.occurredAt
        );

      this.db.exec("COMMIT;");
    } catch (error) {
      this.db.exec("ROLLBACK;");
      throw error;
    }
  }

  metadata() {
    const rows = this.db
      .prepare("SELECT key, value FROM schema_meta ORDER BY key")
      .all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  durableDebugRows(): Record<string, Record<string, SqlValue>[]> {
    const tables = [
      "schema_meta",
      "rooms",
      "participants",
      "grant_receipts",
      "grant_revocations",
      "work_items",
      "artifacts",
      "acceptance_receipts",
      "authority_transfers",
      "voice_authority_bootstraps",
      "agent_voice_grants",
      "agent_voice_revocations",
      "room_events",
      "identity_claims"
    ];

    return Object.fromEntries(
      tables.map((table) => [
        table,
        this.db.prepare(`SELECT * FROM ${table}`).all() as Record<
          string,
          SqlValue
        >[]
      ])
    );
  }
}
