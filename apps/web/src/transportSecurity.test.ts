import { describe, expect, it } from "vitest";
import {
  mediaContextLabel,
  resolveCommonlineHealthUrl,
  resolveCommonlineWebSocketUrl
} from "./transportSecurity";

describe("P0-g transport security", () => {
  it("allows localhost ws for development", () => {
    expect(
      resolveCommonlineWebSocketUrl({
        pageUrl: "http://localhost:5173/"
      })
    ).toBe("ws://localhost:8787/");
  });

  it("derives wss from an HTTPS deployment", () => {
    expect(
      resolveCommonlineWebSocketUrl({
        pageUrl: "https://call.example.test/"
      })
    ).toBe("wss://call.example.test:8787/");
  });

  it("refuses an insecure non-local page", () => {
    expect(() =>
      resolveCommonlineWebSocketUrl({
        pageUrl: "http://192.0.2.20:5173/"
      })
    ).toThrow(/requires HTTPS outside localhost/);
  });

  it("refuses ws signaling from an HTTPS page", () => {
    expect(() =>
      resolveCommonlineWebSocketUrl({
        pageUrl: "https://call.example.test/",
        configuredUrl: "ws://signal.example.test:8787"
      })
    ).toThrow(/must use WSS/);
  });

  it("derives the health endpoint from the configured signaling origin", () => {
    expect(
      resolveCommonlineHealthUrl({
        pageUrl: "http://127.0.0.1:5173/",
        configuredUrl: "ws://127.0.0.1:8787"
      })
    ).toBe("http://127.0.0.1:8787/health");
  });

  it("labels localhost as a permitted secure-context exception", () => {
    expect(
      mediaContextLabel({
        pageUrl: "http://127.0.0.1:5173/",
        secureContext: false
      })
    ).toBe("secure");
  });
});
