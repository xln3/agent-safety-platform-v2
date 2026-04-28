// PR-7 + PR-8 verification: live SSE progress + per-sample drawer.
//
// Pre-req: backend on :3002, frontend on :5173, agent #1 (doubao-seed-2.0-lite),
//          xstest benchmark venv pre-warmed.

const { test, expect } = require('@playwright/test');

test.describe('SSE progress + sample drawer', () => {
  test.setTimeout(180_000);

  test('live job creation → progress page → samples tab → drawer', async ({ page, request }) => {
    // 1) Create the job via API so we don't depend on the form passing.
    const createRes = await request.post('http://localhost:3002/api/eval/jobs', {
      data: {
        agentId: 1,
        benchmarks: ['xstest'],
        limit: 2,
        concurrency: 2,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const created = await createRes.json();
    const jobId = created.data.id;
    console.log(`Created job ${jobId}`);

    // 2) Visit progress page immediately (so SSE subscribes before samples finish).
    await page.goto(`/eval/progress/${jobId}`);
    await expect(page.getByText('评估进度')).toBeVisible();

    // 3) Watch the progress card update.
    //    Poll the "进度" line (X / Y 任务) for completion.
    await expect.poll(
      async () => {
        const txt = await page.locator('body').innerText();
        const m = txt.match(/进度：\s*(\d+)\s*\/\s*(\d+)\s*任务/);
        if (!m) return null;
        return Number(m[1]) === Number(m[2]) ? 'done' : `${m[1]}/${m[2]}`;
      },
      { timeout: 150_000, intervals: [2000] },
    ).toBe('done');

    // 4) Switch to "样本明细" tab.
    await page.getByRole('tab', { name: /样本明细/ }).click();

    // 5) Expect at least 2 sample rows.
    await expect.poll(
      async () => await page.locator('table tbody tr').count(),
      { timeout: 30_000 },
    ).toBeGreaterThanOrEqual(2);

    // 6) Open the drawer on the first row.
    await page.locator('table tbody tr').first().click();
    await expect(page.getByText('样本详情')).toBeVisible();
    // Drawer should show input/output sections
    await expect(page.getByText('输入', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('模型输出', { exact: true })).toBeVisible();

    // 7) Close drawer and screenshot.
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `e2e/test-results/sse-progress-${jobId}.png`, fullPage: true });
  });
});
