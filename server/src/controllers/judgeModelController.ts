import { Request, Response } from 'express';
import { judgeModelService } from '../services/judgeModelService';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';

const EXCLUDE_SENSITIVE = { exclude: ['apiKey'] as string[] };

function validatePayload(body: any, requireAll: boolean): string | null {
  const { name, apiBase, apiKey, modelId } = body;
  if (requireAll) {
    if (!name || !apiBase || !apiKey || !modelId) {
      return 'Missing required fields: name, apiBase, apiKey, modelId';
    }
  }
  if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
    return 'name must be a non-empty string';
  }
  if (apiBase !== undefined && (typeof apiBase !== 'string' || !apiBase.trim())) {
    return 'apiBase must be a non-empty string';
  }
  if (apiKey !== undefined && (typeof apiKey !== 'string' || !apiKey.trim())) {
    return 'apiKey must be a non-empty string';
  }
  if (modelId !== undefined && (typeof modelId !== 'string' || !modelId.trim())) {
    return 'modelId must be a non-empty string';
  }
  return null;
}

export const judgeModelController = {
  async list(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string, 10) || 10));
      const keyword = (req.query.keyword as string) || undefined;
      const { rows, count } = await judgeModelService.findAll(page, pageSize, keyword, {
        attributes: EXCLUDE_SENSITIVE,
      });
      res.json(paginatedResponse(rows, count, page, pageSize));
    } catch (error: any) {
      logger.error('Failed to list judge models:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async create(req: Request, res: Response): Promise<void> {
    try {
      const validationError = validatePayload(req.body, true);
      if (validationError) {
        res.status(400).json(errorResponse(validationError));
        return;
      }
      const judge = await judgeModelService.create(req.body);
      res.status(201).json(successResponse(judge, 'Judge model created'));
    } catch (error: any) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        res.status(409).json(errorResponse('Judge model name already exists'));
        return;
      }
      logger.error('Failed to create judge model:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async getById(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid judge model ID'));
        return;
      }
      const judge = await judgeModelService.findById(id, { attributes: EXCLUDE_SENSITIVE });
      if (!judge) {
        res.status(404).json(errorResponse('Judge model not found'));
        return;
      }
      res.json(successResponse(judge));
    } catch (error: any) {
      logger.error('Failed to get judge model:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async update(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid judge model ID'));
        return;
      }
      const validationError = validatePayload(req.body, false);
      if (validationError) {
        res.status(400).json(errorResponse(validationError));
        return;
      }
      const judge = await judgeModelService.update(id, req.body);
      if (!judge) {
        res.status(404).json(errorResponse('Judge model not found'));
        return;
      }
      res.json(successResponse(judge, 'Judge model updated'));
    } catch (error: any) {
      if (error.name === 'SequelizeUniqueConstraintError') {
        res.status(409).json(errorResponse('Judge model name already exists'));
        return;
      }
      logger.error('Failed to update judge model:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async remove(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid judge model ID'));
        return;
      }
      const success = await judgeModelService.remove(id);
      if (!success) {
        res.status(404).json(errorResponse('Judge model not found'));
        return;
      }
      res.json(successResponse(null, 'Judge model deleted'));
    } catch (error: any) {
      logger.error('Failed to delete judge model:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default judgeModelController;
