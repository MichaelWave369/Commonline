export function isLoopbackHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

export function resolveCommonlineWebSocketUrl(input: {
  pageUrl: string;
  configuredUrl?: string;
}) {
  const page = new URL(input.pageUrl);
  const local = isLoopbackHost(page.hostname);

  if (page.protocol !== "https:" && !local) {
    throw new Error(
      "Commonline requires HTTPS outside localhost so identity, recovery, signaling, and microphone access are not exposed over an insecure page."
    );
  }

  const resolved = input.configuredUrl?.trim()
    ? new URL(input.configuredUrl.trim(), page)
    : new URL(
        `${page.protocol === "https:" ? "wss" : "ws"}://${page.hostname}:8787`
      );

  if (resolved.protocol !== "ws:" && resolved.protocol !== "wss:") {
    throw new Error("Commonline WebSocket URL must use ws:// or wss://.");
  }

  if (page.protocol === "https:" && resolved.protocol !== "wss:") {
    throw new Error(
      "An HTTPS Commonline page must use WSS signaling."
    );
  }

  if (resolved.protocol === "ws:" && !local) {
    throw new Error(
      "Commonline refuses plain ws:// outside localhost. Configure WSS for deployed rooms."
    );
  }

  return resolved.toString();
}

export function mediaContextLabel(input: {
  pageUrl: string;
  secureContext: boolean;
}) {
  const page = new URL(input.pageUrl);
  if (input.secureContext || isLoopbackHost(page.hostname)) {
    return "secure";
  }
  return "insecure";
}
