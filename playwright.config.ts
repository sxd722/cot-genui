import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const windowsChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30_000,
  fullyParallel: true,
  use: {
    browserName: "chromium",
    ...(existsSync(windowsChrome) ? { channel: "chrome" } : {}),
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
});
