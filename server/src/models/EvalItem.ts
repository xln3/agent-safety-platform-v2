import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type EvalItemStatus = 'pending' | 'running' | 'success' | 'failed';

export interface EvalItemAttributes {
  id: number;
  jobId: number;
  taskId: number;
  benchmark: string;
  sampleId: string;
  inputJson: object | null;
  outputText: string | null;
  score: number | null;
  scoreLabel: string | null;
  judgeRationale: string | null;
  judgeMetadata: object | null;
  /** OpenAI-style tool_calls array captured from the agent's run. Drives tool-use scorers and the sample-detail UI. */
  toolCallsJson: object | null;
  status: EvalItemStatus;
  errorMessage: string | null;
  retryCount: number;
  latencyMs: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EvalItemCreationAttributes
  extends Optional<
    EvalItemAttributes,
    | 'id'
    | 'inputJson'
    | 'outputText'
    | 'score'
    | 'scoreLabel'
    | 'judgeRationale'
    | 'judgeMetadata'
    | 'toolCallsJson'
    | 'status'
    | 'errorMessage'
    | 'retryCount'
    | 'latencyMs'
    | 'startedAt'
    | 'finishedAt'
    | 'createdAt'
    | 'updatedAt'
  > {}

class EvalItem
  extends Model<EvalItemAttributes, EvalItemCreationAttributes>
  implements EvalItemAttributes
{
  public id!: number;
  public jobId!: number;
  public taskId!: number;
  public benchmark!: string;
  public sampleId!: string;
  public inputJson!: object | null;
  public outputText!: string | null;
  public score!: number | null;
  public scoreLabel!: string | null;
  public judgeRationale!: string | null;
  public judgeMetadata!: object | null;
  public toolCallsJson!: object | null;
  public status!: EvalItemStatus;
  public errorMessage!: string | null;
  public retryCount!: number;
  public latencyMs!: number | null;
  public startedAt!: Date | null;
  public finishedAt!: Date | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EvalItem.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    jobId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'eval_jobs', key: 'id' },
      onDelete: 'CASCADE',
    },
    taskId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: { model: 'eval_tasks', key: 'id' },
      onDelete: 'CASCADE',
    },
    benchmark: {
      type: DataTypes.STRING(128),
      allowNull: false,
    },
    sampleId: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    inputJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    outputText: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    score: {
      type: DataTypes.DECIMAL(6, 4),
      allowNull: true,
      get() {
        const v = this.getDataValue('score');
        return v === null ? null : parseFloat(v as unknown as string);
      },
    },
    scoreLabel: {
      type: DataTypes.STRING(64),
      allowNull: true,
    },
    judgeRationale: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    judgeMetadata: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    toolCallsJson: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    status: {
      type: DataTypes.ENUM('pending', 'running', 'success', 'failed'),
      allowNull: false,
      defaultValue: 'pending',
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    retryCount: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    latencyMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    startedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
    finishedAt: {
      type: DataTypes.DATE,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'eval_items',
    modelName: 'EvalItem',
    indexes: [
      { fields: ['job_id', 'task_id'] },
      { fields: ['job_id', 'status'] },
      { fields: ['task_id', 'sample_id'], unique: true },
    ],
  },
);

export default EvalItem;
