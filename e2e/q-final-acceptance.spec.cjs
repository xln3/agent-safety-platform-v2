// @ts-check
/**
 * Final acceptance — combined 4-category run (job 39).
 *
 * Renders the full report + 维度评估 tab on the job that touched all 4
 * priority categories with real benchmark data: xstest, raccoon, saferag,
 * safeagentbench, b3.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'test-results', 'q-final');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.describe('Final 4-category acceptance (job 39)', () => {
  test('full report + dimension tab on combined run', async ({ page }) => {
    await page.goto(`${BASE_URL}/eval/results/39`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await expect(page.locator('text=综合评估').first()).toBeVisible({ timeout: 15_000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-full-report.png'),
      fullPage: true,
    });

    await page.locator('text=维度评估').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-assessment-4cat.png'),
      fullPage: true,
    });

    // Single benchmark drill — pick one of the scored ones.
    await page.locator('text=单项基准').first().click();
    await page.waitForTimeout(800);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-single-benchmark.png'),
      fullPage: true,
    });

    // Sample detail
    await page.locator('text=样本明细').first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-sample-detail.png'),
      fullPage: true,
    });
  });
});
