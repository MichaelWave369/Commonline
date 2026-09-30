export type PrincipalKind = "human" | "agent" | "service" | "device";
export type WorkStatus = "offered" | "working" | "completed" | "failed" | "canceled";
export type ArtifactStatus = "proposed" | "accepted";

export interface Participant {
  id: string;
  name: string;
  kind: PrincipalKind;
  role: string;
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
  | "SPEAK"
  | "EXECUTE_EXTERNAL_EFFECT";

export interface Grant {
  principalId: string;
  capability: Capability;
  allowed: boolean;
}

export interface ResumeSnapshot {
  acknowledgedVersion: number;
  acceptedArtifactIds: string[];
}
