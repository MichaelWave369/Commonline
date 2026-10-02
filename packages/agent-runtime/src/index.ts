import type { Artifact, WorkItem } from "@commonline/protocol";

export interface SilentAgentProfile {
  mode: "mock" | "ollama-local";
  provider: "deterministic-ci" | "ollama";
  model?: string;
  endpoint?: string;
  numCtx?: number;
  tools: false;
  inputScope: "work-prompt-only";
}

export interface SilentAgent {
  readonly name: string;
  readonly profile: SilentAgentProfile;
  perform(work: WorkItem): Promise<Artifact>;
  composeVoiceProof(): Promise<string>;
  composeDirectedTurn(prompt: string): Promise<string>;
  composeExchangeReply(transcript: string): Promise<string>;
  observeSharedTranscript(
    transcript: string
  ): Promise<{ wordCount: number; characterCount: number }>;
}

type FetchLike = typeof fetch;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

abstract class BaseSilentAgent implements SilentAgent {
  abstract readonly profile: SilentAgentProfile;

  constructor(public readonly name: string) {}

  async observeSharedTranscript(transcript: string) {
    await sleep(90);
    return {
      wordCount: transcript
        .trim()
        .split(/\s+/)
        .filter(Boolean).length,
      characterCount: transcript.length
    };
  }

  async composeExchangeReply(transcript: string): Promise<string> {
    await sleep(150);

    const words = transcript
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    return (
      `Vessie replying only after a separate attention grant. I heard a bounded ${words}-word shared transcript. ` +
      "This reply is tied to that exchange and does not create ongoing listening or speaking permission."
    );
  }

  async composeDirectedTurn(prompt: string): Promise<string> {
    await sleep(140);

    const wordCount = prompt
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;

    return (
      `Vessie responding to one directed turn. I received a ${wordCount}-word request. ` +
      "Commonline consumed exactly one attention lease for this reply. " +
      "The prompt itself remains ephemeral in this rung."
    );
  }

  async composeVoiceProof(): Promise<string> {
    await sleep(120);
    return (
      "Vessie here. This voice is active only because Commonline holds a current " +
      "room-scoped voice grant, and only explicit subscribers should receive it."
    );
  }

  abstract perform(work: WorkItem): Promise<Artifact>;
}

export class MockSilentAgent extends BaseSilentAgent {
  readonly profile: SilentAgentProfile = {
    mode: "mock",
    provider: "deterministic-ci",
    tools: false,
    inputScope: "work-prompt-only"
  };

  async perform(work: WorkItem): Promise<Artifact> {
    await sleep(700);
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

export interface OllamaLocalSilentAgentOptions {
  name?: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  numCtx?: number;
  fetcher?: FetchLike;
}

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
}

function localOllamaBaseUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase();
  const loopback =
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1";

  if (!loopback) {
    throw new Error(
      "P0-w Ollama adapter only permits a loopback endpoint."
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      "P0-w Ollama endpoint must use http or https."
    );
  }

  return url;
}

function parseArtifactContent(content: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(
      "Ollama returned a non-JSON artifact."
    );
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(
      "Ollama artifact must be a JSON object."
    );
  }

  const candidate = parsed as {
    title?: unknown;
    body?: unknown;
  };
  if (
    typeof candidate.title !== "string" ||
    candidate.title.trim().length === 0 ||
    candidate.title.length > 120
  ) {
    throw new Error(
      "Ollama artifact title is missing or outside the 120-character limit."
    );
  }
  if (
    typeof candidate.body !== "string" ||
    candidate.body.trim().length === 0 ||
    candidate.body.length > 6000
  ) {
    throw new Error(
      "Ollama artifact body is missing or outside the 6000-character limit."
    );
  }

  return {
    title: candidate.title.trim(),
    body: candidate.body.trim()
  };
}

export class OllamaLocalSilentAgent extends BaseSilentAgent {
  readonly profile: SilentAgentProfile;
  private readonly baseUrl: URL;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly numCtx: number;
  private readonly fetcher: FetchLike;

  constructor(private readonly options: OllamaLocalSilentAgentOptions) {
    super(options.name ?? "Vessie");

    const model = options.model.trim();
    if (!model) {
      throw new Error(
        "COMMONLINE_OLLAMA_MODEL is required for ollama-local mode."
      );
    }

    this.baseUrl = localOllamaBaseUrl(
      options.baseUrl ?? "http://127.0.0.1:11434"
    );
    this.model = model;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    if (
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs < 1_000 ||
      this.timeoutMs > 120_000
    ) {
      throw new Error(
        "P0-w agent timeout must be between 1000 and 120000 milliseconds."
      );
    }
    this.numCtx = options.numCtx ?? 4_096;
    if (
      !Number.isInteger(this.numCtx) ||
      this.numCtx < 2_048 ||
      this.numCtx > 32_768
    ) {
      throw new Error(
        "P0-w Ollama num_ctx must be an integer between 2048 and 32768."
      );
    }
    this.fetcher = options.fetcher ?? fetch;
    this.profile = {
      mode: "ollama-local",
      provider: "ollama",
      model: this.model,
      endpoint: this.baseUrl.origin,
      numCtx: this.numCtx,
      tools: false,
      inputScope: "work-prompt-only"
    };
  }

  async perform(work: WorkItem): Promise<Artifact> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.timeoutMs
    );

    try {
      const response = await this.fetcher(
        new URL("/api/chat", this.baseUrl),
        {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: this.model,
            stream: false,
            think: false,
            format: "json",
            options: {
              num_ctx: this.numCtx
            },
            messages: [
              {
                role: "system",
                content:
                  "You are Vessie, a silent worker inside a governed collaboration room. " +
                  "You receive only one explicitly submitted bounded task. " +
                  "Return exactly one useful draft artifact as JSON with string fields title and body. " +
                  "Do not claim you executed external actions, contacted anyone, used tools, heard live conversation, " +
                  "or accessed room history. Keep the artifact concise, inspectable, and directly responsive to the task."
              },
              {
                role: "user",
                content: work.prompt
              }
            ]
          }),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        const details = (await response.text()).trim();
        throw new Error(
          `Ollama request failed with HTTP ${response.status}${details ? `: ${details}` : "."}`
        );
      }

      const payload = (await response.json()) as OllamaChatResponse;
      const content = payload.message?.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        throw new Error(
          "Ollama response did not contain assistant content."
        );
      }

      const artifact = parseArtifactContent(content);
      return {
        id: `artifact-${crypto.randomUUID()}`,
        sourceWorkId: work.id,
        title: artifact.title,
        body: artifact.body,
        producedBy: this.name,
        status: "proposed",
        createdAt: new Date().toISOString()
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export type SilentAgentMode = "mock" | "ollama-local";

export function createSilentAgent(options: {
  mode?: string;
  name?: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
  timeoutMs?: number;
  ollamaNumCtx?: number;
  fetcher?: FetchLike;
} = {}): SilentAgent {
  const mode = options.mode?.trim() || "mock";

  if (mode === "mock") {
    return new MockSilentAgent(options.name ?? "Vessie");
  }

  if (mode === "ollama-local") {
    return new OllamaLocalSilentAgent({
      name: options.name,
      model: options.ollamaModel ?? "",
      baseUrl: options.ollamaBaseUrl,
      timeoutMs: options.timeoutMs,
      numCtx: options.ollamaNumCtx,
      fetcher: options.fetcher
    });
  }

  throw new Error(
    `Unsupported Commonline silent-agent mode: ${mode}`
  );
}
