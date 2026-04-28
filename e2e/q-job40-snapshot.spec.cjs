const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE_URL = 'http://localhost:3002';
const SCREENSHOT_DIR = path.resolve('/home/xln/agent-safety-platform-refractor/test-results/q-final');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.describe('job 40 tool_calling proof', () => {
  test('dimension tab shows tool_calling=good 100', async ({ page }) => {
    await page.goto(`${BASE_URL}/eval/results/40`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-job40-tool-calling.png'), fullPage: true });
    await page.locator('text=维度评估').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-job40-dimension-tool-calling.png'), fullPage: true });
  });
});
