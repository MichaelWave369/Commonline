import { SILENT_AGENT_PARTICIPANT_ID } from "@commonline/room-core";

export interface AgentVoiceProfile {
  voiceId: string;
  agentParticipantId: string;
  label: string;
  rendererState: "local-adapter";
  engineBoundary: "local-tts-adapter";
}

const profiles: AgentVoiceProfile[] = [
  {
    voiceId: "vessie-local-v1",
    agentParticipantId: SILENT_AGENT_PARTICIPANT_ID,
    label: "Vessie local voice",
    rendererState: "local-adapter",
    engineBoundary: "local-tts-adapter"
  }
];

export function agentVoiceProfiles() {
  return profiles.map((profile) => ({ ...profile }));
}

export function agentVoiceProfile(
  agentParticipantId: string,
  voiceId: string
) {
  return profiles.find(
    (profile) =>
      profile.agentParticipantId === agentParticipantId &&
      profile.voiceId === voiceId
  );
}
