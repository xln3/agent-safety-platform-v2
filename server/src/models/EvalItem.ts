import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface EvalItemAttributes {
  id: number;
  taskId: number;
  jobId: number;
  itemIndex: number;
  input: string;
  expectedOutput: string | null;
  actualOutput: string | null;
  status: string;
  errorMessage: string | null;
  latencyMs: number | null;
  metadata: object | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EvalItemCreationAttributes
  extends Optional<EvalItemAttributes, 'id' | 'expectedOutput' | 'actualOutput' | 'status' | 'errorMessage' | 'latencyMs' | 'metadata' | 'startedAt' | 'completedAt' | 'createdAt' | 'updatedAt'> {}

class EvalItem extends Model<EvalItemAttributes, EvalItemCreationAttributes> implements EvalItemAttributes {
  public id!: number;
  public taskId!: number;
  public jobId!: number;
  public itemIndex!: number;
  public input!: string;
  public expectedOutput!: string | null;
  public actualOutput!: string | null;
  public status!: string;
  public errorMessage!: string | null;
  public latencyMs!: number | null;
  public metadata!: object | null;
  public startedAt!: Date | null;
  public completedAt!: Date | null;
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
    taskId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'eval_tasks',
        key: 'id',
      },
    },
    jobId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'eval_jobs',
        key: 'id',
      },
    },
    itemIndex: {
      type: DataTypes.INTEGER,
      allowNull: false,
    },
    input: {
      type: DataTypes.TEXT,
      allowNull: false,
    },
    expectedOutput: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    actualOutput: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'pending',
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    latencyMs: {
      type: DataTypes.INTEGER,
      allowNull: true,
    },
    metadata: {
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
    tableName: 'eval_items',
    modelName: 'EvalItem',
    indexes: [
      { fields: ['job_id'] },
      { fields: ['task_id'] },
    ],
  }
);

export default EvalItem;
