import { defineConfig, devices } from '@playwright/test';

const port = 5174;
const gpuHeadless = process.env.GRAPE_GPU_HEADLESS === '1';

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
        // GRAPE_GPU_HEADLESS=1 runs full Chromium headless on the real GPU
        // through Vulkan (Linux), so GPU runs need no display that stays awake.
        ...(gpuHeadless && { channel: 'chromium', headless: true }),
        // Headless WebGPU support varies by machine; tests accept either a
        // WebGPU canvas or a clean fallback message.
        // Chrome on Linux exposes the real GPU to WebGPU only through Vulkan.
        // Headed runs keep drawing when the window is covered: Chrome otherwise
        // stops animation frames and screenshots for occluded windows.
        launchOptions: {
          args: [
            '--enable-unsafe-webgpu',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-background-timer-throttling',
            ...(process.platform === 'linux' ? ['--enable-features=Vulkan'] : []),
            ...(gpuHeadless ? ['--use-angle=vulkan', '--use-vulkan'] : []),
          ],
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
