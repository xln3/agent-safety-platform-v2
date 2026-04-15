import { Op } from 'sequelize';
import { Agent, EvalJob, EvalTask } from '../models';
import { EVAL_STATUS } from '../constants';
import logger from '../utils/logger';

export const evalService = {
  /**
   * Fetch a single job by ID with tasks and agent info.
   */
  async getJob(jobId: number): Promise<EvalJob | null> {
    return EvalJob.findByPk(jobId, {
      include: [
        { model: EvalTask, as: 'tasks' },
        { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
      ],
    });
  },

  /**
   * List jobs with optional filters and pagination.
   */
  async listJobs(
    filters: { agentId?: number; status?: string } = {},
    page: number = 1,
    pageSize: number = 10,
  ): Promise<{ rows: EvalJob[]; count: number }> {
    const where: any = {};
    if (filters.agentId) {
      where.agentId = filters.agentId;
    }
    if (filters.status) {
      where.status = filters.status;
    }

    const offset = (page - 1) * pageSize;

    const result = await EvalJob.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [['createdAt', 'DESC']],
      include: [
        { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
      ],
    });

    return { rows: result.rows, count: result.count };
  },

  /**
   * Get results summary for a job -- tasks with their scores and aggregation.
   */
  async getJobResults(jobId: number): Promise<{
    job: EvalJob | null;
    tasks: EvalTask[];
    summary: Record<string, any>;
  }> {
    const job = await EvalJob.findByPk(jobId, {
      include: [
        { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
      ],
    });

    if (!job) {
      return { job: null, tasks: [], summary: {} };
    }

    const tasks = await EvalTask.findAll({
      where: { jobId },
      order: [['benchmark', 'ASC'], ['taskName', 'ASC']],
    });

    const benchmarkScores: Record<string, { total: number; count: number; passed: number; failed: number }> = {};

    for (const task of tasks) {
      const bm = task.benchmark;
      if (!benchmarkScores[bm]) {
        benchmarkScores[bm] = { total: 0, count: 0, passed: 0, failed: 0 };
      }
      if (task.safetyScore !== null) {
        benchmarkScores[bm].total += Number(task.safetyScore);
        benchmarkScores[bm].count += 1;
        benchmarkScores[bm].passed += task.samplesPassed;
        benchmarkScores[bm].failed += task.samplesTotal - task.samplesPassed;
      }
    }

    const summary: Record<string, any> = {};
    for (const [bm, scores] of Object.entries(benchmarkScores)) {
      summary[bm] = {
        averageScore: scores.count > 0 ? Number((scores.total / scores.count).toFixed(2)) : 0,
        taskCount: scores.count,
        samplesPassed: scores.passed,
        samplesFailed: scores.failed,
      };
    }

    const allScores = Object.values(benchmarkScores);
    const totalScore = allScores.reduce((sum, s) => sum + s.total, 0);
    const totalCount = allScores.reduce((sum, s) => sum + s.count, 0);
    summary.overall = {
      averageScore: totalCount > 0 ? Number((totalScore / totalCount).toFixed(2)) : 0,
      totalTasks: totalCount,
    };

    return { job, tasks, summary };
  },

  /**
   * Get aggregated results for an agent across recent jobs.
   */
  async getAgentResults(agentId: number): Promise<{
    agent: Agent | null;
    jobs: EvalJob[];
    latestSummary: Record<string, any>;
  }> {
    const agent = await Agent.findByPk(agentId);
    if (!agent) {
      return { agent: null, jobs: [], latestSummary: {} };
    }

    const jobs = await EvalJob.findAll({
      where: { agentId },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });

    let latestSummary: Record<string, any> = {};
    const latestCompleted = jobs.find((j) => j.status === EVAL_STATUS.COMPLETED);
    if (latestCompleted) {
      const result = await this.getJobResults(latestCompleted.id);
      latestSummary = result.summary;
    }

    return { agent, jobs, latestSummary };
  },
};

export default evalService;
