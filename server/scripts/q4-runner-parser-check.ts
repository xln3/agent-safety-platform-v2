/**
 * Q4 parser-level validation.
 *
 * Spins up a mock Dify /chat-messages SSE server that emits real-shape
 * agent_thought + message events, then runs difyChatRunner against it
 * and asserts the parsed tool_calls match expectations.
 *
 * No DB, no registry, no inspect_ai — purely proves Q4-A's parser logic.
 *
 * Run:  npx tsx server/scripts/q4-runner-parser-check.ts
 */

import http from 'http';
import { difyChatRunner } from '../src/services/agentRunner/difyChatRunner';
import type { Agent } from '../src/models';

const PORT = 7891;

// Real-shape Dify chat-messages streaming events captured from a tool-using app.
const MOCK_FRAMES = [
  // Workflow starts
  `data: ${JSON.stringify({ event: 'workflow_started', task_id: 't1', message_id: 'm1' })}\n\n`,
  // First tool call: web_search with single query
  `data: ${JSON.stringify({
    event: 'agent_thought',
    id: 'th1',
    position: 1,
    thought: 'I need to look this up.',
    tool: 'web_search',
    tool_input: JSON.stringify({ web_search: { query: 'agent safety benchmarks' } }),
    observation: 'Found 3 relevant results about agent safety.',
    message_id: 'm1',
  })}\n\n`,
  // Second tool call: chained tools (web_search;summarize) — tests semicolon split
  `data: ${JSON.stringify({
    event: 'agent_thought',
    id: 'th2',
    position: 2,
    thought: 'Now I will summarize.',
    tool: 'web_search;summarize',
    tool_input: JSON.stringify({
      web_search: { query: 'follow-up' },
      summarize: { text: 'long article body' },
    }),
    observation: 'Summary produced.',
    message_id: 'm1',
  })}\n\n`,
  // Final answer chunks (streaming)
  `data: ${JSON.stringify({ event: 'agent_message', answer: 'Here is what I found: ', message_id: 'm1' })}\n\n`,
  `data: ${JSON.stringify({ event: 'agent_message', answer: 'agent safety benchmarks include xstest and saferag.', message_id: 'm1' })}\n\n`,
  `data: ${JSON.stringify({
    event: 'message_end',
    metadata: { usage: { total_tokens: 123 } },
    conversation_id: 'c1',
  })}\n\n`,
];

function startMockServer(): Promise<http.Server> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || !req.url?.endsWith('/chat-messages')) {
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      // Drain request body, then start writing frames at small intervals to
      // exercise the runner's buffer + \n\n splitter.
      req.on('data', () => {});
      req.on('end', () => {
        let i = 0;
        const tick = () => {
          if (i >= MOCK_FRAMES.length) {
            res.end();
            return;
          }
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
    id: 999,
    name: 'mock-dify-tool-agent',
    agentType: 'dify_chat',
    config: {
      apiBase: `http://127.0.0.1:${PORT}`,
      apiKey: 'mock-key',
    },
    apiBase: null,
    apiKey: null,
    systemPrompt: null,
  } as unknown as Agent;
}

async function main() {
  const server = await startMockServer();
  console.log(`mock dify server listening on :${PORT}`);

  try {
    const result = await difyChatRunner.run(fakeAgent(), {
      agentId: 999,
      jobId: null,
      sampleId: 'mock-sample-1',
      input: 'what are the leading agent-safety benchmarks?',
      messages: [],
      metadata: {},
      target: null,
    });

    console.log('---');
    console.log('output:', JSON.stringify(result.output));
    console.log('latencyMs:', result.latencyMs);
    console.log('toolCalls.length:', result.toolCalls?.length ?? 0);
    console.log('toolCalls:', JSON.stringify(result.toolCalls, null, 2));

    // Assertions
    const tc = result.toolCalls ?? [];
    const errs: string[] = [];
    if (tc.length !== 3) errs.push(`expected 3 tool calls (1 + 2 chained), got ${tc.length}`);
    if (!result.output.includes('agent safety benchmarks')) {
      errs.push(`expected output to contain final answer, got "${result.output}"`);
    }
    if (tc[0]?.name !== 'web_search') errs.push(`call 0 name should be web_search, got "${tc[0]?.name}"`);
    if (tc[0]?.result !== 'Found 3 relevant results about agent safety.') {
      errs.push(`call 0 result missing observation, got "${tc[0]?.result}"`);
    }
    if (tc[1]?.name !== 'web_search') errs.push(`call 1 (chained) name should be web_search, got "${tc[1]?.name}"`);
    if (tc[2]?.name !== 'summarize') errs.push(`call 2 (chained) name should be summarize, got "${tc[2]?.name}"`);
    try {
      const args0 = JSON.parse(tc[0]?.arguments || '{}');
      if (args0.query !== 'agent safety benchmarks') {
        errs.push(`call 0 args missing query, got ${JSON.stringify(args0)}`);
      }
    } catch (e: any) {
      errs.push(`call 0 args not valid JSON: ${e.message}`);
    }

    if (errs.length > 0) {
      console.error('---');
      console.error('FAIL:', errs.join('\n  '));
      process.exitCode = 1;
    } else {
      console.log('---');
      console.log('PASS: difyChatRunner correctly parsed 3 tool calls + final answer.');
    }
  } catch (e: any) {
    console.error('runner threw:', e.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
}

main();
