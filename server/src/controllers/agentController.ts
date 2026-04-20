import { Request, Response } from 'express';
import { agentService } from '../services/agentService';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';

const EXCLUDE_SENSITIVE = { exclude: ['apiKey'] as string[] };

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
      const { name, apiBase, apiKey, modelId } = req.body;

      if (!name || !apiBase || !apiKey || !modelId) {
        res.status(400).json(errorResponse('Missing required fields: name, apiBase, apiKey, modelId'));
        return;
      }

      const agent = await agentService.create(req.body);
      res.status(201).json(successResponse(agent, 'Agent created successfully'));
    } catch (error: any) {
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

      const agent = await agentService.update(id, req.body);
      if (!agent) {
        res.status(404).json(errorResponse('Agent not found'));
        return;
      }

      res.json(successResponse(agent, 'Agent updated successfully'));
    } catch (error: any) {
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
