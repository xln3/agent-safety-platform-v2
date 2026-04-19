import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const evalPocRoot = process.env.EVAL_POC_ROOT || path.resolve(__dirname, '../../eval-engine');

interface Config {
  db: {
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
  };
  server: {
    port: number;
  };
  nodeEnv: string;
  llm: {
    apiBaseUrl: string;
    apiKey: string;
    judgeModel: string;
  };
  corsOrigins: string;
  evalPocRoot: string;
  resultsDir: string;
}

export const config: Config = {
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    name: process.env.DB_NAME || 'agent_safety_platform',
  },
  server: {
    port: parseInt(process.env.SERVER_PORT || '3000', 10),
  },
  nodeEnv: process.env.NODE_ENV || 'development',
  llm: {
    apiBaseUrl: process.env.LLM_API_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY || '',
    judgeModel: process.env.LLM_JUDGE_MODEL || 'gpt-4o-mini',
  },
  corsOrigins: process.env.CORS_ORIGINS || 'http://localhost:5173',
  evalPocRoot,
  resultsDir: process.env.RESULTS_DIR || path.join(evalPocRoot, 'results'),
};

export default config;
