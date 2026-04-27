import { Router } from 'express';
import agentRoutes from './agentRoutes';
import evalRoutes from './evalRoutes';
import resultRoutes from './resultRoutes';
import reportRoutes from './reportRoutes';
import benchmarkRoutes from './benchmarkRoutes';
import judgeModelRoutes from './judgeModelRoutes';
import internalAgentRunnerRoutes from './internalAgentRunnerRoutes';

const router = Router();

router.use('/agents', agentRoutes);
router.use('/eval', evalRoutes);
router.use('/results', resultRoutes);
router.use('/reports', reportRoutes);
router.use('/benchmarks', benchmarkRoutes);
router.use('/judge-models', judgeModelRoutes);
router.use('/internal/agent-runner', internalAgentRunnerRoutes);

export default router;
