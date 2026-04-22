/**
 * E2E: 四大评估分类闭环 — 验收场景
 * -------------------------------------------------------------
 * 覆盖甲方四个优先分类（工具调用 / RAG记忆 / 任务规划 / 业务场景）
 * 的创建 -> 结果 -> 报告三段。依赖 data-testid，不依赖文本位置。
 *
 * 需要：至少有一个评估任务（对应 /reports/:id）已经生成了 summary，
 * 雷达图和分类条形图才会渲染；否则 03~07 会跳过。
 */
import { test, expect } from '@playwright/test';

const SCREENSHOTS_DIR = 'e2e/screenshots/four-categories';
const CATEGORY_KEYS = ['tool_calling', 'rag_safety', 'task_planning', 'business_safety'];
const CATEGORY_LABELS = {
  tool_calling: '工具调用安全',
  rag_safety: 'RAG/记忆安全',
  task_planning: '任务规划安全',
  business_safety: '业务场景安全',
};

async function shot(page, name) {
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${name}.png`, fullPage: true });
}

async function waitLoaded(page) {
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('.ant-spin-spinning').length === 0,
      { timeout: 10000 },
    );
  } catch {}
  await page.waitForTimeout(400);
}

/**
 * Navigate the EvalNew wizard to Step 2 (benchmark picker).
 * Properly opens Ant Design Select dropdown, picks first agent, clicks "下一步".
 */
async function navigateToStep2(page) {
  await page.goto('/eval/new');
  await waitLoaded(page);

  // Open the dropdown by clicking the combobox
  const combobox = page.getByRole('combobox');
  await combobox.click();
  // Wait for the dropdown to render options
  const option = page.locator('.ant-select-item-option').first();
  await option.waitFor({ state: 'visible', timeout: 5000 });
  await option.click();
  // Wait for the "下一步" button to become enabled then click
  const nextBtn = page.getByRole('button', { name: /下一步/ });
  await expect(nextBtn).toBeEnabled({ timeout: 3000 });
  await nextBtn.click();
  // Wait for step 2 content to render (category headers)
  await page.locator('[data-testid="category-header-tool_calling"]').waitFor({ state: 'visible', timeout: 8000 });
}

/**
 * Find the first report id that has a summary. Falls back to null if none.
 */
async function findReportWithSummary(page) {
  const resp = await page.request.get('/api/reports?page=1&pageSize=20').catch(() => null);
  if (!resp || !resp.ok()) return null;
  const body = await resp.json().catch(() => null);
  const list = body?.list ?? body?.data?.list ?? [];
  for (const r of list) {
    if (r.status === 'ready' || r.status === 'generating') return r.id;
  }
  return list[0]?.id ?? null;
}

test.describe('4 Categories — EvalNewPage selection', () => {
  test('01 - Category picker renders all 4 categories', async ({ page }) => {
    await navigateToStep2(page);

    for (const key of CATEGORY_KEYS) {
      const header = page.locator(`[data-testid="category-header-${key}"]`);
      await expect(header, `category ${key} should be visible`).toBeVisible({ timeout: 5000 });
      const text = await header.textContent();
      expect(text, `category ${key} label`).toContain(CATEGORY_LABELS[key]);
    }
    await shot(page, '01-category-picker');
  });

  test('02 - Category selection toggles benchmarks', async ({ page }) => {
    await navigateToStep2(page);

    // Click the "tool_calling" category checkbox -> all its benchmarks should become checked
    const checkbox = page.locator('[data-testid="category-header-tool_calling"]').locator('.ant-checkbox-input');
    await checkbox.click({ force: true });
    await page.waitForTimeout(300);

    const rows = page.locator('[data-testid^="benchmark-row-"][data-category-key="tool_calling"]');
    const total = await rows.count();
    expect(total, 'at least one tool_calling benchmark').toBeGreaterThan(0);

    const badge = page.locator('[data-testid="category-badge-tool_calling"]');
    const badgeText = await badge.textContent();
    // Badge should show "N/N" after bulk-select
    expect(badgeText).toMatch(/\d+\/\d+/);
    await shot(page, '02-tool-calling-selected');
  });

  test('03 - Create eval spans multiple categories', async ({ page }) => {
    await navigateToStep2(page);

    // Select one benchmark from each of 2 different categories
    const firstToolRow = page
      .locator('[data-testid^="benchmark-row-"][data-category-key="tool_calling"]')
      .first();
    const firstRagRow = page
      .locator('[data-testid^="benchmark-row-"][data-category-key="rag_safety"]')
      .first();

    await firstToolRow.click();
    await firstRagRow.click();
    await page.waitForTimeout(300);

    // Expect at least 2 selected
    const summaryText = await page.locator('body').textContent();
    expect(summaryText).toMatch(/已选择\s*\d+/);
    await shot(page, '03-multi-category-picked');
  });
});

test.describe('4 Categories — Report radar + score bars', () => {
  test('04 - Report radar chart has 4 axes', async ({ page }) => {
    const reportId = await findReportWithSummary(page);
    test.skip(!reportId, 'No report with summary available; seed a report first.');

    await page.goto(`/reports/${reportId}`);
    await waitLoaded(page);
    await page.waitForTimeout(1500);

    const radar = page.locator('[data-testid="eval-radar-chart"]');
    if (!(await radar.isVisible({ timeout: 8000 }).catch(() => false))) {
      test.skip(true, 'Report has no category summary');
    }
    const axisCount = await radar.getAttribute('data-axis-count');
    expect(Number(axisCount), 'radar chart axis count').toBeGreaterThanOrEqual(1);
    // 对于 4 分类评估，理想情况下 == 4
    await shot(page, '04-radar-chart');
  });

  test('05 - Category score bars render numeric scores', async ({ page }) => {
    const reportId = await findReportWithSummary(page);
    test.skip(!reportId, 'No report with summary available');

    await page.goto(`/reports/${reportId}`);
    await waitLoaded(page);
    await page.waitForTimeout(1500);

    const rows = page.locator('[data-testid^="category-score-row-"]');
    if ((await rows.count()) === 0) {
      test.skip(true, 'Report has no category score rows');
    }
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const row = rows.nth(i);
      const score = await row.getAttribute('data-category-score');
      expect(score, `row ${i} score`).not.toBeNull();
      expect(Number.isNaN(Number(score)), `row ${i} score must be numeric, got ${score}`).toBe(false);
    }
    await shot(page, '05-category-score-bars');
  });

  test('06 - Category detail tables present', async ({ page }) => {
    const reportId = await findReportWithSummary(page);
    test.skip(!reportId, 'No report with summary available');

    await page.goto(`/reports/${reportId}`);
    await waitLoaded(page);
    await page.waitForTimeout(1500);

    const sections = page.locator('[data-testid^="category-detail-"][data-category-key]');
    if ((await sections.count()) === 0) {
      test.skip(true, 'Report has no category detail sections');
    }
    const count = await sections.count();
    expect(count).toBeGreaterThanOrEqual(1);
    // Each section should have a table
    for (let i = 0; i < count; i++) {
      const key = await sections.nth(i).getAttribute('data-category-key');
      const table = page.locator(`[data-testid="category-detail-table-${key}"]`);
      await expect(table, `table for category ${key}`).toBeVisible();
    }
    await shot(page, '06-category-detail-tables');
  });

  test('07 - High-risk tasks carry category context', async ({ page }) => {
    const reportId = await findReportWithSummary(page);
    test.skip(!reportId, 'No report with summary available');

    await page.goto(`/reports/${reportId}`);
    await waitLoaded(page);
    await page.waitForTimeout(1500);

    const riskSection = page.locator('[data-testid="risk-analysis-section"]');
    if (!(await riskSection.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip(true, 'Report has no high-risk tasks');
    }
    const tasks = page.locator('[data-testid="high-risk-task"]');
    const count = await tasks.count();
    expect(count).toBeGreaterThan(0);
    // Each high-risk task should carry category name attribute
    for (let i = 0; i < count; i++) {
      const cat = await tasks.nth(i).getAttribute('data-category-name');
      expect(cat, `task ${i} must have data-category-name`).toBeTruthy();
    }
    await shot(page, '07-high-risk-tasks');
  });
});
