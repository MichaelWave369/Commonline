export type PrincipalKind = "human" | "agent" | "service" | "device";
export type PresenceState = "online" | "offline";
export type WorkStatus = "offered" | "working" | "completed" | "failed" | "canceled";
export type ArtifactStatus = "proposed" | "accepted";

export interface Participant {
  id: string;
  name: string;
  kind: PrincipalKind;
  role: string;
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
  | "READ_SELECTED_CONTEXT"
  | "WRITE_DRAFT_ARTIFACT"
  | "SUBMIT_WORK"
  | "ACCEPT_OUTCOME"
  | "RECEIVE_MEDIA"
  | "SPEAK"
  | "EXECUTE_EXTERNAL_EFFECT";

export interface Grant {
  principalId: string;
  capability: Capability;
  allowed: boolean;
}

export interface RoomSnapshot {
  roomId: string;
  purpose: string;
  version: number;
  episodeActive: boolean;
  participants: Participant[];
  grants: Grant[];
  workItems: WorkItem[];
  artifacts: Artifact[];
  acceptedArtifactIds: string[];
}

export type RoomEventType =
  | "participant_joined"
  | "participant_left"
  | "work_submitted"
  | "artifact_proposed"
  | "artifact_accepted";

export interface RoomEvent {
  id: string;
  roomId: string;
  version: number;
  type: RoomEventType;
  actorId: string;
  summary: string;
  occurredAt: string;
}

export interface JoinRoomMessage {
  type: "join_room";
  requestId: string;
  roomId: string;
  clientId: string;
  name: string;
  acknowledgedVersion: number;
}

export interface SubmitWorkMessage {
  type: "submit_work";
  requestId: string;
  roomId: string;
  baseVersion: number;
  prompt: string;
}

export interface AcceptArtifactMessage {
  type: "accept_artifact";
  requestId: string;
  roomId: string;
  baseVersion: number;
  artifactId: string;
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
      reason?: "ended" | "declined" | "failed";
    };

export interface RtcSignalClientMessage {
  type: "rtc_signal";
  requestId: string;
  roomId: string;
  targetClientId: string;
  signal: RtcSignalPayload;
}

export type ClientMessage =
  | JoinRoomMessage
  | SubmitWorkMessage
  | AcceptArtifactMessage
  | RtcSignalClientMessage;

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

export interface RtcSignalRelayMessage {
  type: "rtc_signal";
  requestId: string;
  roomId: string;
  fromClientId: string;
  signal: RtcSignalPayload;
}

export type RejectionCode =
  | "STALE_VERSION"
  | "NOT_AUTHORIZED"
  | "ROOM_NOT_FOUND"
  | "INVALID_INTENT"
  | "INVALID_SESSION"
  | "ARTIFACT_NOT_FOUND"
  | "PEER_UNAVAILABLE";

export interface IntentRejectedMessage {
  type: "intent_rejected";
  requestId: string;
  code: RejectionCode;
  message: string;
  expectedVersion?: number;
  room?: RoomSnapshot;
}

export type ServerMessage =
  | RoomSnapshotMessage
  | RoomEventMessage
  | RtcSignalRelayMessage
  | IntentRejectedMessage;
