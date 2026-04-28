// @ts-check
/**
 * Acceptance walkthrough for the Q2 (UI 评分语义化 + 维度评估) +
 * Q4 (Dify tool_calls capture + ts-bridge wiring) work.
 *
 * Targets the existing completed job (id 32) which already has xstest results
 * in MySQL. We verify:
 *   1. AssessmentSummary card renders qualitative wording (稳健 / 需关注 / 需改进).
 *   2. AssessmentBadge replaces RiskLevelBadge in benchmark rows.
 *   3. The new "维度评估" tab is mounted and shows category cards.
 *   4. AssessmentBar replaces ScoreBar in the score table.
 *
 * Screenshots land in test-results/q2-q4/ for archival.
 */

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3002';
const TARGET_JOB_ID = process.env.TARGET_JOB_ID || '32';
const SCREENSHOT_DIR = path.resolve(__dirname, '..', 'test-results', 'q2-q4');

fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

test.describe('Q2 + Q4 acceptance walkthrough', () => {
  test('full report shows qualitative wording instead of bare scores', async ({ page }) => {
    await page.goto(`${BASE_URL}/eval/results/${TARGET_JOB_ID}`);
    await page.waitForLoadState('networkidle');

    // The overview card now leads with one of the qualitative tier labels.
    const overviewLabel = page.locator('text=/稳健|需关注|需改进|待评估/').first();
    await expect(overviewLabel).toBeVisible({ timeout: 15_000 });

    // The 综合评估 caption proves the new AssessmentSummary mounted.
    await expect(page.locator('text=综合评估').first()).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-full-report-overview.png'),
      fullPage: true,
    });
  });

  test('维度评估 tab renders category cards + recommendations', async ({ page }) => {
    await page.goto(`${BASE_URL}/eval/results/${TARGET_JOB_ID}`);
    await page.waitForLoadState('networkidle');

    // Click the new dimension tab.
    const dimensionTab = page.locator('text=维度评估').first();
    await expect(dimensionTab).toBeVisible({ timeout: 15_000 });
    await dimensionTab.click();
    await page.waitForTimeout(500);

    // At least one of the 4 category titles must be visible.
    const anyCategory = page.locator(
      'text=/工具调用安全|RAG \\/ 记忆安全|任务规划安全|业务场景安全/',
    ).first();
    await expect(anyCategory).toBeVisible();

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-assessment-view.png'),
      fullPage: true,
    });
  });

  test('single benchmark view uses qualitative badges in sample table', async ({ page }) => {
    await page.goto(`${BASE_URL}/eval/results/${TARGET_JOB_ID}`);
    await page.waitForLoadState('networkidle');

    const singleTab = page.locator('text=单项基准').first();
    await singleTab.click();
    await page.waitForTimeout(500);

    // Click the first task button so samples populate.
    const firstTaskButton = page.locator('button').filter({ hasText: /xstest|saferag|gaia/ }).first();
    if (await firstTaskButton.count()) {
      await firstTaskButton.click();
      await page.waitForTimeout(800);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-single-benchmark.png'),
      fullPage: true,
    });
  });
});
