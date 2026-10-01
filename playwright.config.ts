import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: {
    timeout: 15_000
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }]
  ],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--autoplay-policy=no-user-gesture-required"
          ]
        }
      }
    }
  ],
  webServer: [
    {
      command: "npm run dev -w @commonline/server",
      url: "http://127.0.0.1:8787/health",
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        COMMONLINE_DB_PATH: ":memory:",
        COMMONLINE_SFU_LISTEN_IP: "127.0.0.1",
        COMMONLINE_SFU_PORT: "44444",
        COMMONLINE_TTS_ENGINE: "tone",
        COMMONLINE_STT_ENGINE: "deterministic",
        PORT: "8787"
      }
    },
    {
      command: "npm run dev -w @commonline/web -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      env: {
        VITE_COMMONLINE_WS_URL: "ws://127.0.0.1:8787"
      }
    }
  ]
});
