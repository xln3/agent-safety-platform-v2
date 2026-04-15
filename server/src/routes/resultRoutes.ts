import { Router } from 'express';
import { resultController } from '../controllers/resultController';

const router = Router();

router.get('/by-job/:jobId', resultController.getJobResults);
router.get('/by-job/:jobId/tasks/:taskId/samples', resultController.getTaskSamples);

export default router;
