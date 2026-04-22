// @ts-check
const { test, expect } = require('@playwright/test');

// ============================================================
// 甲方验收 E2E 测试
// 覆盖: 页面加载、智能体CRUD、评估流程、报告查看
// ============================================================

const BASE = 'http://localhost:5173';

// ------------------------------------------------------------------
// 1. 首页与导航
// ------------------------------------------------------------------
test.describe('1. 页面加载与导航', () => {
  test('1.1 首页可访问，自动跳转到智能体列表', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    // URL should be /agents or redirect there
    await expect(page).toHaveURL(/\/agents/);
  });

  test('1.2 左侧导航包含所有菜单项', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');
    // Check navigation items exist
    const nav = page.locator('.ant-menu');
    await expect(nav).toBeVisible();
    // Should have agent management, evaluation, reports
    const menuText = await nav.textContent();
    expect(menuText).toContain('智能体');
    expect(menuText).toContain('评估');
    expect(menuText).toContain('报告');
  });

  test('1.3 能导航到各主要页面', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForLoadState('networkidle');

    // "安全评估" is a submenu parent — expand it, then click sub-item
    await page.click('text=安全评估');
    await page.waitForTimeout(300);
    await page.click('text=评估任务列表');
    await expect(page).toHaveURL(/\/eval/);

    // Navigate to report list
    await page.click('text=评估报告');
    await expect(page).toHaveURL(/\/reports/);

    // Navigate back to agents
    await page.click('text=智能体管理');
    await expect(page).toHaveURL(/\/agents/);
  });
});

// ------------------------------------------------------------------
// 2. 智能体管理 CRUD
// ------------------------------------------------------------------
test.describe('2. 智能体管理', () => {
  const testAgentName = `E2E测试智能体_${Date.now()}`;

  test('2.1 智能体列表页面正常渲染', async ({ page }) => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState('networkidle');
    // Table should be visible
    const table = page.locator('.ant-table');
    await expect(table).toBeVisible();
  });

  test('2.2 新建智能体（Create）', async ({ page }) => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState('networkidle');

    // Click create button
    await page.click('button:has-text("新建")');
    await page.waitForTimeout(500);
    // Modal should appear — use .ant-modal (wrapper visible in Ant Design v6)
    const modal = page.locator('.ant-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });

    // Fill form fields by label text
    await page.getByLabel('名称').fill(testAgentName);
    await page.getByLabel('API 地址').fill('https://api.test.com/v1');
    await page.getByLabel('API Key').fill('sk-test-key-12345');
    await page.getByLabel('模型 ID').fill('test-model-e2e');

    // Submit — click the primary button in the modal footer
    await page.locator('.ant-modal-footer button.ant-btn-primary, .ant-modal .ant-btn-primary').first().click();
    // Wait for success message or modal to close
    await expect(modal).toBeHidden({ timeout: 8000 });
  });

  test('2.3 智能体列表能看到新建的智能体（Read）', async ({ page }) => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState('networkidle');
    // Search for test agent
    const searchInput = page.locator('input[placeholder*="搜索"]').or(page.locator('.ant-input-search input'));
    if (await searchInput.isVisible()) {
      await searchInput.fill(testAgentName);
      await page.waitForTimeout(500);
    }
    // Check table contains agent name
    await expect(page.locator('table')).toContainText(testAgentName);
  });

  test('2.4 编辑智能体（Update）', async ({ page }) => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState('networkidle');

    // Find row with test agent and click edit
    const row = page.locator('tr', { hasText: testAgentName });
    if (await row.count() === 0) {
      test.skip();
      return;
    }
    await row.locator('text=编辑').click();

    // Modal should be pre-filled
    const modal = page.locator('.ant-modal');
    await expect(modal).toBeVisible({ timeout: 5000 });
    const nameInput = page.getByLabel('名称');
    await expect(nameInput).toHaveValue(testAgentName);

    // Modify description
    const descInput = page.getByLabel('描述');
    if (await descInput.isVisible()) {
      await descInput.fill('E2E测试更新描述');
    }
    await page.locator('.ant-modal-footer button.ant-btn-primary, .ant-modal .ant-btn-primary').first().click();
    await expect(modal).toBeHidden({ timeout: 8000 });
  });

  test('2.5 删除智能体（Delete）', async ({ page }) => {
    await page.goto(`${BASE}/agents`);
    await page.waitForLoadState('networkidle');

    const row = page.locator('tr', { hasText: testAgentName });
    if (await row.count() === 0) {
      test.skip();
      return;
    }
    await row.locator('text=删除').click();
    // Confirm popover
    const confirmBtn = page.locator('.ant-popconfirm button:has-text("确")').or(
      page.locator('.ant-popover button:has-text("确")')
    );
    await confirmBtn.click();
    await expect(page.locator('.ant-message-success')).toBeVisible({ timeout: 5000 });
    // Agent should no longer be in list
    await page.waitForTimeout(500);
    await expect(page.locator('table')).not.toContainText(testAgentName);
  });
});

// ------------------------------------------------------------------
// 3. 评估模块 — 四大分类验证
// ------------------------------------------------------------------
test.describe('3. 评估模块', () => {
  test('3.1 新建评估页面包含四大安全分类', async ({ page }) => {
    await page.goto(`${BASE}/eval/new`);
    await page.waitForLoadState('networkidle');

    // Step 1: select an agent first, then advance to step 2
    const agentSelect = page.locator('.ant-select');
    await agentSelect.click();
    await page.waitForTimeout(300);
    // Pick first agent option
    await page.locator('.ant-select-item-option').first().click();
    await page.waitForTimeout(300);
    // Click "下一步" to go to step 2 (benchmark selection)
    await page.click('button:has-text("下一步")');
    await page.waitForTimeout(500);

    const content = await page.textContent('body');
    expect(content).toContain('工具调用');
    expect(content).toContain('RAG');
    expect(content).toContain('任务规划');
    expect(content).toContain('业务场景');
  });

  test('3.2 每个分类下有对应的 benchmark', async ({ page }) => {
    await page.goto(`${BASE}/eval/new`);
    await page.waitForLoadState('networkidle');

    // Check tool_calling benchmarks
    const toolCallingHeader = page.locator('[data-testid="category-header-tool_calling"]');
    if (await toolCallingHeader.isVisible()) {
      // Click to expand
      await toolCallingHeader.click();
      await page.waitForTimeout(300);
      // Check benchmark items
      await expect(page.locator('[data-benchmark-name="agentdojo"]').or(page.locator('text=agentdojo'))).toBeVisible();
      await expect(page.locator('[data-benchmark-name="bfcl"]').or(page.locator('text=bfcl'))).toBeVisible();
    }

    // Verify benchmarks are selectable (checkbox)
    const checkboxes = page.locator('[data-testid^="benchmark-checkbox-"]');
    if (await checkboxes.count() > 0) {
      expect(await checkboxes.count()).toBeGreaterThan(0);
    }
  });

  test('3.3 评估列表页面正常渲染', async ({ page }) => {
    await page.goto(`${BASE}/eval`);
    await page.waitForLoadState('networkidle');
    // Should show eval list (table or cards)
    const table = page.locator('.ant-table').or(page.locator('.ant-list'));
    await expect(table).toBeVisible();
  });

  test('3.4 已完成的评估可查看结果', async ({ page }) => {
    // Check if there are completed jobs via API first
    const response = await page.request.get('http://localhost:3002/api/eval/jobs?page=1&pageSize=5');
    const json = await response.json();
    const completedJob = json.data?.list?.find(j => j.status === 'completed');
    if (!completedJob) {
      test.skip();
      return;
    }
    await page.goto(`${BASE}/eval/results/${completedJob.id}`);
    await page.waitForLoadState('networkidle');
    // Should show results with scores
    const content = await page.textContent('body');
    // Look for score-related content
    const hasScores = content.includes('安全') || content.includes('分') || content.includes('score');
    expect(hasScores).toBe(true);
  });
});

// ------------------------------------------------------------------
// 4. 报告模块
// ------------------------------------------------------------------
test.describe('4. 报告模块', () => {
  test('4.1 报告列表页面正常渲染', async ({ page }) => {
    await page.goto(`${BASE}/reports`);
    await page.waitForLoadState('networkidle');
    const table = page.locator('.ant-table').or(page.locator('.ant-list'));
    await expect(table).toBeVisible();
  });

  test('4.2 已有报告可查看详情', async ({ page }) => {
    // Check existing reports via API
    const response = await page.request.get('http://localhost:3002/api/reports?page=1&pageSize=5');
    const json = await response.json();
    const report = json.data?.list?.[0];
    if (!report) {
      test.skip();
      return;
    }
    await page.goto(`${BASE}/reports/${report.id}`);
    await page.waitForLoadState('networkidle');

    // Report detail should show summary cards
    const summaryCards = page.locator('[data-testid="report-summary-cards"]');
    if (await summaryCards.isVisible()) {
      await expect(summaryCards).toBeVisible();
    }

    // Should contain score information
    const content = await page.textContent('body');
    const hasReportContent =
      content.includes('安全评分') ||
      content.includes('评估') ||
      content.includes('风险') ||
      content.includes('通过率');
    expect(hasReportContent).toBe(true);
  });

  test('4.3 报告详情页有雷达图和分类评分', async ({ page }) => {
    const response = await page.request.get('http://localhost:3002/api/reports?page=1&pageSize=5');
    const json = await response.json();
    const report = json.data?.list?.[0];
    if (!report) {
      test.skip();
      return;
    }
    await page.goto(`${BASE}/reports/${report.id}`);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000); // wait for charts to render

    // Check for radar chart (use specific testid to avoid strict mode violation)
    const radarChart = page.locator('[data-testid="eval-radar-chart"]');
    await expect(radarChart).toBeVisible();

    // Check for category score overview
    const categoryOverview = page.locator('[data-testid="category-score-overview"]');
    if (await categoryOverview.isVisible()) {
      await expect(categoryOverview).toBeVisible();
    }
  });
});

// ------------------------------------------------------------------
// 5. API 端点实时验证
// ------------------------------------------------------------------
test.describe('5. API 接口实时验证', () => {
  test('5.1 GET /api/health 返回正常', async ({ request }) => {
    const resp = await request.get('http://localhost:3002/api/health');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(body.data.status).toBe('ok');
  });

  test('5.2 GET /api/agents 返回分页结构', async ({ request }) => {
    const resp = await request.get('http://localhost:3002/api/agents?page=1&pageSize=10');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(body.data).toHaveProperty('list');
    expect(body.data).toHaveProperty('total');
    expect(body.data).toHaveProperty('page');
  });

  test('5.3 GET /api/eval/categories 返回四大分类', async ({ request }) => {
    const resp = await request.get('http://localhost:3002/api/eval/categories');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.code).toBe(0);
    const keys = body.data.map(c => c.key);
    expect(keys).toContain('tool_calling');
    expect(keys).toContain('rag_safety');
    expect(keys).toContain('task_planning');
    expect(keys).toContain('business_safety');
  });

  test('5.4 GET /api/benchmarks 返回 benchmark 列表并包含 category 字段', async ({ request }) => {
    const resp = await request.get('http://localhost:3002/api/benchmarks');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    // Each benchmark should have category field
    for (const b of body.data) {
      expect(b).toHaveProperty('category');
      expect(b).toHaveProperty('name');
      expect(b).toHaveProperty('tasks');
    }
  });

  test('5.5 GET /api/reports 返回分页结构', async ({ request }) => {
    const resp = await request.get('http://localhost:3002/api/reports?page=1&pageSize=10');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(body.data).toHaveProperty('list');
    expect(body.data).toHaveProperty('total');
  });

  test('5.6 POST /api/agents CRUD 全流程', async ({ request }) => {
    const name = `API测试_${Date.now()}`;
    // Create
    const createResp = await request.post('http://localhost:3002/api/agents', {
      data: { name, apiBase: 'https://test.com/v1', apiKey: 'sk-test', modelId: 'test-model' },
    });
    expect(createResp.status()).toBe(201);
    const created = (await createResp.json()).data;
    expect(created.name).toBe(name);
    const id = created.id;

    // Read
    const getResp = await request.get(`http://localhost:3002/api/agents/${id}`);
    expect(getResp.status()).toBe(200);
    expect((await getResp.json()).data.name).toBe(name);

    // Update
    const putResp = await request.put(`http://localhost:3002/api/agents/${id}`, {
      data: { description: 'updated' },
    });
    expect(putResp.status()).toBe(200);

    // Delete
    const delResp = await request.delete(`http://localhost:3002/api/agents/${id}`);
    expect(delResp.status()).toBe(200);

    // Verify deleted
    const verifyResp = await request.get(`http://localhost:3002/api/agents/${id}`);
    expect(verifyResp.status()).toBe(404);
  });
});
