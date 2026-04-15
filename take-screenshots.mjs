import { chromium } from 'playwright';
import { mkdirSync } from 'fs';

const dir = '/home/xln/agent-safety-platform-refractor/screenshots-fresh';
mkdirSync(dir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const pages = [
  { url: 'http://localhost:5173/agents', name: '01-agents-list', wait: 1500 },
  { url: 'http://localhost:5173/agents/1', name: '02-agent-detail', wait: 1500 },
  { url: 'http://localhost:5173/eval', name: '03-eval-list', wait: 1500 },
  { url: 'http://localhost:5173/eval/new', name: '04-eval-new', wait: 1500 },
  { url: 'http://localhost:5173/eval/results/5', name: '05-eval-results-full', wait: 2000 },
  { url: 'http://localhost:5173/reports', name: '06-report-list', wait: 1500 },
];

for (const p of pages) {
  console.log(`Capturing ${p.name}...`);
  await page.goto(p.url, { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(p.wait);
  await page.screenshot({ path: `${dir}/${p.name}.png`, fullPage: false });
}

// Also capture the eval results tabs
const tabNames = ['单项基准', '高危案例', '数据集'];
const tabFiles = ['07-results-single', '08-results-highrisk', '09-results-dataset'];
for (let i = 0; i < tabNames.length; i++) {
  console.log(`Capturing ${tabFiles[i]}...`);
  await page.goto('http://localhost:5173/eval/results/5', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const tab = page.getByRole('tab', { name: tabNames[i] }).or(page.locator(`text="${tabNames[i]}"`)).first();
  if (await tab.isVisible()) {
    await tab.click();
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `${dir}/${tabFiles[i]}.png`, fullPage: false });
}

// Capture eval progress page for the running job
console.log('Capturing eval progress...');
await page.goto('http://localhost:5173/eval/progress/7', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: `${dir}/10-eval-progress.png`, fullPage: false });

// Capture eval results full page scrolled
console.log('Capturing results full page...');
await page.goto('http://localhost:5173/eval/results/5', { waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.screenshot({ path: `${dir}/11-results-fullpage.png`, fullPage: true });

await browser.close();
console.log('Done!');
