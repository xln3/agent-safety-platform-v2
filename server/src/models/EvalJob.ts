import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface EvalJobAttributes {
  id: number;
  agentId: number;
  name: string;
  status: string;
  benchmarks: string[];
  modelId: string;
  limit: number | null;
  judgeModel: string | null;
  systemPrompt: string | null;
  config: object | null;
  totalTasks: number;
  completedTasks: number;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EvalJobCreationAttributes
  extends Optional<EvalJobAttributes, 'id' | 'status' | 'modelId' | 'limit' | 'judgeModel' | 'systemPrompt' | 'config' | 'totalTasks' | 'completedTasks' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt'> {}

class EvalJob extends Model<EvalJobAttributes, EvalJobCreationAttributes> implements EvalJobAttributes {
  public id!: number;
  public agentId!: number;
  public name!: string;
  public status!: string;
  public benchmarks!: string[];
  public modelId!: string;
  public limit!: number | null;
  public judgeModel!: string | null;
  public systemPrompt!: string | null;
  public config!: object | null;
  public totalTasks!: number;
  public completedTasks!: number;
  public startedAt!: Date | null;
  public completedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EvalJob.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'agents',
        key: 'id',
      },
    },
    name: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'pending',
    },
    benchmarks: {
      type: DataTypes.JSON,
      allowNull: false,
    },
    modelId: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    limit: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    judgeModel: {
      type: DataTypes.STRING(256),
      allowNull: true,
    },
    systemPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    config: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    totalTasks: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    completedTasks: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    completedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'eval_jobs',
    modelName: 'EvalJob',
  }
);

export default EvalJob;
