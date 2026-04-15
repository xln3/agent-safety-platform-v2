import { Op } from 'sequelize';
import { Agent, EvalJob, EvalTask, EvalReport } from '../models';
import { EVAL_CATEGORIES, REPORT_STATUS } from '../constants';
import logger from '../utils/logger';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getCategoryInfo(key: string): { name: string; nameEn: string } {
  const entry = Object.values(EVAL_CATEGORIES).find((c) => c.key === key);
  return entry
    ? { name: entry.name, nameEn: entry.nameEn }
    : { name: key, nameEn: key };
}

export const reportService = {
  async createReport(agentId: number, jobId: number | null, title: string): Promise<EvalReport> {
    const report = await EvalReport.create({
      agentId,
      jobId,
      title,
      content: '',
      summary: null,
      status: REPORT_STATUS.DRAFT,
    });
    logger.info(`Report created: ${report.id}`);
    return report;
  },

  async getReport(reportId: number): Promise<EvalReport | null> {
    return EvalReport.findByPk(reportId, {
      include: [
        { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
        { model: EvalJob, as: 'job', attributes: ['id', 'name', 'status', 'benchmarks'] },
      ],
    });
  },

  async listReports(
    agentId?: number,
    page: number = 1,
    pageSize: number = 10
  ): Promise<{ rows: EvalReport[]; count: number }> {
    const where: any = {};
    if (agentId) {
      where.agentId = agentId;
    }

    const offset = (page - 1) * pageSize;

    const result = await EvalReport.findAndCountAll({
      where,
      limit: pageSize,
      offset,
      order: [['createdAt', 'DESC']],
      include: [
        { model: Agent, as: 'agent', attributes: ['id', 'name', 'modelId'] },
        { model: EvalJob, as: 'job', attributes: ['id', 'name', 'status'] },
      ],
      attributes: { exclude: ['content'] },
    });

    return { rows: result.rows, count: result.count };
  },

  async updateReport(reportId: number, data: Partial<{ title: string; content: string; summary: object; status: string }>): Promise<EvalReport | null> {
    const report = await EvalReport.findByPk(reportId);
    if (!report) {
      return null;
    }
    await report.update(data);
    logger.info(`Report updated: ${reportId}`);
    return report;
  },

  async deleteReport(reportId: number): Promise<boolean> {
    const report = await EvalReport.findByPk(reportId);
    if (!report) {
      return false;
    }
    await report.destroy();
    logger.info(`Report deleted: ${reportId}`);
    return true;
  },

  async generateReport(jobId: number): Promise<EvalReport> {
    const job = await EvalJob.findByPk(jobId, {
      include: [
        { model: Agent, as: 'agent' },
      ],
    });

    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    const agent = (job as any).agent as Agent;
    if (!agent) {
      throw new Error(`Agent not found for job: ${jobId}`);
    }

    let report = await EvalReport.findOne({ where: { jobId } });
    if (!report) {
      report = await EvalReport.create({
        agentId: job.agentId,
        jobId: job.id,
        title: `${agent.name} - Safety Evaluation Report`,
        content: '',
        summary: null,
        status: REPORT_STATUS.GENERATING,
      });
    } else {
      await report.update({ status: REPORT_STATUS.GENERATING });
    }

    try {
      const tasks = await EvalTask.findAll({
        where: { jobId },
        order: [['benchmark', 'ASC'], ['taskName', 'ASC']],
      });

      const categoryData: Record<string, {
        info: { name: string; nameEn: string };
        tasks: any[];
        totalScore: number;
        taskCount: number;
        samplesPassed: number;
        samplesTotal: number;
      }> = {};

      for (const task of tasks) {
        const cat = task.benchmark;
        if (!categoryData[cat]) {
          categoryData[cat] = {
            info: getCategoryInfo(cat),
            tasks: [],
            totalScore: 0,
            taskCount: 0,
            samplesPassed: 0,
            samplesTotal: 0,
          };
        }

        const taskScore = task.safetyScore !== null ? Number(task.safetyScore) : 0;
        categoryData[cat].tasks.push({
          taskName: task.taskName,
          status: task.status,
          score: taskScore,
          riskLevel: task.riskLevel,
          interpretation: task.interpretation,
          samplesTotal: task.samplesTotal,
          samplesPassed: task.samplesPassed,
          errorMessage: task.errorMessage,
        });
        categoryData[cat].totalScore += taskScore;
        categoryData[cat].taskCount += 1;
        categoryData[cat].samplesPassed += task.samplesPassed;
        categoryData[cat].samplesTotal += task.samplesTotal;
      }

      const radarData: Record<string, number> = {};
      for (const [cat, data] of Object.entries(categoryData)) {
        radarData[cat] = data.taskCount > 0
          ? Number((data.totalScore / data.taskCount).toFixed(2))
          : 0;
      }

      const allTaskCount = Object.values(categoryData).reduce((s, d) => s + d.taskCount, 0);
      const allTotalScore = Object.values(categoryData).reduce((s, d) => s + d.totalScore, 0);
      const overallScore = allTaskCount > 0 ? Number((allTotalScore / allTaskCount).toFixed(2)) : 0;
      const allSamplesPassed = Object.values(categoryData).reduce((s, d) => s + d.samplesPassed, 0);
      const allSamplesTotal = Object.values(categoryData).reduce((s, d) => s + d.samplesTotal, 0);

      const summary = {
        overallScore,
        totalTasks: allTaskCount,
        samplesPassed: allSamplesPassed,
        samplesTotal: allSamplesTotal,
        passRate: allSamplesTotal > 0 ? Number(((allSamplesPassed / allSamplesTotal) * 100).toFixed(1)) : 0,
        categoryScores: radarData,
        radarChartData: Object.entries(radarData).map(([key, value]) => {
          const info = getCategoryInfo(key);
          return { category: key, name: info.name, nameEn: info.nameEn, score: value };
        }),
        generatedAt: new Date().toISOString(),
      };

      const html = buildReportHtml(agent, job, categoryData, summary);

      await report.update({
        title: `${agent.name} - Safety Evaluation Report`,
        content: html,
        summary,
        status: REPORT_STATUS.READY,
      });

      logger.info(`Report generated for job: ${jobId}, report: ${report.id}`);
      return report;
    } catch (error: any) {
      await report.update({
        status: REPORT_STATUS.DRAFT,
        summary: { error: error.message },
      });
      throw error;
    }
  },
};

function buildReportHtml(
  agent: Agent,
  job: EvalJob,
  categoryData: Record<string, any>,
  summary: any
): string {
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  let categorySectionsHtml = '';
  for (const [cat, data] of Object.entries(categoryData)) {
    const avgScore = data.taskCount > 0
      ? (data.totalScore / data.taskCount).toFixed(2)
      : '0.00';

    let taskRowsHtml = '';
    for (const task of data.tasks) {
      const scoreClass = task.score >= 80 ? 'score-high' : task.score >= 60 ? 'score-medium' : 'score-low';
      const riskTag = task.riskLevel ? ` [${task.riskLevel}]` : '';
      taskRowsHtml += `
        <tr>
          <td>${escapeHtml(task.taskName)}</td>
          <td>${escapeHtml(task.status)}</td>
          <td class="${scoreClass}">${task.score.toFixed(1)}${riskTag}</td>
          <td>${task.samplesPassed}/${task.samplesTotal}</td>
          <td>${task.interpretation ? escapeHtml(task.interpretation) : (task.errorMessage ? escapeHtml(task.errorMessage) : '-')}</td>
        </tr>`;
    }

    categorySectionsHtml += `
    <div class="category-section">
      <h3>${escapeHtml(data.info.name)} (${escapeHtml(data.info.nameEn)})</h3>
      <div class="category-summary">
        <span class="metric">Average Safety Score: <strong>${Number(avgScore).toFixed(1)}</strong></span>
        <span class="metric">Tasks: <strong>${data.taskCount}</strong></span>
        <span class="metric">Samples Passed: <strong>${data.samplesPassed}/${data.samplesTotal}</strong></span>
      </div>
      <table class="task-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Score</th>
            <th>Passed/Total</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          ${taskRowsHtml}
        </tbody>
      </table>
    </div>`;
  }

  const overallClass = summary.overallScore >= 80 ? 'score-high' : summary.overallScore >= 60 ? 'score-medium' : 'score-low';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(agent.name)} - Safety Evaluation Report</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; color: #333; }
    .report-container { max-width: 1200px; margin: 0 auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); padding: 40px; }
    h1 { color: #1a1a2e; border-bottom: 3px solid #4361ee; padding-bottom: 10px; }
    h2 { color: #2b2d42; margin-top: 30px; }
    h3 { color: #3d405b; }
    .meta-info { color: #666; margin-bottom: 30px; }
    .meta-info span { margin-right: 20px; }
    .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin: 20px 0; }
    .summary-card { background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center; border-left: 4px solid #4361ee; }
    .summary-card .value { font-size: 2em; font-weight: bold; }
    .summary-card .label { color: #666; margin-top: 5px; }
    .score-high { color: #2ecc71; }
    .score-medium { color: #f39c12; }
    .score-low { color: #e74c3c; }
    .category-section { margin: 20px 0; padding: 20px; background: #fafafa; border-radius: 8px; }
    .category-summary { margin: 10px 0; }
    .category-summary .metric { margin-right: 30px; color: #555; }
    .task-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
    .task-table th, .task-table td { padding: 10px 12px; text-align: left; border-bottom: 1px solid #eee; }
    .task-table th { background: #f0f0f0; font-weight: 600; color: #444; }
    .task-table tr:hover { background: #f5f5ff; }
    .radar-data { display: none; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #eee; color: #999; font-size: 0.9em; text-align: center; }
  </style>
</head>
<body>
  <div class="report-container">
    <h1>Agent Safety Evaluation Report</h1>
    <div class="meta-info">
      <span>Agent: <strong>${escapeHtml(agent.name)}</strong></span>
      <span>Model: <strong>${escapeHtml(agent.modelId)}</strong></span>
      <span>Job: <strong>${escapeHtml(job.name)}</strong></span>
      <span>Generated: <strong>${now}</strong></span>
    </div>

    <h2>Overall Summary</h2>
    <div class="summary-cards">
      <div class="summary-card">
        <div class="value ${overallClass}">${summary.overallScore.toFixed(1)}</div>
        <div class="label">Overall Safety Score (0-100)</div>
      </div>
      <div class="summary-card">
        <div class="value">${summary.totalTasks}</div>
        <div class="label">Total Tasks</div>
      </div>
      <div class="summary-card">
        <div class="value">${summary.samplesPassed}/${summary.samplesTotal}</div>
        <div class="label">Samples Passed</div>
      </div>
      <div class="summary-card">
        <div class="value">${summary.passRate}%</div>
        <div class="label">Pass Rate</div>
      </div>
    </div>

    <h2>Category Breakdown</h2>
    ${categorySectionsHtml}

    <div class="radar-data" id="radarChartData">${JSON.stringify(summary.radarChartData)}</div>

    <div class="footer">
      <p>Generated by Agent Safety Evaluation Platform v2.0</p>
    </div>
  </div>
</body>
</html>`;
}

export default reportService;
