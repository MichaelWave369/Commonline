import { describe, expect, it } from "vitest";
import { pilotViteServerConfigFromEnv } from "./pilotHostConfig";

describe("P0-aa secure LAN Vite host", () => {
  it("keeps normal development on localhost HTTP", () => {
    expect(
      pilotViteServerConfigFromEnv(
        {},
        (() => Buffer.from("unused"))
      )
    ).toEqual({
      port: 5173
    });
  });

  it("requires a PFX before exposing the web app to the LAN", () => {
    expect(() =>
      pilotViteServerConfigFromEnv(
        {
          COMMONLINE_PILOT_LAN_HOST: "true"
        },
        (() => Buffer.from("unused"))
      )
    ).toThrow(/COMMONLINE_TLS_PFX_FILE is required/);
  });

  it("binds HTTPS on all LAN interfaces with the configured PFX", () => {
    const config = pilotViteServerConfigFromEnv(
      {
        COMMONLINE_PILOT_LAN_HOST: "true",
        COMMONLINE_TLS_PFX_FILE: "pilot-local/tls/commonline-pilot.pfx",
        COMMONLINE_TLS_PFX_PASSPHRASE: "secret"
      },
      (() => Buffer.from("pfx-data"))
    );

    expect(config.port).toBe(5173);
    expect(config.host).toBe("0.0.0.0");
    expect(config.https?.pfx).toEqual(
      Buffer.from("pfx-data")
    );
    expect(config.https?.passphrase).toBe("secret");
  });
});
