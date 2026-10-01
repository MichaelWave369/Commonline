import type { GroupMediaStateMessage } from "@commonline/protocol";

export interface GroupPeerPlan {
  peerParticipantId: string;
  sendLocal: boolean;
  receiveRemote: boolean;
  peerSourceId?: string;
}

export function buildGroupPeerPlans(
  state: GroupMediaStateMessage,
  participantId: string
): GroupPeerPlan[] {
  const ownSource = state.sources.find(
    (source) => source.ownerParticipantId === participantId
  );

  return state.participants
    .filter(
      (participant) =>
        participant.participantId !== participantId
    )
    .map((participant) => {
      const peerSource = state.sources.find(
        (source) =>
          source.ownerParticipantId === participant.participantId
      );

      const sendLocal = Boolean(
        ownSource &&
          state.subscriptions.some(
            (subscription) =>
              subscription.subscriberParticipantId ===
                participant.participantId &&
              subscription.sourceId === ownSource.sourceId
          )
      );

      const receiveRemote = Boolean(
        peerSource &&
          state.subscriptions.some(
            (subscription) =>
              subscription.subscriberParticipantId === participantId &&
              subscription.sourceId === peerSource.sourceId
          )
      );

      return {
        peerParticipantId: participant.participantId,
        sendLocal,
        receiveRemote,
        peerSourceId: peerSource?.sourceId
      };
    })
    .filter((plan) => plan.sendLocal || plan.receiveRemote);
}
