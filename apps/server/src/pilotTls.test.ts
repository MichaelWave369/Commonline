import { describe, expect, it } from "vitest";
import { pilotTlsConfigFromEnv } from "./pilotTls";

describe("P0-aa pilot TLS config", () => {
  it("keeps ordinary localhost development on HTTP when no PFX is configured", () => {
    expect(
      pilotTlsConfigFromEnv({}, () => Buffer.from("unused"))
    ).toEqual({
      enabled: false,
      protocol: "http"
    });
  });

  it("loads a PFX and passphrase for HTTPS/WSS pilot hosting", () => {
    const calls: string[] = [];
    const config = pilotTlsConfigFromEnv(
      {
        COMMONLINE_TLS_PFX_FILE: "pilot-local/tls/commonline-pilot.pfx",
        COMMONLINE_TLS_PFX_PASSPHRASE: "secret"
      },
      ((path: string) => {
        calls.push(path);
        return Buffer.from("pfx-bytes");
      })
    );

    expect(calls).toEqual([
      "pilot-local/tls/commonline-pilot.pfx"
    ]);
    expect(config.enabled).toBe(true);
    expect(config.protocol).toBe("https");
    expect(config.pfxPath).toBe(
      "pilot-local/tls/commonline-pilot.pfx"
    );
    expect(config.options?.pfx).toEqual(
      Buffer.from("pfx-bytes")
    );
    expect(config.options?.passphrase).toBe("secret");
  });

  it("refuses an empty PFX file", () => {
    expect(() =>
      pilotTlsConfigFromEnv(
        {
          COMMONLINE_TLS_PFX_FILE: "empty.pfx"
        },
        (() => Buffer.alloc(0))
      )
    ).toThrow(/empty PFX/);
  });
});
