// PR-10 final acceptance: drive a real evaluation against the two Dify chat
// agents (smart-search id=11, multi-search id=12) via xstest with limit=2,
// watch the SSE-driven progress page until completion, and verify the
// per-sample EvalItem rows + drawer render real Dify outputs.

const { test, expect } = require('@playwright/test');

const SMART_SEARCH_ID = 11;
const MULTI_SEARCH_ID = 12;
const BACKEND = 'http://localhost:3002';

async function runAgentJob(request, page, agentId, label) {
  // Create the job — limit=2 keeps the run cheap; concurrency=2 exercises parallel paths.
  const createRes = await request.post(`${BACKEND}/api/eval/jobs`, {
    data: {
      agentId,
      benchmarks: ['xstest'],
      limit: 2,
      concurrency: 2,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const created = await createRes.json();
  const jobId = created.data.id;
  console.log(`[${label}] created job ${jobId} for agent ${agentId}`);

  // Open progress page so SSE subscribes early.
  await page.goto(`/eval/progress/${jobId}`);
  await expect(page.getByText('评估进度')).toBeVisible();

  // Poll the progress text until completion (max 5 min — Dify replies usually < 1 min/sample).
  const deadline = Date.now() + 300_000;
  let finalProgressText = '';
  while (Date.now() < deadline) {
    const txt = (await page.locator('.ant-card-body').first().innerText()).replace(/\s/g, '');
    finalProgressText = txt;
    const m = txt.match(/进度[:：](\d+)\/(\d+)/);
    if (m && m[1] === m[2] && parseInt(m[2], 10) > 0) {
      console.log(`[${label}] job ${jobId} reached ${m[1]}/${m[2]}`);
      break;
    }
    await page.waitForTimeout(3000);
  }
  expect(finalProgressText, `[${label}] never reached terminal state`).toMatch(
    /进度[:：](\d+)\/\1/,
  );

  // Switch to the 样本明细 tab.
  await page.getByRole('tab', { name: /样本明细/ }).click();
  await page.waitForTimeout(800);

  // Expect at least 2 sample rows (limit=2). Some retries may add more.
  const rows = page.locator('table tbody tr.ant-table-row');
  await expect(rows).toHaveCount(2, { timeout: 15_000 });

  // Open the first row's drawer and verify the drawer renders.
  await rows.first().click();
  await expect(page.locator('.ant-drawer-title')).toContainText('样本详情', {
    timeout: 5_000,
  });
  // The drawer body must include the "模型输出" header.
  await expect(page.locator('.ant-drawer-body').getByText('模型输出')).toBeVisible();

  // Cross-check via API that the EvalItem actually has substantive outputText.
  const itemsRes = await request.get(
    `${BACKEND}/api/eval/jobs/${jobId}/items?pageSize=10`,
  );
  expect(itemsRes.ok()).toBeTruthy();
  const itemsBody = await itemsRes.json();
  const list = itemsBody?.data?.list || [];
  expect(list.length, `[${label}] no EvalItems persisted`).toBeGreaterThanOrEqual(2);
  const succeeded = list.filter((it) => it.status === 'success');
  expect(succeeded.length, `[${label}] no successful samples`).toBeGreaterThanOrEqual(1);
  const outputPreview = (succeeded[0].outputText || '').slice(0, 80);
  expect(succeeded[0].outputText?.length || 0).toBeGreaterThan(20);

  await page.screenshot({
    path: `e2e/test-results/pr10-${label}-${jobId}.png`,
    fullPage: true,
  });

  // Close drawer.
  await page.locator('.ant-drawer-close').click();
  await page.waitForTimeout(300);

  return { jobId, outputPreview };
}

test.describe('PR-10 Dify chat 端到端验收', () => {
  test.setTimeout(600_000);

  test('smart-search (agent 11) — full SSE/sample lifecycle', async ({ page, request }) => {
    const { jobId, outputPreview } = await runAgentJob(
      request,
      page,
      SMART_SEARCH_ID,
      'smart-search',
    );
    console.log(`smart-search jobId=${jobId} output="${outputPreview}"`);
  });

  test('multi-search (agent 12) — full SSE/sample lifecycle', async ({ page, request }) => {
    const { jobId, outputPreview } = await runAgentJob(
      request,
      page,
      MULTI_SEARCH_ID,
      'multi-search',
    );
    console.log(`multi-search jobId=${jobId} output="${outputPreview}"`);
  });
});
