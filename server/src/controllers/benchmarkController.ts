import { Request, Response } from 'express';
import { catalogService } from '../services/catalogService';
import { successResponse, errorResponse } from '../utils/response';
import { CATEGORY_BENCHMARK_MAP } from '../constants/evalCategories';
import logger from '../utils/logger';

export const benchmarkController = {
  async listBenchmarks(_req: Request, res: Response): Promise<void> {
    try {
      const benchmarks = catalogService.getAllBenchmarks();
      res.json(successResponse(benchmarks));
    } catch (error: any) {
      logger.error('Failed to list benchmarks:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async getTaskMeta(_req: Request, res: Response): Promise<void> {
    try {
      const meta = catalogService.getTaskMeta();
      res.json(successResponse(meta));
    } catch (error: any) {
      logger.error('Failed to get task meta:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async getBenchmarksByCategory(req: Request, res: Response): Promise<void> {
    try {
      const category = req.params.category as string;

      if (!CATEGORY_BENCHMARK_MAP[category]) {
        res.status(400).json(errorResponse(`Invalid category: ${category}`));
        return;
      }

      const benchmarks = catalogService.getBenchmarksByCategory(category);
      res.json(successResponse(benchmarks));
    } catch (error: any) {
      logger.error('Failed to get benchmarks by category:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default benchmarkController;
