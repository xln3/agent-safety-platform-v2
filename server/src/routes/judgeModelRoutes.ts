import { Router } from 'express';
import { judgeModelController } from '../controllers/judgeModelController';

const router = Router();

router.get('/', judgeModelController.list);
router.post('/', judgeModelController.create);
router.get('/:id', judgeModelController.getById);
router.put('/:id', judgeModelController.update);
router.delete('/:id', judgeModelController.remove);

export default router;
