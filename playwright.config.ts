import { defineConfig } from '@playwright/test';

// Windows 개발 PC는 Playwright 전용 브라우저 다운로드가 막혀 있어 시스템 Edge(Chromium)를 쓰고,
// 맥미니는 설치된 Google Chrome을 쓴다 (PW_CHANNEL로 바꿀 수 있음). WebKit(Safari 엔진)은 검증되지 않는다.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'e2e/.results',
  use: {
    baseURL: 'http://localhost:5174',
    channel: process.env.PW_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chrome'),
    headless: true,
  },
  webServer: {
    command: 'npx vite --port 5174 --strictPort',
    url: 'http://localhost:5174',
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'mobile-touch',
      testIgnore: /desktop.spec.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
      },
    },
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 860 } },
      testMatch: /desktop\.spec\.ts/,
    },
  ],
});
