import { Router } from 'express';
import { benchmarkController } from '../controllers/benchmarkController';

const router = Router();

router.get('/', benchmarkController.listBenchmarks);
router.get('/task-meta', benchmarkController.getTaskMeta);
router.get('/by-category/:category', benchmarkController.getBenchmarksByCategory);

export default router;
