import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export interface AgentAttributes {
  id: number;
  name: string;
  description: string | null;
  apiBase: string;
  apiKey: string;
  modelId: string;
  systemPrompt: string | null;
  toolsEnabled: boolean;
  enabledTools: string[] | null;
  ragEnabled: boolean;
  ragConfig: object | null;
  features: object | null;
  status: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface AgentCreationAttributes
  extends Optional<AgentAttributes, 'id' | 'description' | 'systemPrompt' | 'toolsEnabled' | 'enabledTools' | 'ragEnabled' | 'ragConfig' | 'features' | 'status' | 'createdAt' | 'updatedAt'> {}

class Agent extends Model<AgentAttributes, AgentCreationAttributes> implements AgentAttributes {
  public id!: number;
  public name!: string;
  public description!: string | null;
  public apiBase!: string;
  public apiKey!: string;
  public modelId!: string;
  public systemPrompt!: string | null;
  public toolsEnabled!: boolean;
  public enabledTools!: string[] | null;
  public ragEnabled!: boolean;
  public ragConfig!: object | null;
  public features!: object | null;
  public status!: string;
  public readonly createdAt!: Date;
  public readonly updatedAt!: Date;
}

Agent.init(
  {
    id: {
      type: DataTypes.INTEGER,
      autoIncrement: true,
      primaryKey: true,
    },
    name: {
      type: DataTypes.STRING(256),
      allowNull: false,
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
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
    systemPrompt: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    toolsEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    enabledTools: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    ragEnabled: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    ragConfig: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    features: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    status: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'active',
    },
  },
  {
    sequelize,
    tableName: 'agents',
    modelName: 'Agent',
  }
);

export default Agent;
