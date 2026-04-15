import sequelize from '../config/database';
import Agent from './Agent';
import EvalJob from './EvalJob';
import EvalTask from './EvalTask';
import EvalReport from './EvalReport';

// Agent hasMany EvalJob
Agent.hasMany(EvalJob, { foreignKey: 'agentId', as: 'evalJobs' });
EvalJob.belongsTo(Agent, { foreignKey: 'agentId', as: 'agent' });

// EvalJob hasMany EvalTask
EvalJob.hasMany(EvalTask, { foreignKey: 'jobId', as: 'tasks' });
EvalTask.belongsTo(EvalJob, { foreignKey: 'jobId', as: 'job' });

// EvalTask belongsTo Agent
EvalTask.belongsTo(Agent, { foreignKey: 'agentId', as: 'agent' });

// EvalJob hasOne EvalReport
EvalJob.hasOne(EvalReport, { foreignKey: 'jobId', as: 'report' });
EvalReport.belongsTo(EvalJob, { foreignKey: 'jobId', as: 'job' });

// EvalReport belongsTo Agent
EvalReport.belongsTo(Agent, { foreignKey: 'agentId', as: 'agent' });

async function syncDatabase(options?: { force?: boolean; alter?: boolean }): Promise<void> {
  await sequelize.sync(options);
}

export {
  sequelize,
  Agent,
  EvalJob,
  EvalTask,
  EvalReport,
  syncDatabase,
};

export default {
  sequelize,
  Agent,
  EvalJob,
  EvalTask,
  EvalReport,
  syncDatabase,
};
