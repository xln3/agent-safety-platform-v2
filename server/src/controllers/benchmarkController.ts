import { Request, Response } from 'express';
import { catalogService } from '../services/catalogService';
import * as datasetService from '../services/datasetService';
import { successResponse, errorResponse } from '../utils/response';
import { CATEGORY_BENCHMARK_MAP } from '../constants/evalCategories';
import logger from '../utils/logger';

// Reverse lookup: benchmark name -> category key
const benchmarkToCategoryMap: Record<string, string> = {};
for (const [cat, names] of Object.entries(CATEGORY_BENCHMARK_MAP)) {
  for (const name of names) {
    benchmarkToCategoryMap[name] = cat;
  }
}

export const benchmarkController = {
  async listBenchmarks(_req: Request, res: Response): Promise<void> {
    try {
      const benchmarks = catalogService.getAllBenchmarks().map((b) => ({
        ...b,
        category: benchmarkToCategoryMap[b.name] ?? 'other',
      }));
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

  async getDatasetStatus(_req: Request, res: Response): Promise<void> {
    try {
      const statuses = datasetService.checkAllDatasetStatus();
      res.json(successResponse(statuses));
    } catch (error: any) {
      logger.error('Failed to get dataset status:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async prepareDatasets(req: Request, res: Response): Promise<void> {
    try {
      const { benchmark } = req.body || {};

      if (benchmark) {
        await datasetService.prepareBenchmarkDataset(benchmark);
        res.json(successResponse({ benchmark, status: 'prepared' }));
      } else {
        const result = await datasetService.prepareAllDatasets();
        res.json(successResponse(result));
      }
    } catch (error: any) {
      logger.error('Failed to prepare datasets:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },
};

export default benchmarkController;
