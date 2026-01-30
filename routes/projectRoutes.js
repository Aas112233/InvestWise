import express from 'express';
const router = express.Router();
import {
    getProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    addProjectUpdate
} from '../controllers/projectController.js';
import { protect, admin, managerOrAdmin } from '../middleware/authMiddleware.js';
import { projectValidation } from '../middleware/businessValidator.js';

router.route('/').get(protect, managerOrAdmin, getProjects).post(protect, admin, projectValidation, createProject);
router
    .route('/:id')
    .get(protect, managerOrAdmin, getProjectById)
    .put(protect, admin, projectValidation, updateProject)
    .delete(protect, admin, deleteProject);

router.route('/:id/updates').post(protect, managerOrAdmin, addProjectUpdate);

export default router;
