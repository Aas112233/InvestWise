import { Router } from 'express';
import { protect, requirePermission } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import {
  createProjectSchema,
  updateProjectSchema,
  projectUpdateSchema,
} from './validation.js';
import * as projectController from './controller.js';

const router = Router();

// All routes require authentication
router.use(protect);

// ----- Project CRUD -----

// GET /api/projects
router.get(
  '/',
  requirePermission('PROJECT_MANAGEMENT', 'READ'),
  projectController.getProjects,
);

// POST /api/projects
router.post(
  '/',
  requirePermission('PROJECT_MANAGEMENT', 'WRITE'),
  validate(createProjectSchema),
  projectController.createProject,
);

// GET /api/projects/:id
router.get(
  '/:id',
  requirePermission('PROJECT_MANAGEMENT', 'READ'),
  projectController.getProjectById,
);

// PUT /api/projects/:id
router.put(
  '/:id',
  requirePermission('PROJECT_MANAGEMENT', 'WRITE'),
  validate(updateProjectSchema),
  projectController.updateProject,
);

// DELETE /api/projects/:id
router.delete(
  '/:id',
  requirePermission('PROJECT_MANAGEMENT', 'WRITE'),
  projectController.deleteProject,
);

// ----- Project Updates -----

// POST /api/projects/:id/updates
router.post(
  '/:id/updates',
  requirePermission('PROJECT_MANAGEMENT', 'WRITE'),
  validate(projectUpdateSchema),
  projectController.addProjectUpdate,
);

// PUT /api/projects/:id/updates/:updateId
router.put(
  '/:id/updates/:updateId',
  requirePermission('PROJECT_MANAGEMENT', 'WRITE'),
  validate(projectUpdateSchema),
  projectController.editProjectUpdate,
);

// DELETE /api/projects/:id/updates/:updateId
router.delete(
  '/:id/updates/:updateId',
  requirePermission('PROJECT_MANAGEMENT', 'WRITE'),
  projectController.deleteProjectUpdate,
);

export default router;
