import { Request, Response } from 'express';
import { reportService } from '../services/reportService';
import { successResponse, errorResponse, paginatedResponse } from '../utils/response';
import logger from '../utils/logger';

export const reportController = {
  async createReport(req: Request, res: Response): Promise<void> {
    try {
      const { agentId, jobId, title } = req.body;

      // Auto-generate report from job when jobId is provided without title
      if (jobId && !title) {
        const report = await reportService.generateReport(jobId);
        res.json(successResponse(report, 'Report generated successfully'));
        return;
      }

      if (!agentId || !title) {
        res.status(400).json(errorResponse('Missing required fields: agentId, title'));
        return;
      }

      const report = await reportService.createReport(agentId, jobId || null, title);
      res.status(201).json(successResponse(report, 'Report created successfully'));
    } catch (error: any) {
      logger.error('Failed to create report:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async listReports(req: Request, res: Response): Promise<void> {
    try {
      const agentId = req.query.agentId ? parseInt(req.query.agentId as string, 10) : undefined;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const pageSize = Math.max(1, Math.min(100, parseInt(req.query.pageSize as string, 10) || 10));

      const { rows, count } = await reportService.listReports(agentId, page, pageSize);
      res.json(paginatedResponse(rows, count, page, pageSize));
    } catch (error: any) {
      logger.error('Failed to list reports:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async getReport(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid report ID'));
        return;
      }

      const report = await reportService.getReport(id);
      if (!report) {
        res.status(404).json(errorResponse('Report not found'));
        return;
      }

      res.json(successResponse(report));
    } catch (error: any) {
      logger.error('Failed to get report:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async updateReport(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid report ID'));
        return;
      }

      const report = await reportService.updateReport(id, req.body);
      if (!report) {
        res.status(404).json(errorResponse('Report not found'));
        return;
      }

      res.json(successResponse(report, 'Report updated successfully'));
    } catch (error: any) {
      logger.error('Failed to update report:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

  async deleteReport(req: Request, res: Response): Promise<void> {
    try {
      const id = parseInt(req.params.id as string, 10);
      if (isNaN(id)) {
        res.status(400).json(errorResponse('Invalid report ID'));
        return;
      }

      const success = await reportService.deleteReport(id);
      if (!success) {
        res.status(404).json(errorResponse('Report not found'));
        return;
      }

      res.json(successResponse(null, 'Report deleted successfully'));
    } catch (error: any) {
      logger.error('Failed to delete report:', error.message);
      res.status(500).json(errorResponse(error.message));
    }
  },

};

export default reportController;
