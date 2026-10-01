import type { Artifact, WorkItem } from "@commonline/protocol";

export interface SilentAgent {
  readonly name: string;
  perform(work: WorkItem): Promise<Artifact>;
  composeVoiceProof(): Promise<string>;
}

export class MockSilentAgent implements SilentAgent {
  constructor(public readonly name: string) {}

  async composeVoiceProof(): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return (
      "Vessie here. This voice is active only because Commonline holds a current " +
      "room-scoped voice grant, and only explicit subscribers should receive it."
    );
  }

  async perform(work: WorkItem): Promise<Artifact> {
    await new Promise((resolve) => setTimeout(resolve, 700));
    return {
      id: `artifact-${crypto.randomUUID()}`,
      sourceWorkId: work.id,
      title: "Comparison artifact",
      body:
        "P0 mock result: Approach A favors speed and lower coordination overhead. " +
        "Approach B favors explicit state, provenance, and safer resumption. " +
        "The next implementation should preserve the authority boundary while replacing this mock with a real scoped adapter.",
      producedBy: this.name,
      status: "proposed",
      createdAt: new Date().toISOString()
    };
  }
}
