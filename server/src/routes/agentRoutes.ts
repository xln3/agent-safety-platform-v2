import { Router } from 'express';
import { agentController } from '../controllers/agentController';

const router = Router();

router.get('/', agentController.list);
router.post('/', agentController.create);
router.get('/:id', agentController.getById);
router.put('/:id', agentController.update);
router.delete('/:id', agentController.remove);

export default router;
