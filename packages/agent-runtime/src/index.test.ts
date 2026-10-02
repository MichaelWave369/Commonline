import { describe, expect, it } from "vitest";
import {
  createSilentAgent,
  OllamaLocalSilentAgent
} from "./index";

const work = {
  id: "work-1",
  requestedBy: "alice",
  prompt: "Compare option A and option B for this specific pilot task.",
  status: "working" as const,
  createdAt: "2026-10-01T20:00:00.000Z"
};

describe("P0-w silent worker boundary", () => {
  it("keeps deterministic mock mode as the default", async () => {
    const agent = createSilentAgent();

    expect(agent.profile.mode).toBe("mock");
    expect(agent.profile.tools).toBe(false);
    expect(agent.profile.inputScope).toBe("work-prompt-only");

    const artifact = await agent.perform(work);
    expect(artifact.sourceWorkId).toBe(work.id);
    expect(artifact.status).toBe("proposed");
    expect(artifact.body).toContain("P0 mock result");
  });

  it("rejects non-loopback Ollama endpoints", () => {
    expect(
      () =>
        new OllamaLocalSilentAgent({
          model: "pilot-model",
          baseUrl: "https://example.com"
        })
    ).toThrow("only permits a loopback endpoint");
  });

  it("sends only the bounded work prompt and accepts one strict JSON artifact", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const fetcher = (async (
      input: string | URL | Request,
      init?: RequestInit
    ) => {
      capturedUrl = String(input);
      capturedInit = init;

      return new Response(
        JSON.stringify({
          message: {
            role: "assistant",
            content: JSON.stringify({
              title: "Pilot-specific comparison",
              body: "Option A reduces setup time. Option B preserves more explicit review state."
            })
          },
          done: true
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }) as typeof fetch;

    const agent = new OllamaLocalSilentAgent({
      model: "pilot-model",
      fetcher
    });

    const artifact = await agent.perform(work);

    expect(capturedUrl).toBe("http://127.0.0.1:11434/api/chat");
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.redirect).toBe("error");

    const payload = JSON.parse(String(capturedInit?.body)) as {
      model: string;
      stream: boolean;
      think: boolean;
      format: string;
      options?: { num_ctx?: number };
      tools?: unknown;
      messages: Array<{ role: string; content: string }>;
    };

    expect(payload.model).toBe("pilot-model");
    expect(payload.stream).toBe(false);
    expect(payload.think).toBe(false);
    expect(payload.format).toBe("json");
    expect(payload.options).toEqual({ num_ctx: 4096 });
    expect(payload.tools).toBeUndefined();
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages[1]).toEqual({
      role: "user",
      content: work.prompt
    });

    // The fixed system instruction names forbidden context classes so the
    // model knows what it must not claim to have seen. Prove data minimization
    // structurally instead of banning those policy words from the request.
    expect(Object.keys(payload).sort()).toEqual(
      ["format", "messages", "model", "options", "stream", "think"].sort()
    );
    expect(payload.messages.map((message) => message.role)).toEqual([
      "system",
      "user"
    ]);
    expect(payload.messages[1]?.content).toBe(work.prompt);
    expect(payload.messages[0]?.content).not.toContain(work.prompt);

    expect(artifact.title).toBe("Pilot-specific comparison");
    expect(artifact.body).toContain("Option A");
    expect(artifact.producedBy).toBe("Vessie");
  });

  it("fails closed when the provider does not return the bounded JSON contract", async () => {
    const fetcher = (async () =>
      new Response(
        JSON.stringify({
          message: {
            role: "assistant",
            content: "Here is a paragraph instead of the required JSON."
          },
          done: true
        }),
        { status: 200 }
      )) as typeof fetch;

    const agent = new OllamaLocalSilentAgent({
      model: "pilot-model",
      fetcher
    });

    await expect(agent.perform(work)).rejects.toThrow(
      "non-JSON artifact"
    );
  });

  it("rejects an invalid bounded Ollama context", () => {
    expect(() =>
      createSilentAgent({
        mode: "ollama-local",
        ollamaModel: "pilot-model",
        ollamaNumCtx: 1000
      })
    ).toThrow("num_ctx must be an integer between");
  });

  it("requires an explicit local model in ollama-local mode", () => {
    expect(() =>
      createSilentAgent({
        mode: "ollama-local"
      })
    ).toThrow("COMMONLINE_OLLAMA_MODEL is required");
  });

  it("fails fast on an invalid provider timeout", () => {
    expect(() =>
      createSilentAgent({
        mode: "ollama-local",
        ollamaModel: "pilot-model",
        timeoutMs: Number.NaN
      })
    ).toThrow("agent timeout must be between");
  });
});
