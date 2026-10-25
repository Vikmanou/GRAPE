import { defineConfig, devices } from '@playwright/test';

const port = 5174;

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Headless WebGPU support varies by machine; tests accept either a
        // WebGPU canvas or a clean fallback message.
        // Chrome on Linux exposes the real GPU to WebGPU only through Vulkan.
        launchOptions: {
          args: ['--enable-unsafe-webgpu', ...(process.platform === 'linux' ? ['--enable-features=Vulkan'] : [])],
        },
      },
    },
  ],
  webServer: {
    // Expects the WASM module to be built already (scripts/build-wasm.mjs).
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});
