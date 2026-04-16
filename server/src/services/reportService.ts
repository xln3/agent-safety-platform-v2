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

function getRiskLevel(score: number): string {
  if (score >= 80) return 'MINIMAL';
  if (score >= 60) return 'LOW';
  if (score >= 40) return 'MEDIUM';
  if (score >= 20) return 'HIGH';
  return 'CRITICAL';
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#3b82f6';
  if (score >= 60) return '#22c55e';
  if (score >= 40) return '#eab308';
  if (score >= 20) return '#f97316';
  return '#ef4444';
}

function getRiskBadgeHtml(level: string): string {
  const labels: Record<string, string> = {
    CRITICAL: '极危', HIGH: '高危', MEDIUM: '中危', LOW: '低危', MINIMAL: '极低',
  };
  return `<span class="risk-badge risk-${level}">${labels[level] || level}</span>`;
}

function getScoreBarHtml(score: number): string {
  const color = getScoreColor(score);
  const pct = Math.max(0, Math.min(100, score));
  return `<div class="score-bar"><div class="score-bar-track"><div class="score-bar-fill" style="width:${pct}%;background:${color}"></div></div><span class="score-bar-value" style="color:${color}">${score.toFixed(1)}</span></div>`;
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

      const categories = Object.entries(radarData).map(([key, value]) => {
        const info = getCategoryInfo(key);
        return { category: key, name: info.name, nameEn: info.nameEn, score: value };
      });

      const categoryDetails = Object.fromEntries(
        Object.entries(categoryData).map(([cat, data]) => [
          cat,
          {
            name: data.info.name,
            nameEn: data.info.nameEn,
            avgScore: data.taskCount > 0 ? Number((data.totalScore / data.taskCount).toFixed(2)) : 0,
            riskLevel: getRiskLevel(data.taskCount > 0 ? data.totalScore / data.taskCount : 0),
            taskCount: data.taskCount,
            samplesPassed: data.samplesPassed,
            samplesTotal: data.samplesTotal,
            tasks: data.tasks,
          },
        ])
      );

      const summary = {
        overallScore,
        totalTasks: allTaskCount,
        samplesPassed: allSamplesPassed,
        samplesTotal: allSamplesTotal,
        passRate: allSamplesTotal > 0 ? Number(((allSamplesPassed / allSamplesTotal) * 100).toFixed(1)) : 0,
        categories,
        categoryDetails,
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
  const overallColor = getScoreColor(summary.overallScore);
  const overallRisk = getRiskLevel(summary.overallScore);

  let categorySectionsHtml = '';
  for (const [, data] of Object.entries(categoryData)) {
    const avgScore = data.taskCount > 0 ? data.totalScore / data.taskCount : 0;
    const catRisk = getRiskLevel(avgScore);

    let taskRowsHtml = '';
    for (const task of data.tasks) {
      const statusLabel = task.status === 'success' ? '成功' : task.status === 'failed' ? '失败' : task.status;
      const statusClass = task.status === 'success' ? 'status-success' : task.status === 'failed' ? 'status-fail' : 'status-other';
      taskRowsHtml += `
          <tr>
            <td style="font-weight:500">${escapeHtml(task.taskName)}</td>
            <td class="text-center"><span class="${statusClass}">${statusLabel}</span></td>
            <td>${getScoreBarHtml(task.score)}</td>
            <td class="text-center">${task.riskLevel ? getRiskBadgeHtml(task.riskLevel) : '<span style="color:#9ca3af">-</span>'}</td>
            <td class="text-center">${task.samplesPassed}/${task.samplesTotal}</td>
            <td class="text-muted">${task.interpretation ? escapeHtml(task.interpretation) : (task.errorMessage ? escapeHtml(task.errorMessage) : '-')}</td>
          </tr>`;
    }

    categorySectionsHtml += `
      <div class="category-section">
        <div class="category-header">
          <div class="category-title">
            <span class="category-name">${escapeHtml(data.info.name)}</span>
            <span class="category-name-en">${escapeHtml(data.info.nameEn)}</span>
            ${getRiskBadgeHtml(catRisk)}
          </div>
          <div class="category-stats">
            <span>平均分：<strong>${avgScore.toFixed(1)}</strong></span>
            <span>任务：<strong>${data.taskCount}</strong></span>
            <span>样本通过：<strong>${data.samplesPassed}/${data.samplesTotal}</strong></span>
          </div>
        </div>
        <div class="category-score-bar">${getScoreBarHtml(avgScore)}</div>
        <table class="task-table">
          <thead>
            <tr>
              <th>任务名称</th>
              <th class="text-center" style="width:70px">状态</th>
              <th style="width:140px">安全评分</th>
              <th class="text-center" style="width:80px">风险等级</th>
              <th class="text-center" style="width:80px">通过/总计</th>
              <th>说明</th>
            </tr>
          </thead>
          <tbody>${taskRowsHtml}
          </tbody>
        </table>
      </div>`;
  }

  // High risk analysis section
  const highRiskTasks: any[] = [];
  for (const [, data] of Object.entries(categoryData)) {
    for (const task of data.tasks) {
      if (task.riskLevel === 'CRITICAL' || task.riskLevel === 'HIGH') {
        highRiskTasks.push({ ...task, categoryName: data.info.name });
      }
    }
  }

  let riskAnalysisHtml = '';
  if (highRiskTasks.length > 0) {
    let riskCardsHtml = '';
    for (const task of highRiskTasks) {
      riskCardsHtml += `
        <div class="risk-card">
          <div class="risk-card-info">
            <div class="risk-card-name">${escapeHtml(task.taskName)}</div>
            <div class="risk-card-meta">${escapeHtml(task.categoryName)} · 评分 ${task.score.toFixed(1)}${task.interpretation ? ` · ${escapeHtml(task.interpretation)}` : ''}</div>
          </div>
          ${getRiskBadgeHtml(task.riskLevel)}
        </div>`;
    }
    riskAnalysisHtml = `
    <div class="section">
      <h2>风险分析（${highRiskTasks.length} 个高危任务）</h2>
      ${riskCardsHtml}
    </div>`;
  }

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(agent.name)} - 安全评估报告</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'PingFang SC', 'Microsoft YaHei', sans-serif; background: #f5f7fa; color: #1f2937; padding: 40px 20px; line-height: 1.6; }
    .report { max-width: 1100px; margin: 0 auto; }
    .report-header { text-align: center; margin-bottom: 40px; }
    .report-title { font-size: 28px; font-weight: 700; color: #111827; margin-bottom: 8px; }
    .report-subtitle { font-size: 14px; color: #6b7280; }
    .report-subtitle span { margin: 0 12px; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px; }
    .summary-card { background: #fff; border-radius: 12px; padding: 24px 16px; text-align: center; box-shadow: 0 1px 3px rgba(0,0,0,0.06); border-top: 4px solid #e5e7eb; }
    .summary-value { font-size: 28px; font-weight: 700; line-height: 1.3; }
    .summary-label { font-size: 13px; color: #6b7280; margin-top: 4px; }
    .risk-badge { display: inline-flex; align-items: center; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; white-space: nowrap; }
    .risk-CRITICAL { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    .risk-HIGH { background: #fff7ed; color: #9a3412; border: 1px solid #fed7aa; }
    .risk-MEDIUM { background: #fefce8; color: #854d0e; border: 1px solid #fef08a; }
    .risk-LOW { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .risk-MINIMAL { background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; }
    .score-bar { display: flex; align-items: center; gap: 8px; }
    .score-bar-track { flex: 1; height: 8px; background: #f3f4f6; border-radius: 4px; overflow: hidden; }
    .score-bar-fill { height: 100%; border-radius: 4px; }
    .score-bar-value { font-size: 13px; font-weight: 600; min-width: 36px; text-align: right; }
    .section { margin-bottom: 24px; }
    .section h2 { font-size: 18px; font-weight: 600; color: #111827; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 2px solid #e5e7eb; }
    .category-section { background: #fff; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); overflow: hidden; }
    .category-header { padding: 20px 24px; border-bottom: 1px solid #f3f4f6; }
    .category-title { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
    .category-name { font-size: 16px; font-weight: 600; color: #111827; }
    .category-name-en { font-size: 13px; color: #9ca3af; }
    .category-stats { display: flex; gap: 24px; font-size: 13px; color: #6b7280; }
    .category-stats strong { color: #374151; }
    .category-score-bar { padding: 12px 24px; border-bottom: 1px solid #f3f4f6; }
    .task-table { width: 100%; border-collapse: collapse; }
    .task-table th { padding: 12px 16px; text-align: left; font-size: 12px; font-weight: 600; color: #6b7280; background: #f9fafb; border-bottom: 1px solid #f3f4f6; }
    .task-table td { padding: 12px 16px; border-bottom: 1px solid #f9fafb; font-size: 13px; color: #374151; }
    .task-table tr:last-child td { border-bottom: none; }
    .task-table tr:hover td { background: #f9fafb; }
    .text-center { text-align: center; }
    .text-muted { color: #9ca3af; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .status-success { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; background: #f0fdf4; color: #166534; }
    .status-fail { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; background: #fef2f2; color: #991b1b; }
    .status-other { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; background: #f5f5f5; color: #666; }
    .risk-card { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: #fff5f5; border: 1px solid #fecaca; border-radius: 8px; margin-bottom: 10px; }
    .risk-card-info { flex: 1; min-width: 0; }
    .risk-card-name { font-size: 14px; font-weight: 500; color: #1f2937; }
    .risk-card-meta { font-size: 12px; color: #6b7280; margin-top: 2px; }
    .report-footer { text-align: center; color: #9ca3af; font-size: 13px; margin-top: 40px; padding-top: 24px; border-top: 1px solid #e5e7eb; }
    @media print { body { padding: 0; background: #fff; } .category-section { break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="report">
    <div class="report-header">
      <h1 class="report-title">智能体安全评估报告</h1>
      <p class="report-subtitle">
        <span>智能体：${escapeHtml(agent.name)}</span>
        <span>模型：${escapeHtml(agent.modelId)}</span>
        <span>评估任务：${escapeHtml(job.name)}</span>
        <span>生成时间：${now}</span>
      </p>
    </div>

    <div class="summary-grid">
      <div class="summary-card" style="border-top-color:${overallColor}">
        <div class="summary-value" style="color:${overallColor}">${summary.overallScore.toFixed(1)}</div>
        <div class="summary-label">综合安全评分</div>
        <div style="margin-top:6px">${getRiskBadgeHtml(overallRisk)}</div>
      </div>
      <div class="summary-card" style="border-top-color:#3b82f6">
        <div class="summary-value" style="color:#3b82f6">${summary.totalTasks}</div>
        <div class="summary-label">评估任务数</div>
      </div>
      <div class="summary-card" style="border-top-color:#22c55e">
        <div class="summary-value" style="color:#22c55e">${summary.samplesPassed}<span style="font-size:16px;color:#9ca3af">/${summary.samplesTotal}</span></div>
        <div class="summary-label">样本通过</div>
      </div>
      <div class="summary-card" style="border-top-color:${summary.passRate >= 60 ? '#22c55e' : '#ef4444'}">
        <div class="summary-value" style="color:${summary.passRate >= 60 ? '#22c55e' : '#ef4444'}">${summary.passRate}%</div>
        <div class="summary-label">通过率</div>
      </div>
    </div>

    <div class="section">
      <h2>评估分类详情</h2>
      ${categorySectionsHtml}
    </div>

    ${riskAnalysisHtml}

    <div class="report-footer">
      <p>由智能体安全评估平台 v2.0 自动生成</p>
      <p>${now}</p>
    </div>
  </div>
</body>
</html>`;
}

export default reportService;
