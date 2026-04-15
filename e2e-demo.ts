import { chromium } from 'playwright';
import path from 'path';

const BASE = 'http://localhost:5177';
const SHOT_DIR = path.resolve('screenshots');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  // 1. Agent List Page
  await page.goto(`${BASE}/agents`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOT_DIR, '01-agents.png'), fullPage: true });
  console.log('✓ 01 智能体列表');

  // 2. Eval Job List
  await page.goto(`${BASE}/eval`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOT_DIR, '02-eval-list.png'), fullPage: true });
  console.log('✓ 02 评估任务列表');

  // 3. Eval Results Page (job #5 is completed)
  await page.goto(`${BASE}/eval/results/5`);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(SHOT_DIR, '03-results-full-report.png'), fullPage: true });
  console.log('✓ 03 评估结果 - 全面报告 Tab');

  // 4. Click "单项基准" tab
  const singleTab = page.locator('div[role="tab"]', { hasText: '单项基准' });
  if (await singleTab.isVisible()) {
    await singleTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '04-results-single-benchmark.png'), fullPage: true });
    console.log('✓ 04 评估结果 - 单项基准 Tab');
  } else {
    console.log('⚠ 04 单项基准 Tab 未找到');
  }

  // 5. Click "高危案例" tab
  const highRiskTab = page.locator('div[role="tab"]', { hasText: '高危案例' });
  if (await highRiskTab.isVisible()) {
    await highRiskTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '05-results-high-risk.png'), fullPage: true });
    console.log('✓ 05 评估结果 - 高危案例 Tab');
  } else {
    console.log('⚠ 05 高危案例 Tab 未找到');
  }

  // 6. Click "数据集" tab
  const datasetTab = page.locator('div[role="tab"]', { hasText: '数据集' });
  if (await datasetTab.isVisible()) {
    await datasetTab.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(SHOT_DIR, '06-results-dataset.png'), fullPage: true });
    console.log('✓ 06 评估结果 - 数据集 Tab');
  } else {
    console.log('⚠ 06 数据集 Tab 未找到');
  }

  // 7. Reports List
  await page.goto(`${BASE}/reports`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOT_DIR, '07-report-list.png'), fullPage: true });
  console.log('✓ 07 报告列表');

  // 8. New Eval page
  await page.goto(`${BASE}/eval/new`);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(SHOT_DIR, '08-eval-new.png'), fullPage: true });
  console.log('✓ 08 新建评估');

  await browser.close();
  console.log('\n✅ 全部截图已保存到 screenshots/ 目录');
}

main().catch(console.error);
