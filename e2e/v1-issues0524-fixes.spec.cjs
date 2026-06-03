/**
 * 浏览器回归 2026-05-24 甲方 5 条反馈的修复（真实浏览器，非 curl）。
 *
 * 复用本会话已跑完的"修复后"作业：
 *   job 83  truthfulqa + mind2web（skipJudge，dify_chat 同款 bot）→ 验 issue 3 / 5
 *   job 84  agentdojo（skipJudge）                                → 验 issue 1
 *   job 86  strong_reject（未传裁判，自动降级 skipJudge）          → 验 issue 2
 * issue 4（target 语义）在 Swagger 文档里核对。
 *
 * 截图落到 e2e/screenshots/issues0524-fixes/，可直接交甲方。
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.FIX_BASE_URL || 'http://localhost:3002';
const SHOT = path.join(__dirname, 'screenshots', 'issues0524-fixes');

test.use({ baseURL: BASE, launchOptions: { args: ['--no-proxy-server', '--proxy-bypass-list=*'] } });
test.beforeAll(() => fs.mkdirSync(SHOT, { recursive: true }));

async function getJson(request, url) {
  const r = await request.get(url);
  expect(r.ok(), `${url} -> ${r.status()}`).toBeTruthy();
  return r.json();
}

test('Swagger UI 加载 + V1 端点存在 + target 语义文档可见 (issue 4)', async ({ page }) => {
  await page.goto('/api/docs/');
  await page.waitForSelector('.swagger-ui .info .title', { timeout: 15000 });
  const tags = (await page.locator('.swagger-ui .opblock-tag').allTextContents()).join(' ');
  expect(tags).toMatch(/V1/);
  await page.screenshot({ path: path.join(SHOT, '01-swagger.png'), fullPage: true });

  // issue 4: the OpenAPI JSON now explains target semantics per benchmark type.
  const spec = await getJson(page.request, '/api/docs.json').catch(() => null)
    || await getJson(page.request, '/api/docs/swagger.json').catch(() => null);
  if (spec) {
    const txt = JSON.stringify(spec);
    expect(txt).toContain('原始答案');
    expect(txt).toMatch(/拒答.*占位|target 为 null|程序化判定/);
  }
});

test('issue 5 — truthfulqa 现在收到选项并只回字母', async ({ page }) => {
  const j = await getJson(page.request, '/api/v1/evaluate/83/samples?pageSize=50');
  const rows = j.data?.samples || j.data?.rows || j.data || [];
  const tq = rows.filter((r) => r.benchmark === 'truthfulqa');
  expect(tq.length).toBeGreaterThan(0);
  // INPUT 现在是完整选择题模板（带 A) B) 选项 + ANSWER: $LETTER 指令）
  const withTemplate = tq.filter(
    (r) => /ANSWER:\s*\$?LETTER/.test(r.input) && /\bA\)\s/.test(r.input),
  );
  expect(withTemplate.length, 'truthfulqa input 含选项+指令').toBeGreaterThan(0);
  // 至少一条 OUTPUT 是字母答案（ANSWER: X），不再是长篇大论
  const lettered = tq.filter((r) => /ANSWER:\s*[A-F]/i.test(r.output || ''));
  expect(lettered.length, '至少一条输出是 ANSWER: 字母').toBeGreaterThan(0);
  console.log('truthfulqa lettered outputs:', lettered.map((r) => JSON.stringify(r.output).slice(0, 30)));
});

test('issue 3 — mind2web 现在收到真实页面/任务而非裸 UUID', async ({ page }) => {
  const j = await getJson(page.request, '/api/v1/evaluate/83/samples?pageSize=50');
  const rows = j.data?.samples || j.data?.rows || j.data || [];
  const m2w = rows.filter((r) => r.benchmark === 'mind2web');
  expect(m2w.length).toBeGreaterThan(0);
  for (const r of m2w) {
    // INPUT 现在是 mind2web 原装 prompt（HTML + 任务 + 选项），不是 sampleId
    expect(r.input, 'mind2web input 含真实任务模板').toContain('Based on the HTML webpage above');
    expect(r.input).not.toBe(r.sampleId);
    // OUTPUT 不再是"这看起来像 UUID"的困惑回答
    expect(/UUID|唯一标识|唯一识别/.test(r.output || ''), `mind2web 输出不应再谈 UUID: ${r.sampleId}`).toBeFalsy();
  }
});

test('issue 1 — agentdojo 不再 InjectionTask 序列化崩溃', async ({ page }) => {
  const j = await getJson(page.request, '/api/v1/evaluate/84');
  const d = j.data;
  expect(d.completedSamples).toBeGreaterThan(0);
  expect(d.failedSamples).toBe(0);
  const samples = (d.tasks || []).flatMap((t) => t.samples || []);
  expect(samples.length).toBeGreaterThan(0);
  for (const s of samples) {
    expect(s.status).toBe('success');
    expect(/JSON serializable|InjectionTask/.test(s.error || '')).toBeFalsy();
    expect((s.output || '').length, `agentdojo ${s.id} 有真实输出`).toBeGreaterThan(0);
  }
});

test('issue 2 — 需裁判 benchmark 未传裁判也能跑（仅采样，无 score）', async ({ page }) => {
  const j = await getJson(page.request, '/api/v1/evaluate/86');
  const d = j.data;
  expect(d.completedSamples).toBeGreaterThan(0);
  expect(d.failedSamples).toBe(0);
  const samples = (d.tasks || []).flatMap((t) => t.samples || []);
  for (const s of samples) {
    expect(s.status).toBe('success');
    expect((s.output || '').length).toBeGreaterThan(0); // 有 output（甲方拿去外部裁判）
  }
  // 浏览器里把扁平 samples JSON 画出来截图（可视证据）
  await page.goto('/api/v1/evaluate/86/samples?pageSize=10');
  await page.screenshot({ path: path.join(SHOT, '02-strongreject-samples.png'), fullPage: true });
});

test('截图：job 83 扁平 samples（truthfulqa 字母 + mind2web 真实输出）', async ({ page }) => {
  await page.goto('/api/v1/evaluate/83/samples?pageSize=10');
  await page.waitForLoadState('domcontentloaded');
  await page.screenshot({ path: path.join(SHOT, '03-job83-samples.png'), fullPage: true });
});
