import express from 'express';
const router = express.Router();
import {
    getProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    addProjectUpdate,
    editProjectUpdate,
    deleteProjectUpdate
} from '../controllers/projectController.js';
import { protect, requirePermission } from '../middleware/authMiddleware.js';
import { projectValidation } from '../middleware/businessValidator.js';

// Allow READ access to view projects, WRITE to create/modify
router.route('/').get(protect, requirePermission('PROJECT_MANAGEMENT', 'READ'), getProjects).post(protect, requirePermission('PROJECT_MANAGEMENT', 'WRITE'), projectValidation, createProject);
router
    .route('/:id')
    .get(protect, requirePermission('PROJECT_MANAGEMENT', 'READ'), getProjectById)
    .put(protect, requirePermission('PROJECT_MANAGEMENT', 'WRITE'), projectValidation, updateProject)
    .delete(protect, requirePermission('PROJECT_MANAGEMENT', 'WRITE'), deleteProject);

// Project updates - WRITE access required
router.route('/:id/updates').post(protect, requirePermission('PROJECT_MANAGEMENT', 'WRITE'), addProjectUpdate);
router.route('/:id/updates/:updateId')
    .put(protect, requirePermission('PROJECT_MANAGEMENT', 'WRITE'), editProjectUpdate)
    .delete(protect, requirePermission('PROJECT_MANAGEMENT', 'WRITE'), deleteProjectUpdate);

export default router;
