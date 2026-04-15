import { Router } from 'express';
import { reportController } from '../controllers/reportController';

const router = Router();

router.post('/', reportController.createReport);
router.get('/', reportController.listReports);
router.get('/:id', reportController.getReport);
router.put('/:id', reportController.updateReport);
router.delete('/:id', reportController.deleteReport);

export default router;
