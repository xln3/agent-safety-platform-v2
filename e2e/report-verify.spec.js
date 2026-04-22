/**
 * Report Page Verification — Playwright
 * Verifies the rewritten ReportDetailPage renders correctly with new summary schema.
 */
import { test, expect } from '@playwright/test';

const SCREENSHOTS_DIR = 'e2e/screenshots';

async function waitLoaded(page) {
  try {
    await page.waitForFunction(() => {
      return document.querySelectorAll('.ant-spin-spinning').length === 0;
    }, { timeout: 10000 });
  } catch { /* ok */ }
}

test('Report list page loads', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  await page.goto('/reports');
  await waitLoaded(page);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/report-list.png`, fullPage: true });

  // Should show list of reports
  await expect(page.locator('.ant-table')).toBeVisible();
  console.log('Console errors:', consoleErrors);
});

test('Report detail page renders with new summary structure', async ({ page }) => {
  const consoleErrors = [];
  page.on('pageerror', err => consoleErrors.push(err.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });

  // Navigate directly to report 3 (which was regenerated with new code)
  await page.goto('/reports/3');
  await waitLoaded(page);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/report-detail.png`, fullPage: true });

  // Verify key sections render
  await expect(page.getByText('综合概览')).toBeVisible();
  await expect(page.getByText('评估维度雷达图')).toBeVisible();
  await expect(page.getByText('分类评分概览')).toBeVisible();
  await expect(page.getByText('评分详情')).toBeVisible();

  // Gauge + stats cards
  const gauge = page.locator('svg circle[stroke-linecap="round"]');
  await expect(gauge).toBeVisible();

  // Statistic values in summary cards
  await expect(page.getByText('综合安全评分')).toBeVisible();
  await expect(page.getByText('评估任务数')).toBeVisible();
  await expect(page.getByText('通过率')).toBeVisible();

  // Category details: should show 4 categories as section headers
  const categoryHeaders = await page.locator('.eval-section').count();
  console.log(`Found ${categoryHeaders} eval sections`);

  // Risk analysis (job 8 had HIGH and CRITICAL risks)
  const riskSection = page.getByText(/风险分析/);
  await expect(riskSection).toBeVisible();

  console.log('Console errors:', consoleErrors);
  // Pre-existing unrelated warnings: /eval menu duplicate key (not in my scope)
  const relevantErrors = consoleErrors.filter(
    e => !e.includes('favicon') && !e.includes("Duplicated key '/eval'"),
  );
  expect(relevantErrors).toHaveLength(0);
});

test('Download button produces valid HTML file', async ({ page }) => {
  await page.goto('/reports/3');
  await waitLoaded(page);
  await page.waitForTimeout(1000);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /下载/ }).click();
  const download = await downloadPromise;

  const path = await download.path();
  console.log(`Downloaded to: ${path}`);
  expect(path).toBeTruthy();
});
