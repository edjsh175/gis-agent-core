import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/gis/browser-harness',
  timeout: 45_000,
  workers: 1,
  globalSetup: './tests/gis/browser/harnessServer.js',
  use: { baseURL: 'http://127.0.0.1:5179', headless: true, channel: 'msedge' },
});
