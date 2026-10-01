import type {
  MediaSourceKind,
  MediaSourcePolicy,
  PrincipalKind
} from "@commonline/protocol";

export const MEDIA_SOURCE_POLICY_VERSION = "p0-k.1";

const policies: MediaSourcePolicy[] = [
  {
    policyId: "source-policy/human-microphone/p0-k.1",
    kind: "human-microphone",
    requiredCapability: "SPEAK",
    allowedPublisherKinds: ["human"],
    audienceMode: "explicit-subscription",
    retention: "ephemeral",
    recordingDefault: "not-authorized",
    maxInstancesPerPublisher: 1,
    executionState: "executable"
  },
  {
    policyId: "source-policy/sound-effect/p0-k.1",
    kind: "sound-effect",
    requiredCapability: "SPEAK",
    allowedPublisherKinds: ["human"],
    audienceMode: "explicit-subscription",
    retention: "ephemeral",
    recordingDefault: "not-authorized",
    maxInstancesPerPublisher: 1,
    executionState: "executable"
  },
  {
    policyId: "source-policy/shared-music/p0-k.1",
    kind: "shared-music",
    requiredCapability: "SPEAK",
    allowedPublisherKinds: ["human"],
    audienceMode: "explicit-subscription",
    retention: "ephemeral",
    recordingDefault: "not-authorized",
    maxInstancesPerPublisher: 1,
    executionState: "reserved"
  },
  {
    policyId: "source-policy/agent-voice/p0-k.1",
    kind: "agent-voice",
    requiredCapability: "SPEAK",
    allowedPublisherKinds: ["agent"],
    audienceMode: "explicit-subscription",
    retention: "ephemeral",
    recordingDefault: "not-authorized",
    maxInstancesPerPublisher: 1,
    executionState: "reserved"
  },
  {
    policyId: "source-policy/system-tone/p0-k.1",
    kind: "system-tone",
    requiredCapability: "SPEAK",
    allowedPublisherKinds: ["service"],
    audienceMode: "explicit-subscription",
    retention: "ephemeral",
    recordingDefault: "not-authorized",
    maxInstancesPerPublisher: 1,
    executionState: "reserved"
  }
];

export function mediaSourcePolicies() {
  return policies.map((policy) => ({
    ...policy,
    allowedPublisherKinds: [...policy.allowedPublisherKinds]
  }));
}

export function mediaSourcePolicy(kind: MediaSourceKind) {
  return policies.find((policy) => policy.kind === kind);
}

export type MediaSourcePolicyDecision =
  | {
      ok: true;
      policy: MediaSourcePolicy;
    }
  | {
      ok: false;
      code:
        | "MEDIA_SOURCE_POLICY_DENIED"
        | "MEDIA_SOURCE_KIND_UNSUPPORTED";
      message: string;
    };

export function evaluateMediaSourcePolicy(input: {
  kind: MediaSourceKind;
  publisherKind: PrincipalKind;
  hasRequiredCapability: boolean;
}): MediaSourcePolicyDecision {
  const policy = mediaSourcePolicy(input.kind);

  if (!policy) {
    return {
      ok: false,
      code: "MEDIA_SOURCE_KIND_UNSUPPORTED",
      message: "The requested media source kind has no Commonline policy."
    };
  }

  if (policy.executionState !== "executable") {
    return {
      ok: false,
      code: "MEDIA_SOURCE_KIND_UNSUPPORTED",
      message: `${input.kind} is reserved by P0-k policy but is not executable yet.`
    };
  }

  if (!policy.allowedPublisherKinds.includes(input.publisherKind)) {
    return {
      ok: false,
      code: "MEDIA_SOURCE_POLICY_DENIED",
      message:
        `${input.kind} may not be published by a ${input.publisherKind} principal.`
    };
  }

  if (!input.hasRequiredCapability) {
    return {
      ok: false,
      code: "MEDIA_SOURCE_POLICY_DENIED",
      message:
        `${input.kind} requires an active ${policy.requiredCapability} grant.`
    };
  }

  return { ok: true, policy };
}
