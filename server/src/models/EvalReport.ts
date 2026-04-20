import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface EvalReportAttributes {
  id: number;
  agentId: number;
  jobId: number | null;
  title: string;
  content: string;
  summary: object | null;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface EvalReportCreationAttributes
  extends Optional<EvalReportAttributes, 'id' | 'jobId' | 'content' | 'summary' | 'status' | 'createdAt' | 'updatedAt'> {}

class EvalReport extends Model<EvalReportAttributes, EvalReportCreationAttributes> implements EvalReportAttributes {
  public id!: number;
  public agentId!: number;
  public jobId!: number | null;
  public title!: string;
  public content!: string;
  public summary!: object | null;
  public status!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

EvalReport.init(
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
    jobId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'eval_jobs',
        key: 'id',
      },
    },
    title: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },
    content: {
      type: DataTypes.TEXT('long'),
      allowNull: true,
    },
    summary: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'draft',
    },
  },
  {
    sequelize,
    tableName: 'eval_reports',
    modelName: 'EvalReport',
    indexes: [
      { fields: ['agent_id'] },
      { fields: ['job_id'] },
    ],
  }
);

export default EvalReport;
