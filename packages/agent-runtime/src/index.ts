import type { Artifact, WorkItem } from "@commonline/protocol";

export interface SilentAgent {
  readonly name: string;
  perform(work: WorkItem): Promise<Artifact>;
}

export class MockSilentAgent implements SilentAgent {
  constructor(public readonly name: string) {}

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
