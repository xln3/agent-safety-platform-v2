import { Request, Response } from 'express';
import { agentService } from '../services/agentService';
import { invokeAgent, RunnerInput } from '../services/agentRunner';
import { successResponse, errorResponse } from '../utils/response';
import logger from '../utils/logger';

const MAX_RETRIES = 1;

function isRetriable(err: any): boolean {
  if (!err) return false;
  // axios network/timeout errors
  if (err.code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'ENETUNREACH'].includes(err.code)) {
    return true;
  }
  const status = err.response?.status;
  if (typeof status === 'number') {
    if (status === 429 || status >= 500) return true;
  }
  return false;
}

function parseInput(body: any): RunnerInput | string {
  if (!body || typeof body !== 'object') return 'request body must be a JSON object';
  const agentId = Number(body.agentId);
  if (!agentId || Number.isNaN(agentId)) return 'agentId is required and must be numeric';
  const sampleId = body.sampleId;
  if (!sampleId || typeof sampleId !== 'string') return 'sampleId is required';
  const input = typeof body.input === 'string' ? body.input : '';
  return {
    agentId,
    jobId: body.jobId == null ? null : Number(body.jobId),
    sampleId,
    input,
    messages: Array.isArray(body.messages) ? body.messages : [],
    metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {},
    target: body.target ?? null,
  };
}

export const internalAgentRunnerController = {
  async invoke(req: Request, res: Response): Promise<void> {
    const parsed = parseInput(req.body);
    if (typeof parsed === 'string') {
      res.status(400).json(errorResponse(parsed));
      return;
    }
    const input = parsed;

    try {
      const agent = await agentService.findById(input.agentId);
      if (!agent) {
        res.status(404).json(errorResponse(`Agent ${input.agentId} not found`));
        return;
      }

      let lastErr: any = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const result = await invokeAgent(agent, input);
          res.json(
            successResponse({
              output: result.output,
              latencyMs: result.latencyMs,
              attempts: attempt + 1,
            }),
          );
          return;
        } catch (err: any) {
          lastErr = err;
          logger.warn(
            `Agent ${agent.id} (${agent.agentType}) sample=${input.sampleId} attempt=${attempt + 1} failed: ${err.message}`,
          );
          if (attempt >= MAX_RETRIES || !isRetriable(err)) break;
        }
      }
      res
        .status(502)
        .json(errorResponse(`Agent invocation failed: ${lastErr?.message || 'unknown error'}`));
    } catch (error: any) {
      logger.error(`internal agent runner error: ${error.message}`);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default internalAgentRunnerController;
