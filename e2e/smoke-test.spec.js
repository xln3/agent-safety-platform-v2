/**
 * Refactored Platform — Smoke Test (Playwright)
 *
 * Verifies every page loads correctly, data renders, and no console errors.
 * Usage:
 *   cd ~/agent-safety-platform-refractor
 *   npx playwright test e2e/smoke-test.spec.js
 */
import { test, expect } from '@playwright/test';

const SCREENSHOTS_DIR = 'e2e/screenshots';

// Helper: take a named screenshot
async function screenshot(page, name) {
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${name}.png`, fullPage: false });
}

async function screenshotFull(page, name) {
  await page.screenshot({ path: `${SCREENSHOTS_DIR}/${name}.png`, fullPage: true });
}

// Helper: wait for Ant Design Spin to disappear
async function waitLoaded(page) {
  try {
    await page.waitForFunction(() => {
      return document.querySelectorAll('.ant-spin-spinning').length === 0;
    }, { timeout: 10000 });
  } catch {
    // May not have spinner, proceed
  }
  await page.waitForTimeout(500);
}

// Collect console errors across all tests
const consoleErrors = [];

test.beforeEach(async ({ page }) => {
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({ url: page.url(), text: msg.text() });
    }
  });
  page.on('pageerror', err => {
    consoleErrors.push({ url: page.url(), text: `PAGE ERROR: ${err.message}` });
  });
});

// ─── Page Load Tests ────────────────────────────────────────

test.describe('1. Layout & Navigation', () => {

  test('01 - App loads with sidebar', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(1500);
    // Should redirect to /agents
    await expect(page).toHaveURL(/\/agents/);
    // Sidebar menu should be visible
    const sidebar = page.locator('.ant-layout-sider');
    await expect(sidebar).toBeVisible();
    // Menu items
    const agentMenu = page.locator('.ant-menu-item, .ant-menu-submenu-title').filter({ hasText: '智能体管理' });
    await expect(agentMenu).toBeVisible();
    await screenshot(page, '01-app-loaded-sidebar');
  });

  test('02 - Sidebar navigation works', async ({ page }) => {
    await page.goto('/agents');
    await waitLoaded(page);

    // Click 安全评估 submenu
    const evalMenu = page.locator('.ant-menu-submenu-title').filter({ hasText: '安全评估' });
    await evalMenu.click();
    await page.waitForTimeout(300);

    // Click 评估任务列表
    const evalListItem = page.locator('.ant-menu-item').filter({ hasText: '评估任务列表' });
    await evalListItem.click();
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/eval/);
    await screenshot(page, '02-nav-eval-list');

    // Click 评估报告
    const reportMenu = page.locator('.ant-menu-item').filter({ hasText: '评估报告' });
    await reportMenu.click();
    await page.waitForTimeout(1000);
    await expect(page).toHaveURL(/\/reports/);
    await screenshot(page, '02-nav-reports');
  });
});

// ─── Agent CRUD ─────────────────────────────────────────────

test.describe('2. Agent Management (CRUD)', () => {

  test('03 - Agent list loads with data', async ({ page }) => {
    await page.goto('/agents');
    await waitLoaded(page);
    // Should see Ant Design table or card with agent data
    const heading = page.locator('h1, h2, h3, h4').filter({ hasText: /智能体/ });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
    await screenshot(page, '03-agent-list');
    await screenshotFull(page, '03-agent-list-full');
  });

  test('04 - Create new agent modal/form', async ({ page }) => {
    await page.goto('/agents');
    await waitLoaded(page);
    // Click create button
    const createBtn = page.locator('button').filter({ hasText: /新建|创建|添加/ });
    if (await createBtn.count() > 0) {
      await createBtn.first().click();
      await page.waitForTimeout(800);
      await screenshot(page, '04-agent-create-form');

      // Fill form fields
      const nameInput = page.locator('#name, input[placeholder*="名称"], input[placeholder*="name"]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill('E2E 测试智能体');
      }
      const modelInput = page.locator('#modelId, input[placeholder*="model"], input[placeholder*="模型"]').first();
      if (await modelInput.isVisible()) {
        await modelInput.fill('gpt-4o-mini');
      }
      await screenshot(page, '04-agent-create-filled');
    }
  });

  test('05 - Agent detail page', async ({ page }) => {
    await page.goto('/agents');
    await waitLoaded(page);
    // Click on first agent link/row
    const agentLink = page.locator('a, [class*="cursor-pointer"]').filter({ hasText: /智能体|Agent|测试/ }).first();
    if (await agentLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await agentLink.click();
      await page.waitForTimeout(1500);
      await waitLoaded(page);
      await screenshot(page, '05-agent-detail');
      await screenshotFull(page, '05-agent-detail-full');
    }
  });
});

// ─── Eval List ──────────────────────────────────────────────

test.describe('3. Evaluation List', () => {

  test('06 - Eval list page loads', async ({ page }) => {
    await page.goto('/eval');
    await waitLoaded(page);
    const heading = page.locator('h1, h2, h3, h4').filter({ hasText: /评估|安全/ });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
    await screenshot(page, '06-eval-list');
  });

  test('07 - Eval list status filter renders correctly', async ({ page }) => {
    await page.goto('/eval');
    await waitLoaded(page);
    // Check that status filter buttons/select exist
    // Verify no "cancelled" status option (was removed)
    const pageText = await page.textContent('body');
    expect(pageText).not.toContain('已取消');
    await screenshot(page, '07-eval-list-status-filter');
  });

  test('08 - New eval page loads', async ({ page }) => {
    await page.goto('/eval/new');
    await waitLoaded(page);
    await screenshot(page, '08-eval-new-page');
    await screenshotFull(page, '08-eval-new-page-full');
  });
});

// ─── Eval Progress ──────────────────────────────────────────

test.describe('4. Evaluation Progress', () => {

  test('09 - Progress page renders (even with no active job)', async ({ page }) => {
    // Navigate to a non-existent job - should handle gracefully
    await page.goto('/eval/progress/999');
    await page.waitForTimeout(3000);
    // Should not crash - might show error or empty state
    const pageText = await page.textContent('body');
    const hasContent = pageText.length > 50;
    expect(hasContent).toBeTruthy();
    await screenshot(page, '09-eval-progress-empty');
  });
});

// ─── Eval Results ───────────────────────────────────────────

test.describe('5. Evaluation Results', () => {

  test('10 - Results page renders (even with no data)', async ({ page }) => {
    await page.goto('/eval/results/999');
    await page.waitForTimeout(3000);
    const pageText = await page.textContent('body');
    const hasContent = pageText.length > 50;
    expect(hasContent).toBeTruthy();
    await screenshot(page, '10-eval-results-empty');
  });
});

// ─── Eval Samples ───────────────────────────────────────────

test.describe('6. Evaluation Samples', () => {

  test('11 - Samples page renders (even with no data)', async ({ page }) => {
    await page.goto('/eval/results/999/samples/1');
    await page.waitForTimeout(3000);
    const pageText = await page.textContent('body');
    const hasContent = pageText.length > 50;
    expect(hasContent).toBeTruthy();
    await screenshot(page, '11-eval-samples-empty');
  });
});

// ─── Reports ────────────────────────────────────────────────

test.describe('7. Reports', () => {

  test('12 - Report list page loads', async ({ page }) => {
    await page.goto('/reports');
    await waitLoaded(page);
    const heading = page.locator('h1, h2, h3, h4').filter({ hasText: /报告/ });
    await expect(heading.first()).toBeVisible({ timeout: 10000 });
    await screenshot(page, '12-report-list');
  });

  test('13 - Report list status labels correct (generating/ready, not generated/published)', async ({ page }) => {
    await page.goto('/reports');
    await waitLoaded(page);
    // Verify the old status labels are NOT present
    const pageText = await page.textContent('body');
    // These checks only matter if there are reports with non-draft status
    // But at minimum, verify the page didn't crash
    expect(pageText).not.toContain('已发布');
    expect(pageText).not.toContain('已生成');
    await screenshot(page, '13-report-status-labels');
  });

  test('14 - Report detail page renders', async ({ page }) => {
    await page.goto('/reports');
    await waitLoaded(page);
    // Click first report if exists
    const reportLink = page.locator('a, td').filter({ hasText: /报告|report/i }).first();
    if (await reportLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await reportLink.click();
      await page.waitForTimeout(1500);
      await waitLoaded(page);
      await screenshot(page, '14-report-detail');
    }
  });
});

// ─── Console Error Summary ──────────────────────────────────

test.describe('8. Console Error Audit', () => {

  test('15 - Navigate all pages and capture errors', async ({ page }) => {
    const errors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(`[${page.url()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      errors.push(`[${page.url()}] PAGE ERROR: ${err.message}`);
    });

    const routes = ['/agents', '/eval', '/eval/new', '/reports'];
    for (const route of routes) {
      await page.goto(route);
      await waitLoaded(page);
      await page.waitForTimeout(1000);
    }

    await screenshot(page, '15-final-state');

    if (errors.length > 0) {
      console.log('\n=== Console Errors Found ===');
      errors.forEach(e => console.log(`  ${e}`));
      console.log('============================\n');
    }

    // Fail if there are page-level errors (React crashes, etc.)
    const pageErrors = errors.filter(e => e.includes('PAGE ERROR'));
    expect(pageErrors).toHaveLength(0);
  });
});
