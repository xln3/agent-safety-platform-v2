import { Router } from 'express';
import { getDifyParametersHandler } from '../controllers/difyProxyController';

const router = Router();

router.post('/parameters', getDifyParametersHandler);

export default router;
