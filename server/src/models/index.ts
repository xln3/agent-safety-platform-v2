import sequelize from '../config/database';
import Agent from './Agent';
import EvalJob from './EvalJob';
import EvalTask from './EvalTask';
import EvalReport from './EvalReport';
import EvalItem from './EvalItem';

// Agent hasMany EvalJob
Agent.hasMany(EvalJob, { foreignKey: 'agentId', as: 'evalJobs', onDelete: 'CASCADE' });
EvalJob.belongsTo(Agent, { foreignKey: 'agentId', as: 'agent', onDelete: 'CASCADE' });

// EvalJob hasMany EvalTask
EvalJob.hasMany(EvalTask, { foreignKey: 'jobId', as: 'tasks', onDelete: 'CASCADE' });
EvalTask.belongsTo(EvalJob, { foreignKey: 'jobId', as: 'job', onDelete: 'CASCADE' });

// EvalTask belongsTo Agent
EvalTask.belongsTo(Agent, { foreignKey: 'agentId', as: 'agent', onDelete: 'CASCADE' });

// EvalJob hasOne EvalReport
EvalJob.hasOne(EvalReport, { foreignKey: 'jobId', as: 'report', onDelete: 'CASCADE' });
EvalReport.belongsTo(EvalJob, { foreignKey: 'jobId', as: 'job', onDelete: 'CASCADE' });

// EvalReport belongsTo Agent
EvalReport.belongsTo(Agent, { foreignKey: 'agentId', as: 'agent', onDelete: 'CASCADE' });

// EvalTask hasMany EvalItem
EvalTask.hasMany(EvalItem, { foreignKey: 'taskId', as: 'items', onDelete: 'CASCADE' });
EvalItem.belongsTo(EvalTask, { foreignKey: 'taskId', as: 'task', onDelete: 'CASCADE' });

// EvalJob hasMany EvalItem
EvalJob.hasMany(EvalItem, { foreignKey: 'jobId', as: 'items', onDelete: 'CASCADE' });
EvalItem.belongsTo(EvalJob, { foreignKey: 'jobId', as: 'job', onDelete: 'CASCADE' });

async function syncDatabase(options?: { force?: boolean; alter?: boolean }): Promise<void> {
  await sequelize.sync(options);
}

export {
  sequelize,
  Agent,
  EvalJob,
  EvalTask,
  EvalReport,
  EvalItem,
  syncDatabase,
};

export default {
  sequelize,
  Agent,
  EvalJob,
  EvalTask,
  EvalReport,
  EvalItem,
  syncDatabase,
};
