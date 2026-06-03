/**
 * 用 /api/docs Swagger UI 页面回归甲方 3 条问题：
 *   1) POST 接口 count=20、3 个 benchmark 实际只有 19 项
 *   2) GET 接口拿不到 "完成一条返回一条" 的明细
 *   3) GET 接口 b3 的 output 全是空
 *
 * 选 job 67（生产 2026-04-29 04:14 跑的 dify_chat / b3+bfcl+truthfulqa /
 * count=20 / skipJudge）作为甲方原案的同形态回归——一次 GET 同时回答 3 问。
 *
 * 截图落到 e2e/screenshots/v1-three-issues/，可直接交给甲方。
 */

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Page origin must match the Servers dropdown option we pick (localhost:3002)
// — otherwise the browser treats the API call as cross-origin and the Swagger
// "Try it out" panel shows "Failed to fetch (CORS / Network Failure)".
const BASE = process.env.DOCS_BASE_URL || 'http://localhost:3002';
const SHOT_DIR = path.join(__dirname, 'screenshots', 'v1-three-issues');
const JOB_ID = 67;

test.use({ baseURL: BASE });

test.beforeAll(() => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
});

async function ensureV1Visible(page) {
  // Swagger UI default `docExpansion: list` already expands every tag.
  // NEVER click the tag — that would toggle it shut. Just wait for the V1
  // op-blocks to attach.
  await page
    .locator('[id*="operations-V1"][id*="get_api_v1_evaluate__taskId_"]')
    .first()
    .waitFor({ state: 'attached', timeout: 10000 });

  // Production server (39.105.175.14:3002 EIP) is selected by default in the
  // Servers dropdown but unreachable from inside the same ECS due to NAT
  // hairpin (本机 → EIP 不通; 公网照通). Force `http://localhost:3002` so
  // Try-it-out actually lands on the live process.
  const serverSelect = page.locator('.swagger-ui select').first();
  await serverSelect.selectOption({ label: 'http://localhost:3002 - 本地开发 / Local dev' });

  const v1Tag = page.locator('.swagger-ui .opblock-tag', { hasText: 'V1' }).first();
  await v1Tag.scrollIntoViewIfNeeded();
}

test('Swagger UI 首页加载 + V1 端点存在', async ({ page }) => {
  await page.goto('/api/docs/');
  await page.waitForSelector('.swagger-ui .info .title', { timeout: 15000 });
  await page.waitForTimeout(800);

  const tags = await page.locator('.swagger-ui .opblock-tag').allTextContents();
  expect(tags.join(' ')).toMatch(/V1/);

  await ensureV1Visible(page);

  await page.screenshot({
    path: path.join(SHOT_DIR, '01-swagger-overview.png'),
    fullPage: true,
  });
});

test('GET /api/v1/evaluate/{taskId} 用 Try-it-out 回归 3 条问题', async ({ page }) => {
  await page.goto('/api/docs/');
  await page.waitForSelector('.swagger-ui .info .title', { timeout: 15000 });
  await ensureV1Visible(page);

  const getBlock = page
    .locator('[id*="operations-V1"][id$="get_api_v1_evaluate__taskId_"]')
    .first();
  await getBlock.waitFor({ state: 'visible', timeout: 10000 });
  await getBlock.scrollIntoViewIfNeeded();
  await getBlock.click();
  await page.waitForTimeout(500);

  await getBlock.locator('button.try-out__btn').click();
  await getBlock.locator('input[placeholder="taskId"]').fill(String(JOB_ID));
  await page.screenshot({
    path: path.join(SHOT_DIR, '02-get-tryout-filled.png'),
    fullPage: true,
  });

  await getBlock.locator('button.execute').click();
  // Read the LIVE-CALL response row (above "Responses" doc section). It uses
  // class `.live-responses-table` and contains the actual server reply, not
  // the documented Example Value schema.
  await getBlock
    .locator('.live-responses-table .response')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);

  await getBlock.locator('.responses-wrapper').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(SHOT_DIR, '03-get-response-200.png'),
    fullPage: true,
  });

  // Close-up of just the live response — readable JSON in the cropped image.
  const liveResp = getBlock.locator('.live-responses-table').first();
  await liveResp.scrollIntoViewIfNeeded();
  await liveResp.screenshot({
    path: path.join(SHOT_DIR, '03b-get-response-zoom.png'),
  });

  // Take textContent on the inner <code> element so we don't accidentally
  // include the "Download" button text that sits inside .highlight-code.
  const responseText = await getBlock
    .locator('.live-responses-table .response .highlight-code pre code')
    .first()
    .evaluate((el) => el.textContent);
  const json = JSON.parse(responseText);
  const data = json.data || json;

  expect(data.sampling.count).toBe(20);
  expect(data.totalSamples).toBe(20);
  expect(data.completedSamples).toBe(20);
  expect(data.failedSamples).toBe(0);
  expect(data.tasks.length).toBe(3);

  const allocSum = data.tasks.reduce((s, t) => s + t.samplesTotal, 0);
  expect(allocSum).toBe(20);

  const b3 = data.tasks.find((t) => t.benchmark === 'b3');
  expect(b3, 'b3 task exists').toBeTruthy();
  expect(b3.samplesShown).toBeGreaterThan(0);
  expect(b3.samplesSource).toBe('eval_items');
  for (const s of b3.samples) {
    expect(s.output, `b3 sample ${s.id} output 非空`).toBeTruthy();
    expect(s.output.length, `b3 sample ${s.id} output 长度 > 0`).toBeGreaterThan(0);
  }

  fs.writeFileSync(
    path.join(SHOT_DIR, '04-summary.json'),
    JSON.stringify(
      {
        jobId: JOB_ID,
        issue1_countMath: {
          requested: data.sampling.count,
          totalSamples: data.totalSamples,
          completedSamples: data.completedSamples,
          allocation: data.tasks.map((t) => `${t.benchmark}=${t.samplesTotal}`),
          allocationSum: allocSum,
          pass: data.completedSamples === 20 && allocSum === 20,
        },
        issue2_realtimePerSample: {
          samplesSource: data.tasks.map((t) => `${t.benchmark}:${t.samplesSource}`),
          allUseEvalItems: data.tasks.every((t) => t.samplesSource === 'eval_items'),
          pass: data.tasks.every((t) => t.samplesSource === 'eval_items'),
        },
        issue3_b3OutputEmpty: {
          b3Samples: b3.samples.map((s) => ({
            id: s.id,
            outputLen: (s.output || '').length,
            outputPreview: (s.output || '').slice(0, 80),
          })),
          allNonEmpty: b3.samples.every((s) => (s.output || '').length > 0),
          pass: b3.samples.every((s) => (s.output || '').length > 0),
        },
      },
      null,
      2,
    ),
  );
});

test('GET /api/v1/evaluate/{jobId}/samples 扁平实时拉取', async ({ page }) => {
  await page.goto('/api/docs/');
  await page.waitForSelector('.swagger-ui .info .title', { timeout: 15000 });
  await ensureV1Visible(page);

  const block = page
    .locator('[id*="operations-V1"][id$="get_api_v1_evaluate__jobId__samples"]')
    .first();
  await block.waitFor({ state: 'visible', timeout: 10000 });
  await block.scrollIntoViewIfNeeded();
  await block.click();
  await page.waitForTimeout(500);

  await block.locator('button.try-out__btn').click();
  const inputs = block.locator('.parameters input');
  await inputs.first().fill(String(JOB_ID));
  const pageSizeInput = block.locator('input[placeholder="pageSize"]');
  if (await pageSizeInput.count()) {
    await pageSizeInput.fill('5');
  }

  await block.locator('button.execute').click();
  await block
    .locator('.live-responses-table .response')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForTimeout(800);
  await block.locator('.responses-wrapper').scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(SHOT_DIR, '05-samples-flat.png'),
    fullPage: true,
  });
  // Close-up of the live response for /samples too.
  const liveResp = block.locator('.live-responses-table').first();
  await liveResp.scrollIntoViewIfNeeded();
  await liveResp.screenshot({
    path: path.join(SHOT_DIR, '05b-samples-zoom.png'),
  });
});
