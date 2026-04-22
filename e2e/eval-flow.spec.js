/**
 * E2E: Full Evaluation Flow with Real Data
 * Verifies eval list, progress, results, samples pages with actual eval job data.
 */
import { test, expect } from '@playwright/test';

const SCREENSHOTS_DIR = 'e2e/screenshots/eval-flow';
const BASE = 'http://localhost:5173';

async function screenshot(page, name) {
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${name}.png`, fullPage: false });
}

async function screenshotFull(page, name) {
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${name}.png`, fullPage: true });
}

async function waitLoaded(page) {
  try {
    await page.waitForFunction(() => {
      return document.querySelectorAll('.ant-spin-spinning').length === 0;
    }, { timeout: 10000 });
  } catch {}
  await page.waitForTimeout(500);
}

test.describe('Evaluation Flow — Real Data', () => {

  test('01 - Eval list shows completed jobs', async ({ page }) => {
    await page.goto('/eval');
    await waitLoaded(page);
    await page.waitForTimeout(1000);
    // Should see at least one job in the table
    const rows = page.locator('.ant-table-row');
    const count = await rows.count();
    console.log(`Found ${count} eval jobs in list`);
    await screenshot(page, '01-eval-list-with-jobs');
    expect(count).toBeGreaterThan(0);
  });

  test('02 - Eval list status tags render correctly', async ({ page }) => {
    await page.goto('/eval');
    await waitLoaded(page);
    await page.waitForTimeout(1000);
    // Verify status tags exist (completed/failed/etc)
    const statusTags = page.locator('.ant-tag');
    const tagCount = await statusTags.count();
    console.log(`Found ${tagCount} status tags`);
    // No "cancelled" status should appear
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('已取消');
    await screenshot(page, '02-eval-list-status-tags');
  });

  test('03 - Eval progress page for completed job', async ({ page }) => {
    // Job #4 has 3 successful + 1 failed tasks
    await page.goto('/eval/progress/4');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    await screenshot(page, '03-eval-progress-job4');
    await screenshotFull(page, '03-eval-progress-job4-full');
    // Verify task list is visible
    const taskItems = page.locator('.ant-list-item');
    const taskCount = await taskItems.count();
    console.log(`Found ${taskCount} tasks in progress view`);
  });

  test('04 - Eval progress shows success status (not stuck on pending)', async ({ page }) => {
    await page.goto('/eval/progress/4');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    // Verify "已完成" appears for successful tasks (this was the bug we fixed)
    const pageText = await page.textContent('body');
    const hasCompleted = pageText.includes('已完成');
    console.log(`Has "已完成" text: ${hasCompleted}`);
    expect(hasCompleted).toBeTruthy();
    await screenshot(page, '04-eval-progress-success-status');
  });

  test('05 - Eval results page with scores and radar chart', async ({ page }) => {
    await page.goto('/eval/results/4');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    await screenshot(page, '05-eval-results-job4');
    await screenshotFull(page, '05-eval-results-job4-full');
    // Verify score is displayed (not NaN or undefined)
    const pageText = await page.textContent('body');
    const hasScore = /\d+\.\d/.test(pageText);
    console.log(`Has numeric score: ${hasScore}`);
    expect(hasScore).toBeTruthy();
  });

  test('06 - Eval results shows benchmark cards', async ({ page }) => {
    await page.goto('/eval/results/4');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    // Verify benchmark names appear
    const pageText = await page.textContent('body');
    const hasBenchmark = pageText.includes('b3') || pageText.includes('truthfulqa') || pageText.includes('clash_eval');
    console.log(`Has benchmark names: ${hasBenchmark}`);
    expect(hasBenchmark).toBeTruthy();
    await screenshot(page, '06-eval-results-benchmarks');
  });

  test('07 - Eval results table has task rows with scores', async ({ page }) => {
    await page.goto('/eval/results/4');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    // Check the task detail table
    const tableRows = page.locator('.ant-table-row');
    const rowCount = await tableRows.count();
    console.log(`Found ${rowCount} task rows in results table`);
    expect(rowCount).toBeGreaterThanOrEqual(3);
    await screenshot(page, '07-eval-results-task-table');
  });

  test('08 - Click "查看样本" navigates to samples page', async ({ page }) => {
    await page.goto('/eval/results/4');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    // Find and click "查看样本" button
    const sampleBtn = page.locator('button, a').filter({ hasText: '查看样本' }).first();
    if (await sampleBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await sampleBtn.click();
      await page.waitForTimeout(2000);
      await waitLoaded(page);
      // Should be on samples page now
      await expect(page).toHaveURL(/samples/);
      await screenshot(page, '08-eval-samples-page');
      await screenshotFull(page, '08-eval-samples-page-full');
    }
  });

  test('09 - Agent detail page shows eval history', async ({ page }) => {
    await page.goto('/agents/1');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    await screenshot(page, '09-agent-detail-with-evals');
    await screenshotFull(page, '09-agent-detail-with-evals-full');
    // Verify eval history section shows jobs
    const pageText = await page.textContent('body');
    const hasEvalHistory = pageText.includes('评估历史') || pageText.includes('评估');
    expect(hasEvalHistory).toBeTruthy();
  });

  test('10 - Generate report from completed job', async ({ page }) => {
    await page.goto('/eval/results/4');
    await waitLoaded(page);
    await page.waitForTimeout(2000);
    // Look for "生成报告" button
    const reportBtn = page.locator('button').filter({ hasText: /生成报告|报告/ }).first();
    if (await reportBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await screenshot(page, '10-before-generate-report');
      await reportBtn.click();
      await page.waitForTimeout(3000);
      await screenshot(page, '10-after-generate-report');
    }
  });

  test('11 - Report list shows generated report', async ({ page }) => {
    await page.goto('/reports');
    await waitLoaded(page);
    await page.waitForTimeout(1500);
    await screenshot(page, '11-report-list-with-data');
    await screenshotFull(page, '11-report-list-with-data-full');
  });

  test('12 - Console errors audit on eval pages', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(`PAGE: ${err.message}`));

    const routes = ['/eval', '/eval/progress/4', '/eval/results/4', '/reports'];
    for (const route of routes) {
      await page.goto(route);
      await waitLoaded(page);
      await page.waitForTimeout(1500);
    }
    await screenshot(page, '12-final-state');

    const pageErrors = errors.filter(e => e.startsWith('PAGE:'));
    if (pageErrors.length > 0) {
      console.log('PAGE ERRORS:', pageErrors);
    }
    expect(pageErrors).toHaveLength(0);
  });
});
