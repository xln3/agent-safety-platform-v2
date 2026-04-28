import { Router } from 'express';
import { v1Controller } from '../controllers/v1Controller';

const router = Router();

router.post('/evaluate', v1Controller.submit);
router.get('/evaluate/:taskId', v1Controller.getStatus);

export default router;
