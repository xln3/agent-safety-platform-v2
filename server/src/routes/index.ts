import { Router } from 'express';
import agentRoutes from './agentRoutes';
import evalRoutes from './evalRoutes';
import resultRoutes from './resultRoutes';
import reportRoutes from './reportRoutes';
import benchmarkRoutes from './benchmarkRoutes';
import judgeModelRoutes from './judgeModelRoutes';
import internalAgentRunnerRoutes from './internalAgentRunnerRoutes';
import difyProxyRoutes from './difyProxyRoutes';
import v1Routes from './v1Routes';

const router = Router();

router.use('/agents', agentRoutes);
router.use('/eval', evalRoutes);
router.use('/results', resultRoutes);
router.use('/reports', reportRoutes);
router.use('/benchmarks', benchmarkRoutes);
router.use('/judge-models', judgeModelRoutes);
router.use('/internal/agent-runner', internalAgentRunnerRoutes);
router.use('/dify-proxy', difyProxyRoutes);
router.use('/v1', v1Routes);

export default router;
