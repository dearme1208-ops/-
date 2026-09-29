import { defineConfig, devices } from "@playwright/test";

// 画面操作テスト。本番ビルドを起動して、本日の作業タブなどの主要な操作が
// 変わらず動くことを確認する(大きなファイルの分割整理など、見た目を変えない
// 変更の安全網)。初回は `npx playwright install chromium` でブラウザを入れておく
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 420, height: 1000 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
  },
  webServer: {
    command: `npm run build && npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
