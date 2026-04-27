import type { Agent } from '../../models';
import type { AgentRunner, RunnerInput, RunnerOutput } from './types';
import openaiRunner from './openaiRunner';
import difyChatRunner from './difyChatRunner';
import difyWorkflowRunner from './difyWorkflowRunner';
import cliRunner from './cliRunner';

const RUNNERS: Record<string, AgentRunner> = {
  openai_compat: openaiRunner,
  dify_chat: difyChatRunner,
  dify_workflow: difyWorkflowRunner,
  cli: cliRunner,
};

export function getRunner(agentType: string): AgentRunner {
  const runner = RUNNERS[agentType];
  if (!runner) {
    throw new Error(`No runner registered for agentType=${agentType}`);
  }
  return runner;
}

export async function invokeAgent(agent: Agent, input: RunnerInput): Promise<RunnerOutput> {
  const runner = getRunner(agent.agentType);
  return runner.run(agent, input);
}

export type { AgentRunner, RunnerInput, RunnerOutput };
