import { Router } from 'express';
import { v1Controller } from '../controllers/v1Controller';

const router = Router();

router.post('/evaluate', v1Controller.submit);
// More-specific suffixed routes MUST come before `/evaluate/:taskId` —
// Express matches in declaration order, and a bare `:taskId` would otherwise
// swallow `samples` / `stream` as taskId values.
router.get('/evaluate/:jobId/samples', v1Controller.getJobSamples);
router.get('/evaluate/:taskId/stream', v1Controller.getStream);
router.get('/evaluate/:taskId', v1Controller.getStatus);

export default router;
