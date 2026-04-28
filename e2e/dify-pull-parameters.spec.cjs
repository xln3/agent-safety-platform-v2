// PR-9 verification: Dify workflow form 拉取参数 button
//
// Spins up an in-process HTTP mock that mimics Dify's GET /parameters response,
// opens the agent create modal, switches to dify_workflow type, fills the
// mock URL, clicks 拉取参数, and asserts the input variable mapping list is
// auto-populated with the discovered variables.

const { test, expect } = require('@playwright/test');
const http = require('http');

const MOCK_PORT = 38765;

const DIFY_PARAMS_PAYLOAD = {
  user_input_form: [
    {
      'text-input': {
        label: 'Query',
        variable: 'query',
        required: true,
        max_length: 256,
        default: '',
      },
    },
    {
      paragraph: {
        label: 'Context',
        variable: 'context',
        required: false,
      },
    },
    {
      select: {
        label: 'Style',
        variable: 'style',
        required: true,
        options: ['concise', 'detailed'],
        default: 'concise',
      },
    },
  ],
};

let mockServer;

test.describe('Dify workflow 拉取参数', () => {
  test.beforeAll(async () => {
    mockServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/v1/parameters') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(DIFY_PARAMS_PAYLOAD));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve));
  });

  test.afterAll(async () => {
    if (mockServer) await new Promise((r) => mockServer.close(r));
  });

  test('button populates inputVariableMappingList from /parameters', async ({ page }) => {
    await page.goto('/agents');
    await expect(page.getByRole('button', { name: '新建智能体' })).toBeVisible();
    await page.getByRole('button', { name: '新建智能体' }).click();

    // Modal opens — wait for the modal title (scoped to avoid the page button).
    await expect(page.locator('.ant-modal-title')).toBeVisible();
    await page.getByLabel('名称', { exact: true }).fill('e2e-dify-workflow-pr9');

    // Switch agent type → dify_workflow. The agent type Select sits at the top
    // of the modal — open it and click the option from the portal dropdown.
    await page.locator('.ant-modal').getByLabel('智能体类型').click();
    await page.locator('.ant-select-item-option', { hasText: 'Dify 工作流' }).click();

    // Fill apiBase + apiKey pointing at the mock.
    await page.getByLabel('Service API Endpoint').fill(`http://127.0.0.1:${MOCK_PORT}/v1`);
    await page.getByLabel('API Key', { exact: true }).fill('app-mock-key');

    // Click 拉取参数.
    await page.getByRole('button', { name: '拉取参数' }).click();

    // Wait for success toast.
    await expect(page.getByText(/拉取成功/)).toBeVisible({ timeout: 10_000 });

    // The form should now have three rows in the mapping list.
    const workflowVarInputs = page.locator('input[placeholder^="工作流变量名"]');
    await expect(workflowVarInputs).toHaveCount(3);

    // Each variable name should be filled in correctly.
    await expect(workflowVarInputs.nth(0)).toHaveValue('query');
    await expect(workflowVarInputs.nth(1)).toHaveValue('context');
    await expect(workflowVarInputs.nth(2)).toHaveValue('style');

    // Tag chip area should mention all three variables.
    await expect(page.getByText('已识别变量')).toBeVisible();
    for (const v of ['query', 'context', 'style']) {
      await expect(page.locator('.ant-tag', { hasText: v })).toBeVisible();
    }

    await page.screenshot({
      path: 'e2e/test-results/pr9-dify-pull-parameters.png',
      fullPage: true,
    });
  });
});
