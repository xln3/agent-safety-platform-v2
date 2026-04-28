// Smoke test: /api/docs renders Swagger UI with our spec.
// Targets the standalone test process on :3099 (not :5173 SPA).

const { test, expect } = require('@playwright/test');

const BASE = process.env.DOCS_BASE_URL || 'http://127.0.0.1:3099';

test.use({ baseURL: BASE });

test('Swagger UI loads and shows our spec', async ({ page }) => {
  await page.goto('/api/docs/');
  await expect(page).toHaveTitle(/智能体安全评估平台|Agent Safety/);

  await page.waitForSelector('.swagger-ui .info .title', { timeout: 15000 });
  const title = await page.textContent('.swagger-ui .info .title');
  expect(title).toMatch(/智能体安全评估平台/);

  const tags = await page.locator('.swagger-ui .opblock-tag').allTextContents();
  expect(tags.join(' ')).toMatch(/Evaluation/);
  expect(tags.join(' ')).toMatch(/Agents/);
  expect(tags.join(' ')).toMatch(/JudgeModels/);

  const operations = page.locator('.swagger-ui .opblock');
  await expect(operations.first()).toBeVisible();

  await page.screenshot({ path: 'e2e/test-results/api-docs.png', fullPage: false });
});

test('docs.json is valid OpenAPI 3', async ({ request }) => {
  const res = await request.get('/api/docs.json');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.openapi).toBe('3.0.3');
  expect(Object.keys(body.paths).length).toBeGreaterThan(15);
  expect(body.paths['/api/eval/jobs']).toBeTruthy();
  expect(body.paths['/api/eval/jobs'].post).toBeTruthy();

  // 甲方 flat-schema endpoints
  expect(body.paths['/api/v1/evaluate']).toBeTruthy();
  expect(body.paths['/api/v1/evaluate'].post).toBeTruthy();
  expect(body.paths['/api/v1/evaluate/{taskId}']).toBeTruthy();
  expect(body.paths['/api/v1/evaluate/{taskId}'].get).toBeTruthy();
  expect(body.components.schemas.V1SubmitRequest).toBeTruthy();
  expect(body.components.schemas.V1StatusResponse).toBeTruthy();
  expect(body.components.schemas.V1JudgeModelInline).toBeTruthy();
  expect(body.components.schemas.V1JudgeModelInline.required).toEqual(
    expect.arrayContaining(['apiBase', 'apiKey', 'modelId']),
  );
});

test('POST /api/v1/evaluate validates required fields', async ({ request }) => {
  // empty body → missing agent
  const r1 = await request.post('/api/v1/evaluate', { data: {} });
  expect(r1.status()).toBe(400);
  expect((await r1.json()).message).toMatch(/agent/);

  // unknown benchmark
  const r2 = await request.post('/api/v1/evaluate', {
    data: {
      agent: { name: 'x', url: 'https://x', key: 'k', modelId: 'gpt-4o' },
      benchmarks: ['__nope__'],
    },
  });
  expect(r2.status()).toBe(400);
  expect((await r2.json()).message).toMatch(/Unknown benchmark/);
});
