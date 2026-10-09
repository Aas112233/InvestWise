import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth';
import { generateReportHandler, exportGenericReportHandler } from './controller';

const router = Router();

router.get('/generate/:type', protect, requirePermission('REPORTS', 'READ'), generateReportHandler);
router.post('/export-generic', protect, requirePermission('REPORTS', 'READ'), exportGenericReportHandler);

export { router as reportsRouter };
