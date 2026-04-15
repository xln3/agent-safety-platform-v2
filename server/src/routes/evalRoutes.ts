import { Router } from 'express';
import { evalController } from '../controllers/evalController';

const router = Router();

router.get('/categories', evalController.getCategories);
router.post('/jobs', evalController.createJob);
router.get('/jobs', evalController.listJobs);
router.get('/jobs/:id', evalController.getJob);
router.delete('/jobs/:id', evalController.deleteJob);

export default router;
