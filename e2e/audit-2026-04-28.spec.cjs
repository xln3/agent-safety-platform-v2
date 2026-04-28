// 验收审计 2026-04-28 — 一次性截图全链路
//   写入 _worklog/04-screenshots/audit-2026-04-28/  （在 Playwright outputDir 之外，不被自动清理）
//   每张截图标注对应的验收点 ID（A1..A14），与 V2_DELIVERY_REPORT 的 14 项验收对齐
//   端到端场景使用现网真实 job：
//     - job 28：smart-search Dify 对话型，无裁判，2 样本成功
//     - job 32：smart-search + deepseek 裁判，安全分 50 / 中危
//     - job 39：4 大分类组合（xstest/raccoon/saferag/safeagentbench/b3），10 任务全 completed
//     - job 40：tool_calling 维度证据（open_agent_safety subtask 安全分 100；agentharm/safeagentbench 因缺 JUDGE_MODEL_NAME 评分失败 → job 整体 failed）
//     - job 41：组合任务，状态仍为 running 但 8h+ 无进度 → 僵尸 job 案例

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const http = require('http');

const FRONTEND = 'http://localhost:5173';
const BACKEND = 'http://localhost:3002';
const SHOTS = path.resolve(__dirname, '..', '_worklog', '04-screenshots', 'audit-2026-04-28');
fs.mkdirSync(SHOTS, { recursive: true });

test.use({ viewport: { width: 1440, height: 900 } });

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
}

test.describe('审计 2026-04-28', () => {
  test('A1 智能体管理列表（增删改查入口）', async ({ page }) => {
    await page.goto(`${FRONTEND}/agents`, { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: '新建智能体' })).toBeVisible();
    await shot(page, 'A1-agents-list');
  });

  test('A2 编辑 Dify 对话型 agent — 表单回填', async ({ page }) => {
    await page.goto(`${FRONTEND}/agents`, { waitUntil: 'networkidle' });
    const row = page.locator('table tbody tr.ant-table-row', { hasText: 'smart-search' });
    await row.locator('button', { hasText: '编辑' }).click();
    await expect(page.locator('.ant-modal-title')).toBeVisible();
    await shot(page, 'A2-agent-edit-dify-chat');
    await page.locator('.ant-modal-close').click();
  });

  test('A3 新建 Dify 工作流 agent — 拉取参数 mock', async ({ page }) => {
    const mockServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url.startsWith('/v1/parameters')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          user_input_form: [
            { paragraph: { variable: 'audit_query', label: '审计提问', required: true, max_length: 4000 } },
            { select: { variable: 'audit_lang', label: '语言', required: false, options: ['zh', 'en'] } },
          ],
        }));
      } else { res.writeHead(404); res.end(); }
    });
    await new Promise((r) => mockServer.listen(0, '127.0.0.1', r));
    const port = mockServer.address().port;
    try {
      await page.goto(`${FRONTEND}/agents`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '新建智能体' }).click();
      await page.getByLabel('名称', { exact: true }).fill('audit-dify-workflow');
      await page.locator('.ant-modal').getByLabel('智能体类型').click();
      await page.locator('.ant-select-item-option', { hasText: 'Dify 工作流' }).click();
      await page.getByLabel('Service API Endpoint').fill(`http://127.0.0.1:${port}/v1`);
      await page.getByLabel('API Key', { exact: true }).fill('app-audit');
      await shot(page, 'A3a-dify-workflow-empty');
      await page.getByRole('button', { name: '拉取参数' }).click();
      await expect(page.locator('input[placeholder*="工作流变量名"]').first()).toHaveValue('audit_query', { timeout: 5_000 });
      await shot(page, 'A3b-dify-workflow-pulled');
      await page.locator('.ant-modal-close').click();
    } finally { mockServer.close(); }
  });

  test('A4 裁判模型管理列表（含 deep-deepseek-v4-pro）', async ({ page }) => {
    await page.goto(`${FRONTEND}/judge-models`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, 'A4-judge-models-list');
  });

  test('A5 评估任务列表（27+ jobs）', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, 'A5-eval-list');
  });

  test('A6 新建评估三步表单（智能体 / 基准 / 配置）', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/new`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    await shot(page, 'A6-eval-new-form');
  });

  test('A7 进度页 — job 28 概览 + 样本明细 + 详情抽屉', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/progress/28`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('评估进度')).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await shot(page, 'A7a-progress-overview-28');
    const tab = page.getByRole('tab', { name: '样本明细' });
    if (await tab.count()) {
      await tab.click();
      await page.waitForTimeout(800);
      await shot(page, 'A7b-progress-samples-28');
      const row = page.locator('table tbody tr.ant-table-row').first();
      await row.click();
      await page.waitForTimeout(800);
      await shot(page, 'A7c-progress-sample-drawer-28');
      await page.locator('.ant-drawer-close').click();
    }
  });

  test('A8 结果页 — job 28 KPI 概览', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/results/28`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, 'A8-results-job28-kpi');
  });

  test('A9 结果页 — job 32（裁判生效，50/中危）', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/results/32`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1500);
    await shot(page, 'A9-results-job32-judge-50-medium');
  });

  test('A10 结果页 — job 39 综合 4-cat（xstest/raccoon/saferag/safeagentbench/b3）', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/results/39`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await shot(page, 'A10a-results-job39-overview');
    if (await page.locator('text=维度评估').count()) {
      await page.locator('text=维度评估').first().click();
      await page.waitForTimeout(800);
      await shot(page, 'A10b-results-job39-dimensions');
    }
    if (await page.locator('text=单项基准').count()) {
      await page.locator('text=单项基准').first().click();
      await page.waitForTimeout(800);
      await shot(page, 'A10c-results-job39-per-bench');
    }
    if (await page.locator('text=样本明细').count()) {
      await page.locator('text=样本明细').first().click();
      await page.waitForTimeout(1000);
      await shot(page, 'A10d-results-job39-samples');
    }
  });

  test('A11 结果页 — job 40 tool_calling 维度（部分子任务失败）', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/results/40`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    await shot(page, 'A11a-results-job40-overview');
    if (await page.locator('text=维度评估').count()) {
      await page.locator('text=维度评估').first().click();
      await page.waitForTimeout(800);
      await shot(page, 'A11b-results-job40-dimensions');
    }
  });

  test('A12 进度页 — job 41 僵尸 job（running 8h+ 无进度）', async ({ page }) => {
    await page.goto(`${FRONTEND}/eval/progress/41`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await shot(page, 'A12-progress-job41-zombie');
  });

  test('A13 离线数据集状态接口（前端首页或直接访问 API JSON 渲染）', async ({ page }) => {
    const resp = await page.request.get(`${BACKEND}/api/benchmarks/datasets/status`).catch(() => null);
    if (resp && resp.ok()) {
      const json = await resp.json();
      const html = `<html><body><h2>GET /api/benchmarks/datasets/status</h2><pre>${JSON.stringify(json, null, 2).slice(0, 8000)}</pre></body></html>`;
      await page.setContent(html);
      await shot(page, 'A13-datasets-status-api');
    }
  });

  test('A14 基准目录接口（69 个 benchmark / 16 核心）', async ({ page }) => {
    const resp = await page.request.get(`${BACKEND}/api/benchmarks`).catch(() => null);
    if (resp && resp.ok()) {
      const body = await resp.json();
      const data = (body.data && body.data.list) || body.data || [];
      const cats = data.reduce((acc, r) => {
        const c = r.category || 'other';
        acc[c] = (acc[c] || 0) + 1;
        return acc;
      }, {});
      const html = `<html><body><h2>GET /api/benchmarks</h2><h3>共 ${data.length} 个 benchmark</h3>` +
        `<pre>${JSON.stringify(cats, null, 2)}</pre>` +
        `<table border="1" cellpadding="4"><tr><th>id</th><th>category</th><th>name</th></tr>` +
        data.slice(0, 30).map(r => `<tr><td>${r.id || r.name}</td><td>${r.category || ''}</td><td>${r.name || ''}</td></tr>`).join('') +
        `</table></body></html>`;
      await page.setContent(html);
      await shot(page, 'A14-benchmark-catalog');
    }
  });
});
