import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface EvalTaskAttributes {
  id: number;
  jobId: number;
  agentId: number;
  benchmark: string;
  taskName: string;
  status: string;
  evalFile: string | null;
  rawScore: number | null;
  safetyScore: number | null;
  score: number | null;
  riskLevel: string | null;
  interpretation: string | null;
  samplesTotal: number;
  samplesPassed: number;
  errorMessage: string | null;
  resultDetail: object | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EvalTaskCreationAttributes
  extends Optional<EvalTaskAttributes, 'id' | 'status' | 'evalFile' | 'rawScore' | 'safetyScore' | 'score' | 'riskLevel' | 'interpretation' | 'samplesTotal' | 'samplesPassed' | 'errorMessage' | 'resultDetail' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt'> {}

class EvalTask extends Model<EvalTaskAttributes, EvalTaskCreationAttributes> implements EvalTaskAttributes {
  public id!: number;
  public jobId!: number;
  public agentId!: number;
  public benchmark!: string;
  public taskName!: string;
  public status!: string;
  public evalFile!: string | null;
  public rawScore!: number | null;
  public safetyScore!: number | null;
  public score!: number | null;
  public riskLevel!: string | null;
  public interpretation!: string | null;
  public samplesTotal!: number;
  public samplesPassed!: number;
  public errorMessage!: string | null;
  public resultDetail!: object | null;
  public startedAt!: Date | null;
  public completedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EvalTask.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    jobId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'eval_jobs',
        key: 'id',
      },
    },
    agentId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'agents',
        key: 'id',
      },
    },
    benchmark: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    taskName: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'pending',
    },
    evalFile: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    rawScore: {
      type: DataTypes.DECIMAL(10, 4),
      allowNull: true,
      get() {
        const v = this.getDataValue('rawScore');
        return v === null ? null : parseFloat(v as unknown as string);
      },
    },
    safetyScore: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      get() {
        const v = this.getDataValue('safetyScore');
        return v === null ? null : parseFloat(v as unknown as string);
      },
    },
    score: {
      type: DataTypes.DECIMAL(5, 2),
      allowNull: true,
      get() {
        const v = this.getDataValue('score');
        return v === null ? null : parseFloat(v as unknown as string);
      },
    },
    riskLevel: {
      type: DataTypes.STRING(32),
      allowNull: true,
    },
    interpretation: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    samplesTotal: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    samplesPassed: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    resultDetail: {
      type: DataTypes.JSON,
      allowNull: true,
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
    tableName: 'eval_tasks',
    modelName: 'EvalTask',
  }
);

export default EvalTask;
