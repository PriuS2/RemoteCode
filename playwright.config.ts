import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:18180",
    viewport: { width: 1600, height: 1000 },
    actionTimeout: 15_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: "powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File ./scripts/start-playwright-server.ps1",
    url: "http://127.0.0.1:18180/api/health",
    reuseExistingServer: false,
    timeout: 240_000,
    cwd: __dirname,
  },
});
