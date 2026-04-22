/**
 * Export HTML Quality Check — Playwright
 * Renders the downloaded HTML file standalone in a browser for visual verification.
 */
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test('Export HTML renders with professional styling', async ({ page }) => {
  // Trigger download via the report detail page
  await page.goto('/reports/3');
  await page.waitForTimeout(1000);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /下载/ }).click();
  const download = await downloadPromise;

  const tmp = path.resolve('e2e/test-results/exported-report.html');
  await download.saveAs(tmp);

  // Load the exported file in a new browser tab via file:// protocol
  await page.goto(`file://${tmp}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'e2e/screenshots/export-html.png', fullPage: true });

  // Verify structure
  const content = fs.readFileSync(tmp, 'utf-8');
  if (!content.includes('智能体安全评估报告')) throw new Error('Missing title');
  if (!content.includes('risk-badge risk-CRITICAL')) throw new Error('Missing risk badge CSS');
  if (!content.includes('score-bar-fill')) throw new Error('Missing score bar');
  if (!content.includes('综合安全评分')) throw new Error('Missing summary card');
  if (!content.includes('风险分析')) throw new Error('Missing risk analysis');
  console.log('Export HTML content length:', content.length);
});
