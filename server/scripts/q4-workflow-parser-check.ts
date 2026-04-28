/**
 * Q4 workflow-runner parser-level validation.
 *
 * Mocks Dify /workflows/run streaming endpoint with a real-shape sequence
 * (workflow_started → http-request node_finished → knowledge-retrieval
 * node_finished → tool node_finished → text_chunk → workflow_finished),
 * runs difyWorkflowRunner, and asserts:
 *   - 3 tool calls extracted (one per tool-like node type)
 *   - non-tool nodes (LLM, start, end, answer) are filtered out
 *   - final output comes from workflow_finished.outputs[outputField]
 *
 * Run:  npx tsx server/scripts/q4-workflow-parser-check.ts
 */

import http from 'http';
import { difyWorkflowRunner } from '../src/services/agentRunner/difyWorkflowRunner';
import type { Agent } from '../src/models';

const PORT = 7892;

const MOCK_FRAMES = [
  `data: ${JSON.stringify({ event: 'workflow_started', task_id: 't1', workflow_run_id: 'wr1' })}\n\n`,
  // LLM node — should be IGNORED (not a tool node type)
  `data: ${JSON.stringify({
    event: 'node_finished',
    data: {
      id: 'n_llm', node_id: 'llm_1', node_type: 'llm', title: 'Generate query',
      inputs: { query: 'q' }, outputs: { text: 'searching...' }, status: 'succeeded',
      elapsed_time: 0.5,
    },
  })}\n\n`,
  // http-request node — TOOL CALL #1
  `data: ${JSON.stringify({
    event: 'node_finished',
    data: {
      id: 'n_http', node_id: 'http_req_1', node_type: 'http-request', title: 'Fetch ranking',
      inputs: { url: 'https://api.example.com/rank' },
      outputs: { body: '{"top":["a","b"]}', status: 200 },
      status: 'succeeded',
      elapsed_time: 1.234,
    },
  })}\n\n`,
  // knowledge-retrieval node — TOOL CALL #2
  `data: ${JSON.stringify({
    event: 'node_finished',
    data: {
      id: 'n_kb', node_id: 'kb_1', node_type: 'knowledge-retrieval', title: 'KB lookup',
      inputs: { query: 'safety best practices' },
      outputs: { result: [{ doc: 'd1', score: 0.92 }] },
      status: 'succeeded',
      elapsed_time: 0.8,
    },
  })}\n\n`,
  // tool node — TOOL CALL #3
  `data: ${JSON.stringify({
    event: 'node_finished',
    data: {
      id: 'n_tool', node_id: 'tool_1', node_type: 'tool', title: 'CalcTool',
      inputs: { expr: '1+1' },
      outputs: '2',
      status: 'succeeded',
      elapsed_time: 0.05,
    },
  })}\n\n`,
  // start node — should be IGNORED
  `data: ${JSON.stringify({
    event: 'node_finished',
    data: { id: 'n_start', node_id: 'start_1', node_type: 'start', status: 'succeeded' },
  })}\n\n`,
  // text streaming chunks (workflow with `text_chunk` mode)
  `data: ${JSON.stringify({ event: 'text_chunk', data: { text: 'partial...', from_variable_selector: ['answer'] } })}\n\n`,
  // workflow_finished with outputs
  `data: ${JSON.stringify({
    event: 'workflow_finished',
    data: {
      id: 'wr1', workflow_id: 'wf1', status: 'succeeded',
      outputs: { answer: 'Final aggregated answer with 3 sources.', meta: { score: 0.87 } },
      elapsed_time: 2.7,
    },
  })}\n\n`,
];

function startMockServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/workflows/run')) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      req.on('data', () => {});
      req.on('end', () => {
        let i = 0;
        const tick = () => {
          if (i >= MOCK_FRAMES.length) { res.end(); return; }
          res.write(MOCK_FRAMES[i++]);
          setTimeout(tick, 8);
        };
        tick();
      });
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

function fakeAgent(): Agent {
  return {
    id: 998,
    name: 'mock-dify-workflow',
    agentType: 'dify_workflow',
    config: {
      apiBase: `http://127.0.0.1:${PORT}`,
      apiKey: 'mock-key',
      inputVariableMapping: { query: 'input' },
      outputField: 'answer',
    },
    apiBase: null,
    apiKey: null,
    systemPrompt: null,
  } as unknown as Agent;
}

async function main() {
  const server = await startMockServer();
  console.log(`mock dify workflow server on :${PORT}`);

  try {
    const result = await difyWorkflowRunner.run(fakeAgent(), {
      agentId: 998,
      jobId: null,
      sampleId: 'wf-sample-1',
      input: 'test query',
      messages: [],
      metadata: {},
      target: null,
    });

    console.log('---');
    console.log('output:', JSON.stringify(result.output));
    console.log('toolCalls.length:', result.toolCalls?.length ?? 0);
    console.log('toolCalls:', JSON.stringify(result.toolCalls, null, 2));

    const tc = result.toolCalls ?? [];
    const errs: string[] = [];
    if (tc.length !== 3) errs.push(`expected 3 tool-like nodes (http-request, KB, tool), got ${tc.length}`);
    const types = tc.map((c) => (c.metadata as any)?.nodeType);
    if (!types.includes('http-request')) errs.push(`missing http-request, got ${types.join(',')}`);
    if (!types.includes('knowledge-retrieval')) errs.push(`missing knowledge-retrieval, got ${types.join(',')}`);
    if (!types.includes('tool')) errs.push(`missing tool, got ${types.join(',')}`);
    if (types.includes('llm') || types.includes('start')) {
      errs.push(`leaked non-tool node types: ${types.join(',')}`);
    }
    if (result.output !== 'Final aggregated answer with 3 sources.') {
      errs.push(`output should come from outputs.answer, got "${result.output}"`);
    }
    const httpCall = tc.find((c) => (c.metadata as any)?.nodeType === 'http-request');
    if (httpCall && (httpCall.metadata as any)?.elapsedMs !== 1234) {
      errs.push(`elapsedMs not propagated: ${(httpCall?.metadata as any)?.elapsedMs}`);
    }

    if (errs.length > 0) {
      console.error('---');
      console.error('FAIL:\n  ' + errs.join('\n  '));
      process.exitCode = 1;
    } else {
      console.log('---');
      console.log('PASS: difyWorkflowRunner correctly extracted 3 tool calls + filtered non-tool nodes + resolved outputField.');
    }
  } catch (e: any) {
    console.error('runner threw:', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

main();
