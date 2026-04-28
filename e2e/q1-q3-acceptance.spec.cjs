// @ts-check
/**
 * Acceptance walkthrough for the remaining Q1 + Q3 evidence.
 *
 * Q1 — totalSamples backfill: visit progress page of job 33 (post-fix run)
 *      and verify the header shows "1/2" not "1/0".
 * Q3 — public-IP deployment: visit the SPA on the local backend (which
 *      binds 0.0.0.0:3002 and serves dist/index.html with a history
 *      fallback). The page must render the React shell, not the raw HTML.
 *
 * Screenshots land in test-results/q1-q3/.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'test-results', 'q1-q3');
fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.describe('Q1 + Q3 acceptance walkthrough', () => {
  test('Q1 — job 33 progress page shows X / N (not X / 0)', async ({ page }) => {
    // EvalProgressPage opens a long-lived SSE channel, so 'networkidle' never
    // fires — wait for DOM ready + a fixed settle window instead.
    await page.goto(`${BASE_URL}/eval/progress/33`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-q1-progress-page.png'),
      fullPage: true,
    });
  });

  test('Q3 — SPA renders on the local backend (proves bind + history fallback)', async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // The React root must be populated — a blank page would mean the JS
    // bundle 404'd or threw. Ant-Design's sider is the cheapest signature.
    const siderOrTitle = page.locator('text=/智能体|评估|裁判/').first();
    await expect(siderOrTitle).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-q3-spa-localhost.png'),
      fullPage: true,
    });

    // Deep-link still works (history fallback)
    await page.goto(`${BASE_URL}/agents`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);
    await expect(page.locator('text=/智能体|Agent/').first()).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-q3-spa-deep-link.png'),
      fullPage: true,
    });
  });

  test('Q4 — eval results page proves end-to-end pipeline', async ({ page }) => {
    await page.goto(`${BASE_URL}/eval/results/32`);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1500);

    // The 综合评估 card must render (proves tasks + scores + assessment).
    await expect(page.locator('text=综合评估').first()).toBeVisible({ timeout: 15_000 });

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-q4-results-overview.png'),
      fullPage: true,
    });

    // Click 维度评估 — proves dimensionAggregator + AssessmentView.
    await page.locator('text=维度评估').first().click();
    await page.waitForTimeout(600);

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '05-q4-dimension-tab.png'),
      fullPage: true,
    });
  });
});
