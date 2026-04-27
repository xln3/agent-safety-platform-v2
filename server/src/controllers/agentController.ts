import { Request, Response } from 'express';
import { agentService } from '../services/agentService';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';
import type { AgentType } from '../models/Agent';

const EXCLUDE_SENSITIVE = { exclude: ['apiKey'] as string[] };

const VALID_AGENT_TYPES: ReadonlySet<AgentType> = new Set([
  'openai_compat',
  'dify_chat',
  'dify_workflow',
  'cli',
]);

/**
 * Validate the `config` payload for an agent based on its type.
 * Returns an error message string, or null if the config is valid.
 */
function validateConfig(agentType: AgentType, config: any): string | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return 'config must be an object';
  }

  const requireString = (key: string): string | null => {
    const v = config[key];
    if (typeof v !== 'string' || !v.trim()) return `config.${key} is required`;
    return null;
  };

  switch (agentType) {
    case 'openai_compat': {
      return (
        requireString('apiBase') ||
        requireString('apiKey') ||
        requireString('modelId')
      );
    }
    case 'dify_chat': {
      return requireString('apiBase') || requireString('apiKey');
    }
    case 'dify_workflow': {
      const baseErr = requireString('apiBase') || requireString('apiKey');
      if (baseErr) return baseErr;
      const mapping = config.inputVariableMapping;
      if (
        !mapping ||
        typeof mapping !== 'object' ||
        Array.isArray(mapping) ||
        Object.keys(mapping).length === 0
      ) {
        return 'config.inputVariableMapping must be a non-empty object (Dify variable name → eval-state field path)';
      }
      for (const [k, v] of Object.entries(mapping)) {
        if (typeof v !== 'string' || !v.trim()) {
          return `config.inputVariableMapping["${k}"] must be a non-empty string`;
        }
      }
      return null;
    }
    case 'cli': {
      const cmdErr = requireString('commandTemplate');
      if (cmdErr) return cmdErr;
      if (config.inputMode !== 'placeholder' && config.inputMode !== 'stdin') {
        return 'config.inputMode must be "placeholder" or "stdin"';
      }
      if (
        config.inputMode === 'placeholder' &&
        !String(config.commandTemplate).includes('{INPUT}')
      ) {
        return 'config.commandTemplate must contain {INPUT} when inputMode=placeholder';
      }
      if (config.timeoutSec !== undefined) {
        const t = Number(config.timeoutSec);
        if (!Number.isFinite(t) || t <= 0 || t > 3600) {
          return 'config.timeoutSec must be a positive number ≤ 3600';
        }
      }
      return null;
    }
  }
}

/** Mirror config fields into legacy columns so evalRunner keeps working pre-PR-5. */
function mirrorLegacyFields(agentType: AgentType, config: any): Record<string, unknown> {
  const out: Record<string, unknown> = {
    apiBase: null,
    apiKey: null,
    modelId: null,
    systemPrompt: null,
  };
  if (!config) return out;
  if (agentType === 'openai_compat') {
    out.apiBase = config.apiBase ?? null;
    out.apiKey = config.apiKey ?? null;
    out.modelId = config.modelId ?? null;
    out.systemPrompt = config.systemPrompt ?? null;
  } else if (agentType === 'dify_chat') {
    out.apiBase = config.apiBase ?? null;
    out.apiKey = config.apiKey ?? null;
    out.systemPrompt = config.systemPrompt ?? null;
  } else if (agentType === 'dify_workflow') {
    out.apiBase = config.apiBase ?? null;
    out.apiKey = config.apiKey ?? null;
  }
  return out;
}

export const agentController = {
  async list(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string, 10) || 10));
      const keyword = (req.query.keyword as string) || undefined;

      const { rows, count } = await agentService.findAll(page, pageSize, keyword, {
        attributes: EXCLUDE_SENSITIVE,
      });
      res.json(paginatedResponse(rows, count, page, pageSize));
    } catch (error: any) {
      logger.error('Failed to list agents:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async create(req: Request, res: Response): Promise<void> {
    try {
      const { name, description, agentType, config } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json(errorResponse('Missing required field: name'));
        return;
      }
      if (!VALID_AGENT_TYPES.has(agentType)) {
        res.status(400).json(errorResponse(
          `agentType must be one of: ${Array.from(VALID_AGENT_TYPES).join(', ')}`,
        ));
        return;
      }

      const configError = validateConfig(agentType, config);
      if (configError) {
        res.status(400).json(errorResponse(configError));
        return;
      }

      const legacy = mirrorLegacyFields(agentType, config);
      const payload = {
        name,
        description: description ?? null,
        agentType,
        config,
        ...legacy,
      };

      const agent = await agentService.create(payload as any);
      res.status(201).json(successResponse(agent, 'Agent created successfully'));
    } catch (error: any) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        res.status(409).json(errorResponse('Agent name already exists'));
        return;
      }
      logger.error('Failed to create agent:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid agent ID'));
        return;
      }

      const agent = await agentService.findById(id, {
        attributes: EXCLUDE_SENSITIVE,
      });
      if (!agent) {
        res.status(404).json(errorResponse('Agent not found'));
        return;
      }

      res.json(successResponse(agent));
    } catch (error: any) {
      logger.error('Failed to get agent:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async update(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid agent ID'));
        return;
      }

      const { name, description, agentType, config } = req.body;
      const update: Record<string, unknown> = {};

      if (name !== undefined) update.name = name;
      if (description !== undefined) update.description = description;

      if (agentType !== undefined) {
        if (!VALID_AGENT_TYPES.has(agentType)) {
          res.status(400).json(errorResponse(
            `agentType must be one of: ${Array.from(VALID_AGENT_TYPES).join(', ')}`,
          ));
          return;
        }
        update.agentType = agentType;
      }

      if (config !== undefined) {
        const effectiveType = (update.agentType ?? null) as AgentType | null;
        // If type wasn't sent, fetch current to validate config against it
        let typeForValidation: AgentType;
        if (effectiveType) {
          typeForValidation = effectiveType;
        } else {
          const existing = await agentService.findById(id);
          if (!existing) {
            res.status(404).json(errorResponse('Agent not found'));
            return;
          }
          typeForValidation = existing.agentType as AgentType;
        }

        const configError = validateConfig(typeForValidation, config);
        if (configError) {
          res.status(400).json(errorResponse(configError));
          return;
        }
        update.config = config;
        Object.assign(update, mirrorLegacyFields(typeForValidation, config));
      }

      const agent = await agentService.update(id, update);
      if (!agent) {
        res.status(404).json(errorResponse('Agent not found'));
        return;
      }

      res.json(successResponse(agent, 'Agent updated successfully'));
    } catch (error: any) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        res.status(409).json(errorResponse('Agent name already exists'));
        return;
      }
      logger.error('Failed to update agent:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async remove(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid agent ID'));
        return;
      }

      const success = await agentService.remove(id);
      if (!success) {
        res.status(404).json(errorResponse('Agent not found'));
        return;
      }

      res.json(successResponse(null, 'Agent deleted successfully'));
    } catch (error: any) {
      logger.error('Failed to delete agent:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default agentController;
