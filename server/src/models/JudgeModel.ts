import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface JudgeModelAttributes {
  id: number;
  name: string;
  apiBase: string;
  apiKey: string;
  modelId: string;
  description: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface JudgeModelCreationAttributes
  extends Optional<JudgeModelAttributes, 'id' | 'description' | 'createdAt' | 'updatedAt'> {}

class JudgeModel
  extends Model<JudgeModelAttributes, JudgeModelCreationAttributes>
  implements JudgeModelAttributes
{
  public id!: number;
  public name!: string;
  public apiBase!: string;
  public apiKey!: string;
  public modelId!: string;
  public description!: string | null;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

JudgeModel.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(128),
      allowNull: false,
      unique: true,
    },
    apiBase: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },
    apiKey: {
      type: DataTypes.STRING(512),
      allowNull: false,
    },
    modelId: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
  },
  {
    sequelize,
    tableName: 'judge_models',
    modelName: 'JudgeModel',
  },
);

export default JudgeModel;
