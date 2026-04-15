import { Router } from 'express';
import agentRoutes from './agentRoutes';
import evalRoutes from './evalRoutes';
import resultRoutes from './resultRoutes';
import reportRoutes from './reportRoutes';
import benchmarkRoutes from './benchmarkRoutes';

const router = Router();

router.use('/agents', agentRoutes);
router.use('/eval', evalRoutes);
router.use('/results', resultRoutes);
router.use('/reports', reportRoutes);
router.use('/benchmarks', benchmarkRoutes);

export default router;
