import { defineConfig, devices } from '@playwright/test';

const port = 5191;
const gpuHeadless = process.env.GRAPE_GPU_HEADLESS === '1';

// Every flow runs on both backends. Headless Chromium has no WebGPU adapter,
// so the webgpu project skips there and runs under `npm run check:headed`.
// Specs that do not depend on the backend run once, in the webgl2 project;
// the GPU kernel checks and the benchmarks run on WebGPU only.
const chromium = (['webgl2', 'webgpu'] as const).map((renderer) => ({
  name: renderer,
  metadata: { renderer },
  testIgnore:
    renderer === 'webgl2'
      ? ['**/gpu.spec.ts', '**/*bench.spec.ts']
      : ['**/smoke.spec.ts', '**/parse.spec.ts', '**/layout.spec.ts'],
  use: {
    ...devices['Desktop Chrome'],
    // GRAPE_GPU_HEADLESS=1 runs full Chromium headless on the real GPU
    // through Vulkan, so GPU runs need no display that stays awake.
    ...(gpuHeadless && { channel: 'chromium', headless: true }),
    // Chrome on Linux exposes the real GPU to WebGPU only through Vulkan.
    // Headed runs keep drawing when the window is covered: Chrome otherwise
    // stops animation frames and screenshots for occluded windows.
    launchOptions: {
      args: [
        '--enable-unsafe-webgpu',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--enable-features=Vulkan',
        ...(gpuHeadless && process.platform === 'linux' ? ['--use-angle=vulkan', '--use-vulkan'] : []),
      ],
    },
  },
}));

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
    ...chromium,
    // Packed links also run in Firefox, whose URL limit is half Chrome's.
    {
      name: 'firefox',
      metadata: { renderer: 'webgl2' },
      testMatch: '**/packed-link.spec.ts',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    // Expects the WASM module to be built already (scripts/build-wasm.mjs).
    command: `npx vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
  },
});