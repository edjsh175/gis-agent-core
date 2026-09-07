import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/gis/browser',
  timeout: 30000,
  workers: 1,
  globalSetup: './tests/gis/browser/server.js',
  use: { baseURL: 'http://127.0.0.1:5178', headless: true, channel: 'msedge' },
});
