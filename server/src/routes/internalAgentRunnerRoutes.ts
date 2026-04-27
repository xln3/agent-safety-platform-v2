import { Router } from 'express';
import { internalAgentRunnerController } from '../controllers/internalAgentRunnerController';

const router = Router();

router.post('/invoke', internalAgentRunnerController.invoke);

export default router;
