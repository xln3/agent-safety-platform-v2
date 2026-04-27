import { DataTypes, Model, Optional } from 'sequelize';
import sequelize from '../config/database';

export type AgentType = 'openai_compat' | 'dify_chat' | 'dify_workflow' | 'cli';

/** Per-agent-type config payload — stored in `config` JSON column. */
export type AgentConfig =
  | { apiBase: string; apiKey: string; modelId: string; systemPrompt?: string | null } // openai_compat
  | { apiBase: string; apiKey: string; systemPrompt?: string | null }                   // dify_chat
  | { apiBase: string; apiKey: string; inputVariableMapping: Record<string, string> }   // dify_workflow
  | {
      commandTemplate: string;
      inputMode: 'placeholder' | 'stdin';
      timeoutSec?: number;
      env?: Record<string, string>;
    };                                                                                  // cli

export interface AgentAttributes {
  id: number;
  name: string;
  agentType: string;
  description: string | null;
  config: AgentConfig | null;
  // Legacy fields (pre-v2) — retained for backward compatibility while older rows exist.
  apiBase: string | null;
  apiKey: string | null;
  modelId: string | null;
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
  extends Optional<
    AgentAttributes,
    | 'id'
    | 'agentType'
    | 'description'
    | 'config'
    | 'apiBase'
    | 'apiKey'
    | 'modelId'
    | 'systemPrompt'
    | 'toolsEnabled'
    | 'enabledTools'
    | 'ragEnabled'
    | 'ragConfig'
    | 'features'
    | 'status'
    | 'createdAt'
    | 'updatedAt'
  > {}

class Agent extends Model<AgentAttributes, AgentCreationAttributes> implements AgentAttributes {
  public id!: number;
  public name!: string;
  public agentType!: string;
  public description!: string | null;
  public config!: AgentConfig | null;
  public apiBase!: string | null;
  public apiKey!: string | null;
  public modelId!: string | null;
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
      unique: true,
    },
    agentType: {
      type: DataTypes.STRING(32),
      allowNull: false,
      defaultValue: 'openai_compat',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    config: {
      type: DataTypes.JSON,
      allowNull: true,
    },
    apiBase: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    apiKey: {
      type: DataTypes.STRING(512),
      allowNull: true,
    },
    modelId: {
      type: DataTypes.STRING(256),
      allowNull: true,
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
  },
);

export default Agent;
