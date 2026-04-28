import { Router } from 'express';
import { evalController } from '../controllers/evalController';
import { evalStreamHandler, listJobItemsHandler, getJobItemHandler } from '../controllers/evalStreamController';

const router = Router();

router.get('/categories', evalController.getCategories);
router.post('/jobs', evalController.createJob);
router.get('/jobs', evalController.listJobs);
router.get('/jobs/:id', evalController.getJob);
router.delete('/jobs/:id', evalController.deleteJob);
router.get('/jobs/:id/stream', evalStreamHandler);
router.get('/jobs/:id/items', listJobItemsHandler);
router.get('/jobs/:id/items/:itemId', getJobItemHandler);

export default router;
