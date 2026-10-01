import type { RtcCallSessionMessage } from "@commonline/protocol";

export function mediaSessionKey(
  session: Pick<RtcCallSessionMessage, "callId" | "generation">
) {
  return `${session.callId}:${session.generation}`;
}

export function sameMediaSession(
  a:
    | Pick<RtcCallSessionMessage, "callId" | "generation">
    | null
    | undefined,
  b:
    | Pick<RtcCallSessionMessage, "callId" | "generation">
    | null
    | undefined
) {
  return Boolean(
    a &&
      b &&
      a.callId === b.callId &&
      a.generation === b.generation
  );
}

export function offerCollision(input: {
  descriptionType: RTCSdpType;
  makingOffer: boolean;
  signalingState: RTCSignalingState;
  isSettingRemoteAnswerPending: boolean;
}) {
  const readyForOffer =
    !input.makingOffer &&
    (input.signalingState === "stable" ||
      input.isSettingRemoteAnswerPending);

  return input.descriptionType === "offer" && !readyForOffer;
}

export function shouldIgnoreOffer(input: {
  polite: boolean;
  descriptionType: RTCSdpType;
  makingOffer: boolean;
  signalingState: RTCSignalingState;
  isSettingRemoteAnswerPending: boolean;
}) {
  return (
    !input.polite &&
    offerCollision({
      descriptionType: input.descriptionType,
      makingOffer: input.makingOffer,
      signalingState: input.signalingState,
      isSettingRemoteAnswerPending:
        input.isSettingRemoteAnswerPending
    })
  );
}
