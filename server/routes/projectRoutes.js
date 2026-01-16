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
import { protect, admin } from '../middleware/authMiddleware.js';
import { projectValidation } from '../middleware/businessValidator.js';

router.route('/').get(protect, getProjects).post(protect, projectValidation, createProject);
router
    .route('/:id')
    .get(protect, getProjectById)
    .put(protect, projectValidation, updateProject)
    .delete(protect, admin, deleteProject);

router.route('/:id/updates').post(protect, addProjectUpdate);

export default router;
