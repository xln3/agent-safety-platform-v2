// V2 交付报告：全链路 UI 截图
// 串起 智能体管理 / 新建评估 / 进度 / 结果 / 详情 / 裁判模型 / 工作流表单
// 截图全部归档到 e2e/test-results/delivery/

const { test, expect } = require('@playwright/test');
const path = require('path');
const http = require('http');

const FRONTEND = 'http://localhost:5173';
const SHOTS = path.resolve(__dirname, 'test-results/delivery');

test.use({ viewport: { width: 1440, height: 900 } });

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe('V2 交付走查', () => {
  test('agent list page', async ({ page }) => {
    await page.goto(`${FRONTEND}/agents`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: '新建智能体' })).toBeVisible();
    await shot(page, '01-agents-list');
  });

  test('judge model list page', async ({ page }) => {
    await page.goto(`${FRONTEND}/judge-models`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, '02-judge-models');
  });

  test('eval list with completed jobs', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, '03-eval-list');
  });

  test('new eval form', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/new`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, '04-eval-new-form');
  });

  test('eval progress page (job 28)', async ({ page }) => {
    // SSE 长连接会卡住 networkidle，改用 domcontentloaded
    await page.goto(`${FRONTEND}/eval/progress/28`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('评估进度')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await shot(page, '05-eval-progress-overview');

    // 切到样本明细 tab
    const tab = page.getByRole('tab', { name: '样本明细' });
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(800);
      await shot(page, '06-eval-progress-samples');

      // 打开第一行
      const row = page.locator('table tbody tr.ant-table-row').first();
      await row.click();
      await page.waitForTimeout(800);
      await shot(page, '07-eval-progress-sample-drawer');
      await page.locator('.ant-drawer-close').click();
    }
  });

  test('eval results page (job 28)', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/results/28`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, '08-eval-results-kpi');
  });

  test('agent edit modal — dify chat (smart-search)', async ({ page }) => {
    await page.goto(`${FRONTEND}/agents`, { waitUntil: 'networkidle' });
    // 找 smart-search 行的「编辑」
    const row = page.locator('table tbody tr.ant-table-row', { hasText: 'smart-search' });
    await row.locator('button', { hasText: '编辑' }).click();
    await expect(page.locator('.ant-modal-title')).toBeVisible();
    await page.waitForTimeout(800);
    await shot(page, '09-agent-edit-dify-chat');
    await page.locator('.ant-modal-close').click();
  });

  test('agent create modal — dify workflow form (with mock pull)', async ({ page }) => {
    // 起一个 mock /parameters 服务（与 PR-9 同样的协议）
    const mockServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/v1/parameters')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user_input_form: [
            { 'paragraph': { variable: 'query', label: '提问', required: true, max_length: 4000 } },
            { 'select': { variable: 'lang', label: '语言', required: false, options: ['zh', 'en'] } },
          ],
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });
    await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
    const port = mockServer.address().port;

    try {
      await page.goto(`${FRONTEND}/agents`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '新建智能体' }).click();
      await expect(page.locator('.ant-modal-title')).toBeVisible();
      await page.getByLabel('名称', { exact: true }).fill('demo-dify-workflow');
      await page.locator('.ant-modal').getByLabel('智能体类型').click();
      await page.locator('.ant-select-item-option', { hasText: 'Dify 工作流' }).click();
      await page.getByLabel('Service API Endpoint').fill(`http://127.0.0.1:${port}/v1`);
      await page.getByLabel('API Key', { exact: true }).fill('app-mock-test');
      await shot(page, '10-agent-create-dify-workflow-empty');
      await page.getByRole('button', { name: '拉取参数' }).click();
      await expect(page.locator('input[placeholder*="工作流变量名"]').first()).toHaveValue('query', { timeout: 5_000 });
      await shot(page, '11-agent-create-dify-workflow-pulled');
      await page.locator('.ant-modal-close').click();
    } finally {
      mockServer.close();
    }
  });
});
