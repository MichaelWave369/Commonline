export const COMMONLINE_WIRE_SCHEMA_VERSION = "p0-h.1" as const;
export type CommonlineWireSchemaVersion = typeof COMMONLINE_WIRE_SCHEMA_VERSION;

export type PrincipalKind = "human" | "agent" | "service" | "device";
export type PresenceState = "online" | "offline";
export type ParticipantRole =
  | "steward"
  | "participant"
  | "observer"
  | "silent-worker";
export type RequestedHumanRole = "participant" | "observer";

export type WorkStatus =
  | "offered"
  | "working"
  | "proposed"
  | "accepted"
  | "failed"
  | "canceled";

export type ArtifactStatus = "proposed" | "accepted";

export interface Participant {
  id: string;
  name: string;
  kind: PrincipalKind;
  role: ParticipantRole;
  /**
   * Presence is a projection of active sessions. It is not identity.
   */
  presence: PresenceState;
}

export interface WorkItem {
  id: string;
  requestedBy: string;
  prompt: string;
  status: WorkStatus;
  createdAt: string;
}

export interface Artifact {
  id: string;
  sourceWorkId: string;
  title: string;
  body: string;
  producedBy: string;
  status: ArtifactStatus;
  createdAt: string;
}

export type Capability =
  | "READ_ROOM_STATE"
  | "READ_SELECTED_CONTEXT"
  | "WRITE_DRAFT_ARTIFACT"
  | "SUBMIT_WORK"
  | "ACCEPT_OUTCOME"
  | "RECEIVE_MEDIA"
  | "SPEAK"
  | "EXECUTE_EXTERNAL_EFFECT";

export interface GrantReceipt {
  grantId: string;
  roomId: string;
  subjectParticipantId: string;
  capability: Capability;
  issuerId: string;
  issuedAt: string;
  expiresAt?: string;
  /**
   * Legacy P0-d compatibility field. P0-f records revocation as a separate
   * immutable GrantRevocationReceipt instead of mutating this receipt.
   */
  revokedAt?: string;
}

export interface GrantRevocationReceipt {
  revocationId: string;
  roomId: string;
  grantId: string;
  revokedByParticipantId: string;
  reason: "authority-transfer" | "manual";
  revokedAt: string;
}

export interface AuthorityTransferReceipt {
  transferReceiptId: string;
  transferId: string;
  roomId: string;
  fromParticipantId: string;
  toParticipantId: string;
  revokedGrantId: string;
  revocationReceiptId: string;
  issuedGrantId: string;
  committedVersion: number;
  transferredAt: string;
}

export interface AcceptanceReceipt {
  receiptId: string;
  acceptId: string;
  roomId: string;
  workItemId: string;
  artifactId: string;
  actorParticipantId: string;
  authorityGrantId: string;
  committedVersion: number;
  acceptedAt: string;
}

export interface RoomSnapshot {
  schemaVersion: CommonlineWireSchemaVersion;
  roomId: string;
  purpose: string;
  version: number;
  episodeActive: boolean;
  participants: Participant[];
  grants: GrantReceipt[];
  grantRevocations: GrantRevocationReceipt[];
  authorityTransfers: AuthorityTransferReceipt[];
  workItems: WorkItem[];
  artifacts: Artifact[];
  acceptances: AcceptanceReceipt[];
}

export type RoomEventType =
  | "participant_joined"
  | "participant_left"
  | "work_submitted"
  | "artifact_proposed"
  | "artifact_accepted"
  | "accept_authority_transferred";

export interface RoomEvent {
  id: string;
  roomId: string;
  version: number;
  type: RoomEventType;
  actorId: string;
  summary: string;
  occurredAt: string;
}

export type AgentWorkState =
  | "idle"
  | "working"
  | "waiting"
  | "blocked"
  | "completed"
  | "failed";

export interface IdentityPublicKey {
  [key: string]: string | string[] | boolean | undefined;
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
  ext?: boolean;
  key_ops?: string[];
}

export type IdentityChallengePurpose = "enroll" | "authenticate";

export interface IdentityBeginMessage {
  type: "identity_begin";
  requestId: string;
  schemaVersion: CommonlineWireSchemaVersion;
  participantId: string;
  sessionId: string;
  publicKey?: IdentityPublicKey;
}

export interface IdentityProveMessage {
  type: "identity_prove";
  requestId: string;
  challengeId: string;
  signature: string;
}

export interface IdentityRecoverMessage {
  type: "identity_recover";
  requestId: string;
  schemaVersion: CommonlineWireSchemaVersion;
  participantId: string;
  sessionId: string;
  recoveryCode: string;
  newPublicKey: IdentityPublicKey;
}

export interface JoinRoomMessage {
  type: "join_room";
  requestId: string;
  schemaVersion: CommonlineWireSchemaVersion;
  roomId: string;
  participantId: string;
  sessionId: string;
  name: string;
  requestedRole: RequestedHumanRole;
  acknowledgedVersion: number;
}

export interface SubmitWorkMessage {
  type: "submit_work";
  requestId: string;
  roomId: string;
  baseVersion: number;
  prompt: string;
}

export interface AcceptOutcomeMessage {
  type: "accept_outcome";
  requestId: string;
  roomId: string;
  baseVersion: number;
  acceptId: string;
  workItemId: string;
  artifactId: string;
  authorityGrantId: string;
}

export interface TransferAcceptAuthorityMessage {
  type: "transfer_accept_authority";
  requestId: string;
  roomId: string;
  baseVersion: number;
  transferId: string;
  targetParticipantId: string;
  authorityGrantId: string;
}

export interface RtcIceServerConfig {
  urls: string[];
  username?: string;
  credential?: string;
}

export type RtcCredentialMode =
  | "none"
  | "static-env"
  | "ephemeral-rest";

export interface RtcConfigRequestMessage {
  type: "rtc_config_request";
  requestId: string;
  roomId: string;
}

export interface RtcConfigMessage {
  type: "rtc_config";
  requestId: string;
  roomId: string;
  iceServers: RtcIceServerConfig[];
  iceTransportPolicy: "all" | "relay";
  credentialMode: RtcCredentialMode;
  expiresAt?: string;
}

export interface RtcCallOpenMessage {
  type: "rtc_call_open";
  requestId: string;
  roomId: string;
  targetParticipantId: string;
}

export interface RtcCallSessionMessage {
  type: "rtc_call_session";
  requestId: string;
  roomId: string;
  callId: string;
  generation: number;
  peerParticipantId: string;
  initiatorParticipantId: string;
  polite: boolean;
  createdAt: string;
}

export type RtcSignalPayload =
  | {
      kind: "offer" | "answer";
      sdp: string;
    }
  | {
      kind: "ice";
      candidate: string;
      sdpMid?: string | null;
      sdpMLineIndex?: number | null;
      usernameFragment?: string | null;
    }
  | {
      kind: "hangup";
      reason?: "ended" | "declined" | "failed" | "peer-left" | "superseded";
    };

export interface RtcSignalClientMessage {
  type: "rtc_signal";
  requestId: string;
  roomId: string;
  callId: string;
  generation: number;
  targetParticipantId: string;
  signal: RtcSignalPayload;
}

export type ClientMessage =
  | IdentityBeginMessage
  | IdentityProveMessage
  | IdentityRecoverMessage
  | JoinRoomMessage
  | SubmitWorkMessage
  | AcceptOutcomeMessage
  | TransferAcceptAuthorityMessage
  | RtcConfigRequestMessage
  | RtcCallOpenMessage
  | RtcSignalClientMessage;

export interface IdentityChallengeMessage {
  type: "identity_challenge";
  requestId: string;
  challengeId: string;
  participantId: string;
  sessionId: string;
  nonce: string;
  purpose: IdentityChallengePurpose;
  expiresAt: string;
}

export interface IdentityAuthenticatedMessage {
  type: "identity_authenticated";
  requestId: string;
  participantId: string;
  sessionId: string;
  enrolled: boolean;
  recovered: boolean;
  /**
   * Returned only on initial enrollment or recovery rotation. The server
   * stores only a hash and cannot show this code again later.
   */
  recoveryCode?: string;
}

export interface RoomSnapshotMessage {
  type: "room_snapshot";
  requestId: string;
  room: RoomSnapshot;
  resumeDelta: RoomEvent[];
}

export interface RoomEventMessage {
  type: "room_event";
  room: RoomSnapshot;
  event: RoomEvent;
}

export interface AcceptanceReceiptMessage {
  type: "acceptance_receipt";
  requestId: string;
  room: RoomSnapshot;
  receipt: AcceptanceReceipt;
  replayed: boolean;
}

export interface AuthorityTransferReceiptMessage {
  type: "authority_transfer_receipt";
  requestId: string;
  room: RoomSnapshot;
  receipt: AuthorityTransferReceipt;
  replayed: boolean;
}

export interface AgentWorkStatusMessage {
  type: "agent_work_status";
  roomId: string;
  participantId: string;
  workItemId: string;
  state: AgentWorkState;
}

export interface RtcSignalRelayMessage {
  type: "rtc_signal";
  requestId: string;
  roomId: string;
  callId: string;
  generation: number;
  fromParticipantId: string;
  signal: RtcSignalPayload;
}

export type RejectionCode =
  | "STALE_VERSION"
  | "NOT_AUTHORIZED"
  | "ROOM_NOT_FOUND"
  | "INVALID_INTENT"
  | "INVALID_SESSION"
  | "ARTIFACT_NOT_FOUND"
  | "WORK_ITEM_NOT_FOUND"
  | "GRANT_NOT_FOUND"
  | "OUTCOME_ALREADY_ACCEPTED"
  | "PEER_UNAVAILABLE"
  | "SCHEMA_VERSION_MISMATCH"
  | "IDENTITY_REQUIRED"
  | "IDENTITY_NOT_FOUND"
  | "IDENTITY_CHALLENGE_INVALID"
  | "IDENTITY_PROOF_INVALID"
  | "IDENTITY_RECOVERY_INVALID"
  | "TRANSFER_TARGET_INVALID"
  | "TRANSFER_ALREADY_APPLIED"
  | "MEDIA_BUSY"
  | "MEDIA_SESSION_STALE";

export interface IntentRejectedMessage {
  type: "intent_rejected";
  requestId: string;
  code: RejectionCode;
  message: string;
  expectedVersion?: number;
  room?: RoomSnapshot;
  canonicalAcceptance?: AcceptanceReceipt;
  canonicalTransfer?: AuthorityTransferReceipt;
}

export type ServerMessage =
  | IdentityChallengeMessage
  | IdentityAuthenticatedMessage
  | RoomSnapshotMessage
  | RoomEventMessage
  | AcceptanceReceiptMessage
  | AuthorityTransferReceiptMessage
  | AgentWorkStatusMessage
  | RtcConfigMessage
  | RtcCallSessionMessage
  | RtcSignalRelayMessage
  | IntentRejectedMessage;
