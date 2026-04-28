// 裁判模型 + 评估打分截图：补 V2 交付报告
// 截图归档到 e2e/test-results/delivery/

const { test, expect } = require('@playwright/test');
const path = require('path');

const FRONTEND = 'http://localhost:5173';
const SHOTS = path.resolve(__dirname, 'test-results/delivery');

test.use({ viewport: { width: 1440, height: 900 } });

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe('裁判模型走查（补充）', () => {
  test('judge model list (with deep-deepseek-v4-pro)', async ({ page }) => {
    await page.goto(`${FRONTEND}/judge-models`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, '12-judge-models-with-deepseek');
  });

  test('eval results page (job 32 — judge=deep-deepseek-v4-pro)', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/results/32`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, '13-eval-results-job32-kpi');
  });

  test('eval list with job 32 visible', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, '14-eval-list-with-job32');
  });
});
