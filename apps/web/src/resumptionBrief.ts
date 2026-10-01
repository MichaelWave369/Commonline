import type {
  RoomEvent,
  RoomSnapshot,
  WorkStatus
} from "@commonline/protocol";

export type ResumptionNextActionKind =
  | "review-proposal"
  | "revisit-failed-work"
  | "await-work"
  | "submit-work";

export interface ResumptionAcceptedWork {
  workItemId: string;
  artifactId: string;
  title: string;
  acceptedAt: string;
}

export interface ResumptionUnresolvedWork {
  workItemId: string;
  prompt: string;
  status: WorkStatus;
  proposedArtifactTitles: string[];
}

export interface ResumptionNextAction {
  kind: ResumptionNextActionKind;
  summary: string;
  workItemId?: string;
  artifactId?: string;
}

export interface ResumptionBrief {
  roomVersion: number;
  acceptedWork: ResumptionAcceptedWork[];
  unresolvedWork: ResumptionUnresolvedWork[];
  nextAction: ResumptionNextAction;
  missedDurableEvents: RoomEvent[];
}

const OPEN_WORK_STATES = new Set<WorkStatus>([
  "offered",
  "working",
  "proposed",
  "failed"
]);

function nextActionFor(
  room: RoomSnapshot,
  unresolvedWork: ResumptionUnresolvedWork[]
): ResumptionNextAction {
  const proposed = unresolvedWork.find((item) => item.status === "proposed");
  if (proposed) {
    const artifact = room.artifacts.find(
      (candidate) =>
        candidate.sourceWorkId === proposed.workItemId &&
        candidate.status === "proposed"
    );

    return {
      kind: "review-proposal",
      summary: artifact
        ? `Review proposal “${artifact.title}” and explicitly accept it or leave it unresolved.`
        : "Review the pending proposal and explicitly accept it or leave it unresolved.",
      workItemId: proposed.workItemId,
      artifactId: artifact?.id
    };
  }

  const failed = unresolvedWork.find((item) => item.status === "failed");
  if (failed) {
    return {
      kind: "revisit-failed-work",
      summary: `Revisit failed work: ${failed.prompt}`,
      workItemId: failed.workItemId
    };
  }

  const active = unresolvedWork.find(
    (item) => item.status === "working" || item.status === "offered"
  );
  if (active) {
    return {
      kind: "await-work",
      summary:
        active.status === "working"
          ? `Continue or inspect the in-progress work: ${active.prompt}`
          : `Continue the offered bounded work: ${active.prompt}`,
      workItemId: active.workItemId
    };
  }

  return {
    kind: "submit-work",
    summary:
      "No unresolved bounded work remains. Submit the next concrete work item when the room has one."
  };
}

/**
 * P0-r derives a continuity view only from already-durable room state and the
 * durable resume delta. It deliberately receives no audio, transcript,
 * listening-share, attention-lease, scratch, or generated-reply content.
 */
export function buildResumptionBrief(
  room: RoomSnapshot,
  resumeDelta: RoomEvent[]
): ResumptionBrief {
  const artifactById = new Map(
    room.artifacts.map((artifact) => [artifact.id, artifact])
  );

  const acceptedWork = room.acceptances.flatMap((receipt) => {
    const artifact = artifactById.get(receipt.artifactId);
    if (!artifact) return [];

    return [
      {
        workItemId: receipt.workItemId,
        artifactId: artifact.id,
        title: artifact.title,
        acceptedAt: receipt.acceptedAt
      }
    ];
  });

  const unresolvedWork = room.workItems
    .filter((item) => OPEN_WORK_STATES.has(item.status))
    .map((item) => ({
      workItemId: item.id,
      prompt: item.prompt,
      status: item.status,
      proposedArtifactTitles: room.artifacts
        .filter(
          (artifact) =>
            artifact.sourceWorkId === item.id &&
            artifact.status === "proposed"
        )
        .map((artifact) => artifact.title)
    }));

  return {
    roomVersion: room.version,
    acceptedWork,
    unresolvedWork,
    nextAction: nextActionFor(room, unresolvedWork),
    missedDurableEvents: resumeDelta.slice()
  };
}
