import { Router } from 'express';
import { evalController } from '../controllers/evalController';
import { evalItemController } from '../controllers/evalItemController';

const router = Router();

router.get('/categories', evalController.getCategories);
router.post('/jobs', evalController.createJob);
router.get('/jobs', evalController.listJobs);
router.get('/jobs/:id', evalController.getJob);
router.delete('/jobs/:id', evalController.deleteJob);

// Agent eval item endpoints
router.get('/jobs/:id/stream', evalItemController.streamJob);
router.get('/jobs/:id/items', evalItemController.getItems);

export default router;
