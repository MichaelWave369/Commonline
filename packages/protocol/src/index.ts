export const COMMONLINE_WIRE_SCHEMA_VERSION = "p0-v.1" as const;
export type CommonlineWireSchemaVersion = typeof COMMONLINE_WIRE_SCHEMA_VERSION;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

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
  | "MANAGE_AGENT_VOICE"
  | "DELEGATE_CONTEXT"
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

export interface VoiceAuthorityBootstrapReceipt {
  bootstrapReceiptId: string;
  bootstrapId: string;
  roomId: string;
  actorParticipantId: string;
  acceptAuthorityGrantId: string;
  issuedGrantId: string;
  committedVersion: number;
  bootstrappedAt: string;
}

export interface AgentVoiceGrantReceipt {
  voiceGrantId: string;
  grantRequestId: string;
  roomId: string;
  agentParticipantId: string;
  voiceId: string;
  audienceMode: "explicit-subscription";
  issuedByParticipantId: string;
  authorityGrantId: string;
  issuedAt: string;
  expiresAt?: string;
  committedVersion: number;
}

export interface AgentVoiceRevocationReceipt {
  voiceRevocationId: string;
  revokeRequestId: string;
  roomId: string;
  voiceGrantId: string;
  revokedByParticipantId: string;
  authorityGrantId: string;
  reason: "manual";
  revokedAt: string;
  committedVersion: number;
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
  voiceAuthorityBootstraps: VoiceAuthorityBootstrapReceipt[];
  agentVoiceGrants: AgentVoiceGrantReceipt[];
  agentVoiceRevocations: AgentVoiceRevocationReceipt[];
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
  | "accept_authority_transferred"
  | "voice_authority_bootstrapped"
  | "agent_voice_granted"
  | "agent_voice_revoked";

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

export type ExternalEffectKind = "demo-marker";

export interface RequestExternalEffectMessage {
  type: "request_external_effect";
  requestId: string;
  roomId: string;
  baseVersion: number;
  effectRequestId: string;
  artifactId: string;
  authorityGrantId: string;
  kind: ExternalEffectKind;
  target: "local-proof-sink";
}

export type ContextDelegationKind = "accepted-artifact-summary";

export interface RequestContextDelegationMessage {
  type: "request_context_delegation";
  requestId: string;
  roomId: string;
  baseVersion: number;
  delegationRequestId: string;
  artifactId: string;
  authorityGrantId: string;
  kind: ContextDelegationKind;
  target: "local-delegation-proof-sink";
  purpose: "comparison-review";
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

export interface BootstrapAgentVoiceAuthorityMessage {
  type: "bootstrap_agent_voice_authority";
  requestId: string;
  roomId: string;
  baseVersion: number;
  bootstrapId: string;
  acceptAuthorityGrantId: string;
}

export interface GrantAgentVoiceMessage {
  type: "grant_agent_voice";
  requestId: string;
  roomId: string;
  baseVersion: number;
  grantRequestId: string;
  agentParticipantId: string;
  voiceId: string;
  authorityGrantId: string;
  expiresAt?: string;
}

export interface RevokeAgentVoiceMessage {
  type: "revoke_agent_voice";
  requestId: string;
  roomId: string;
  baseVersion: number;
  revokeRequestId: string;
  voiceGrantId: string;
  authorityGrantId: string;
}

export type AgentVoiceUtteranceKind = "authority-proof";

export interface RequestAgentVoiceUtteranceMessage {
  type: "request_agent_voice_utterance";
  requestId: string;
  roomId: string;
  agentParticipantId: string;
  voiceGrantId: string;
  authorityGrantId: string;
  utteranceKind: AgentVoiceUtteranceKind;
}

export type AttentionLeaseMode = "one-turn";
export type AttentionLeaseState =
  | "active"
  | "consumed"
  | "revoked"
  | "expired";

export interface AttentionLease {
  leaseId: string;
  roomId: string;
  agentParticipantId: string;
  grantedByParticipantId: string;
  mode: AttentionLeaseMode;
  state: AttentionLeaseState;
  issuedAt: string;
  expiresAt: string;
  maxTurns: 1;
  turnsConsumed: 0 | 1;
}

export interface GrantAttentionLeaseMessage {
  type: "grant_attention_lease";
  requestId: string;
  roomId: string;
  agentParticipantId: string;
}

export interface RevokeAttentionLeaseMessage {
  type: "revoke_attention_lease";
  requestId: string;
  roomId: string;
  leaseId: string;
}

export interface RequestAgentTurnMessage {
  type: "request_agent_turn";
  requestId: string;
  roomId: string;
  turnRequestId: string;
  attentionLeaseId: string;
  agentParticipantId: string;
  prompt: string;
}

export type ListeningShareLeaseState =
  | "active"
  | "consumed"
  | "revoked"
  | "expired";

export interface ListeningShareLease {
  leaseId: string;
  roomId: string;
  humanParticipantId: string;
  agentParticipantId: string;
  state: ListeningShareLeaseState;
  issuedAt: string;
  expiresAt: string;
  maxDurationMs: 5000;
}

export interface GrantListeningShareMessage {
  type: "grant_listening_share";
  requestId: string;
  roomId: string;
  agentParticipantId: string;
}

export interface RevokeListeningShareMessage {
  type: "revoke_listening_share";
  requestId: string;
  roomId: string;
  leaseId: string;
}

export interface SubmitListeningShareMessage {
  type: "submit_listening_share";
  requestId: string;
  roomId: string;
  shareId: string;
  leaseId: string;
  agentParticipantId: string;
  sampleRate: 16000;
  sampleCount: number;
  pcm16Base64: string;
}

export type ConversationExchangeState =
  | "heard"
  | "responded"
  | "expired";

export interface ConversationExchange {
  exchangeId: string;
  roomId: string;
  humanParticipantId: string;
  agentParticipantId: string;
  listeningShareId: string;
  state: ConversationExchangeState;
  createdAt: string;
  expiresAt: string;
}

export interface RequestExchangeResponseMessage {
  type: "request_exchange_response";
  requestId: string;
  roomId: string;
  exchangeId: string;
  attentionLeaseId: string;
  agentParticipantId: string;
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

export type GroupMediaRouterMode = "mediasoup-p0";

export interface GroupMediaParticipant {
  participantId: string;
  joinedAt: string;
}

export type MediaSourceKind =
  | "human-microphone"
  | "sound-effect"
  | "shared-music"
  | "agent-voice"
  | "system-tone";

export type MediaSourceExecutionState = "executable" | "reserved";

export type MediaSourceAuthorityRequirement =
  | "SPEAK"
  | "AGENT_VOICE_GRANT"
  | "SERVICE_POLICY";

export interface MediaSourcePolicy {
  policyId: string;
  kind: MediaSourceKind;
  requiredAuthority: MediaSourceAuthorityRequirement;
  allowedPublisherKinds: PrincipalKind[];
  audienceMode: "explicit-subscription";
  retention: "ephemeral";
  recordingDefault: "not-authorized";
  maxInstancesPerPublisher: number;
  executionState: MediaSourceExecutionState;
}

export interface GroupMediaSource {
  sourceId: string;
  ownerParticipantId: string;
  kind: MediaSourceKind;
  label: string;
  policyId: string;
  publishedAt: string;
}

export interface GroupMediaSubscription {
  subscriberParticipantId: string;
  sourceId: string;
  createdAt: string;
}

export interface GroupMediaJoinMessage {
  type: "group_media_join";
  requestId: string;
  roomId: string;
}

export interface GroupMediaLeaveMessage {
  type: "group_media_leave";
  requestId: string;
  roomId: string;
}

export interface GroupMediaPublishSourceMessage {
  type: "group_media_publish_source";
  requestId: string;
  roomId: string;
  kind: MediaSourceKind;
  label: string;
}

export interface GroupMediaUnpublishMessage {
  type: "group_media_unpublish";
  requestId: string;
  roomId: string;
  sourceId: string;
}

export interface GroupMediaSubscribeMessage {
  type: "group_media_subscribe";
  requestId: string;
  roomId: string;
  sourceId: string;
}

export interface GroupMediaUnsubscribeMessage {
  type: "group_media_unsubscribe";
  requestId: string;
  roomId: string;
  sourceId: string;
}

export interface GroupMediaStateMessage {
  type: "group_media_state";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  routerMode: GroupMediaRouterMode;
  maxParticipants: number;
  participants: GroupMediaParticipant[];
  sourcePolicies: MediaSourcePolicy[];
  sources: GroupMediaSource[];
  subscriptions: GroupMediaSubscription[];
}

export type SfuTransportDirection = "send" | "recv";

export interface SfuCapabilitiesRequestMessage {
  type: "sfu_capabilities_request";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
}

export interface SfuTransportCreateMessage {
  type: "sfu_transport_create";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  direction: SfuTransportDirection;
}

export interface SfuTransportConnectMessage {
  type: "sfu_transport_connect";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  transportId: string;
  dtlsParameters: JsonObject;
}

export interface SfuProduceMessage {
  type: "sfu_produce";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  transportId: string;
  sourceId: string;
  kind: "audio";
  rtpParameters: JsonObject;
  appData?: JsonObject;
}

export interface SfuConsumeMessage {
  type: "sfu_consume";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  transportId: string;
  sourceId: string;
  rtpCapabilities: JsonObject;
}

export interface SfuConsumerResumeMessage {
  type: "sfu_consumer_resume";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  consumerId: string;
}

export interface SfuCapabilitiesMessage {
  type: "sfu_capabilities";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  routerRtpCapabilities: JsonObject;
}

export interface SfuTransportOptions {
  id: string;
  iceParameters: JsonObject;
  iceCandidates: JsonObject[];
  dtlsParameters: JsonObject;
  sctpParameters?: JsonObject;
}

export interface SfuTransportCreatedMessage {
  type: "sfu_transport_created";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  direction: SfuTransportDirection;
  transport: SfuTransportOptions;
}

export interface SfuTransportConnectedMessage {
  type: "sfu_transport_connected";
  requestId: string;
  roomId: string;
  transportId: string;
}

export interface SfuProducedMessage {
  type: "sfu_produced";
  requestId: string;
  roomId: string;
  sourceId: string;
  producerId: string;
}

export interface SfuConsumedMessage {
  type: "sfu_consumed";
  requestId: string;
  roomId: string;
  sourceId: string;
  consumerId: string;
  producerId: string;
  kind: "audio";
  rtpParameters: JsonObject;
  producerPaused: boolean;
}

export interface SfuConsumerResumedMessage {
  type: "sfu_consumer_resumed";
  requestId: string;
  roomId: string;
  consumerId: string;
}

export interface GroupRtcSignalClientMessage {
  type: "group_rtc_signal";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  targetParticipantId: string;
  signal: RtcSignalPayload;
}

export interface GroupRtcSignalRelayMessage {
  type: "group_rtc_signal";
  requestId: string;
  roomId: string;
  mediaSessionId: string;
  generation: number;
  fromParticipantId: string;
  signal: RtcSignalPayload;
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
  | RequestExternalEffectMessage
  | RequestContextDelegationMessage
  | TransferAcceptAuthorityMessage
  | BootstrapAgentVoiceAuthorityMessage
  | GrantAgentVoiceMessage
  | RevokeAgentVoiceMessage
  | RequestAgentVoiceUtteranceMessage
  | GrantAttentionLeaseMessage
  | RevokeAttentionLeaseMessage
  | RequestAgentTurnMessage
  | GrantListeningShareMessage
  | RevokeListeningShareMessage
  | SubmitListeningShareMessage
  | RequestExchangeResponseMessage
  | RtcConfigRequestMessage
  | RtcCallOpenMessage
  | RtcSignalClientMessage
  | GroupMediaJoinMessage
  | GroupMediaLeaveMessage
  | GroupMediaPublishSourceMessage
  | GroupMediaUnpublishMessage
  | GroupMediaSubscribeMessage
  | GroupMediaUnsubscribeMessage
  | GroupRtcSignalClientMessage
  | SfuCapabilitiesRequestMessage
  | SfuTransportCreateMessage
  | SfuTransportConnectMessage
  | SfuProduceMessage
  | SfuConsumeMessage
  | SfuConsumerResumeMessage;

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

export interface VoiceAuthorityBootstrapReceiptMessage {
  type: "voice_authority_bootstrap_receipt";
  requestId: string;
  room: RoomSnapshot;
  receipt: VoiceAuthorityBootstrapReceipt;
  replayed: boolean;
}

export interface AgentVoiceGrantReceiptMessage {
  type: "agent_voice_grant_receipt";
  requestId: string;
  room: RoomSnapshot;
  receipt: AgentVoiceGrantReceipt;
  replayed: boolean;
}

export interface AgentVoiceRevocationReceiptMessage {
  type: "agent_voice_revocation_receipt";
  requestId: string;
  room: RoomSnapshot;
  receipt: AgentVoiceRevocationReceipt;
  replayed: boolean;
}

export type AgentVoiceUtteranceState =
  | "queued"
  | "rendering"
  | "speaking"
  | "completed"
  | "failed";

export interface AgentVoiceUtteranceStatusMessage {
  type: "agent_voice_utterance_status";
  requestId: string;
  roomId: string;
  utteranceId: string;
  agentParticipantId: string;
  voiceId: string;
  sourceId?: string;
  state: AgentVoiceUtteranceState;
  errorCode?: string;
}

export interface AttentionLeaseStateMessage {
  type: "attention_lease_state";
  requestId: string;
  roomId: string;
  lease: AttentionLease;
}

export type AgentTurnState =
  | "thinking"
  | "rendering"
  | "speaking"
  | "completed"
  | "failed";

export interface AgentTurnStatusMessage {
  type: "agent_turn_status";
  requestId: string;
  roomId: string;
  turnRequestId: string;
  attentionLeaseId: string;
  agentParticipantId: string;
  voiceId: string;
  sourceId?: string;
  state: AgentTurnState;
  errorCode?: string;
}

export interface ListeningShareLeaseStateMessage {
  type: "listening_share_lease_state";
  requestId: string;
  roomId: string;
  lease: ListeningShareLease;
}

export type ListeningShareStatus =
  | "received"
  | "transcribing"
  | "delivered"
  | "failed";

export interface ListeningShareStatusMessage {
  type: "listening_share_status";
  requestId: string;
  roomId: string;
  shareId: string;
  leaseId: string;
  humanParticipantId: string;
  agentParticipantId: string;
  state: ListeningShareStatus;
  errorCode?: string;
}

export interface ListeningShareResultMessage {
  type: "listening_share_result";
  requestId: string;
  roomId: string;
  shareId: string;
  leaseId: string;
  agentParticipantId: string;
  transcript: string;
  engine: string;
  sampleCount: number;
  durationMs: number;
  exchange: ConversationExchange;
}

export type ExchangeResponseState =
  | "thinking"
  | "rendering"
  | "speaking"
  | "completed"
  | "failed";

export interface ExchangeResponseStatusMessage {
  type: "exchange_response_status";
  requestId: string;
  roomId: string;
  exchangeId: string;
  attentionLeaseId: string;
  humanParticipantId: string;
  agentParticipantId: string;
  voiceId: string;
  sourceId?: string;
  state: ExchangeResponseState;
  errorCode?: string;
  exchange?: ConversationExchange;
}

export interface AgentWorkStatusMessage {
  type: "agent_work_status";
  roomId: string;
  participantId: string;
  workItemId: string;
  state: AgentWorkState;
}

export type ExternalEffectState = "blocked" | "completed" | "failed";

export interface ExternalEffectStatusMessage {
  type: "external_effect_status";
  requestId: string;
  roomId: string;
  effectRequestId: string;
  artifactId: string;
  kind: ExternalEffectKind;
  target: "local-proof-sink";
  state: ExternalEffectState;
  authorityGrantId: string;
  marker?: string;
  errorCode?: RejectionCode;
}

export type ContextDelegationState = "blocked" | "completed" | "failed";

export interface ContextDelegationStatusMessage {
  type: "context_delegation_status";
  requestId: string;
  roomId: string;
  delegationRequestId: string;
  artifactId: string;
  kind: ContextDelegationKind;
  target: "local-delegation-proof-sink";
  purpose: "comparison-review";
  state: ContextDelegationState;
  authorityGrantId: string;
  marker?: string;
  errorCode?: RejectionCode;
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
  | "VOICE_AUTHORITY_ALREADY_BOOTSTRAPPED"
  | "VOICE_AUTHORITY_NOT_BOOTSTRAPPED"
  | "VOICE_TARGET_INVALID"
  | "VOICE_ID_INVALID"
  | "VOICE_GRANT_NOT_FOUND"
  | "VOICE_GRANT_ALREADY_ACTIVE"
  | "VOICE_GRANT_ALREADY_REVOKED"
  | "VOICE_RENDERER_UNAVAILABLE"
  | "VOICE_UTTERANCE_BUSY"
  | "VOICE_GROUP_MEDIA_REQUIRED"
  | "ATTENTION_LEASE_NOT_FOUND"
  | "ATTENTION_LEASE_NOT_OWNED"
  | "ATTENTION_LEASE_EXPIRED"
  | "ATTENTION_LEASE_CONSUMED"
  | "ATTENTION_LEASE_REVOKED"
  | "AGENT_TURN_BUSY"
  | "AGENT_TURN_PROMPT_INVALID"
  | "LISTENING_LEASE_NOT_FOUND"
  | "LISTENING_LEASE_NOT_OWNED"
  | "LISTENING_LEASE_EXPIRED"
  | "LISTENING_LEASE_CONSUMED"
  | "LISTENING_LEASE_REVOKED"
  | "LISTENING_AUDIO_INVALID"
  | "LISTENING_SHARE_BUSY"
  | "STT_UNAVAILABLE"
  | "STT_FAILED"
  | "EXCHANGE_NOT_FOUND"
  | "EXCHANGE_NOT_OWNED"
  | "EXCHANGE_EXPIRED"
  | "EXCHANGE_ALREADY_RESPONDED"
  | "EXCHANGE_BUSY"
  | "MEDIA_BUSY"
  | "MEDIA_SESSION_STALE"
  | "GROUP_MEDIA_FULL"
  | "MEDIA_SOURCE_NOT_FOUND"
  | "MEDIA_SOURCE_POLICY_DENIED"
  | "MEDIA_SOURCE_KIND_UNSUPPORTED"
  | "MEDIA_SOURCE_LIMIT"
  | "MEDIA_SUBSCRIPTION_INVALID"
  | "SFU_NOT_READY"
  | "SFU_SESSION_STALE"
  | "SFU_TRANSPORT_NOT_FOUND"
  | "SFU_SOURCE_NOT_READY"
  | "SFU_CANNOT_CONSUME"
  | "SFU_DIRECTION_INVALID";

export interface IntentRejectedMessage {
  type: "intent_rejected";
  requestId: string;
  code: RejectionCode;
  message: string;
  expectedVersion?: number;
  room?: RoomSnapshot;
  canonicalAcceptance?: AcceptanceReceipt;
  canonicalTransfer?: AuthorityTransferReceipt;
  canonicalVoiceBootstrap?: VoiceAuthorityBootstrapReceipt;
  canonicalVoiceGrant?: AgentVoiceGrantReceipt;
  canonicalVoiceRevocation?: AgentVoiceRevocationReceipt;
}

export type ServerMessage =
  | IdentityChallengeMessage
  | IdentityAuthenticatedMessage
  | RoomSnapshotMessage
  | RoomEventMessage
  | AcceptanceReceiptMessage
  | AuthorityTransferReceiptMessage
  | VoiceAuthorityBootstrapReceiptMessage
  | AgentVoiceGrantReceiptMessage
  | AgentVoiceRevocationReceiptMessage
  | AgentVoiceUtteranceStatusMessage
  | AttentionLeaseStateMessage
  | AgentTurnStatusMessage
  | ListeningShareLeaseStateMessage
  | ListeningShareStatusMessage
  | ListeningShareResultMessage
  | ExchangeResponseStatusMessage
  | AgentWorkStatusMessage
  | ExternalEffectStatusMessage
  | ContextDelegationStatusMessage
  | RtcConfigMessage
  | RtcCallSessionMessage
  | RtcSignalRelayMessage
  | GroupMediaStateMessage
  | GroupRtcSignalRelayMessage
  | SfuCapabilitiesMessage
  | SfuTransportCreatedMessage
  | SfuTransportConnectedMessage
  | SfuProducedMessage
  | SfuConsumedMessage
  | SfuConsumerResumedMessage
  | IntentRejectedMessage;
