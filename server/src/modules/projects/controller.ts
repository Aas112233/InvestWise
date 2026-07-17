import type { Response, NextFunction } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as projectService from './service.js';

// ---------------------------------------------------------------------------
// GET /api/projects
// ---------------------------------------------------------------------------
export const getProjects = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const result = await projectService.listProjects(req.query as Record<string, string | undefined>);
  res.json(result);
});

// ---------------------------------------------------------------------------
// GET /api/projects/:id
// ---------------------------------------------------------------------------
export const getProjectById = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const id = req.params.id as string;
  const project = await projectService.getProjectById(id);
  res.json({ data: project });
});

// ---------------------------------------------------------------------------
// POST /api/projects
// ---------------------------------------------------------------------------
export const createProject = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const project = await projectService.createProject(req.body, {
    id: req.user!.id,
    name: req.user!.name,
  });
  res.status(201).json({ data: project });
});

// ---------------------------------------------------------------------------
// PUT /api/projects/:id
// ---------------------------------------------------------------------------
export const updateProject = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const id = req.params.id as string;
  const project = await projectService.updateProject(id, req.body, {
    id: req.user!.id,
    name: req.user!.name,
  });
  res.json({ data: project });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id
// ---------------------------------------------------------------------------
export const deleteProject = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const id = req.params.id as string;
  const result = await projectService.deleteProject(id, {
    id: req.user!.id,
    name: req.user!.name,
  });
  res.json({ data: result });
});

// ---------------------------------------------------------------------------
// POST /api/projects/:id/updates
// ---------------------------------------------------------------------------
export const addProjectUpdate = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const id = req.params.id as string;
  const update = await projectService.addProjectUpdate(id, req.body, {
    id: req.user!.id,
    name: req.user!.name,
  });
  res.status(201).json({ data: update });
});

// ---------------------------------------------------------------------------
// PUT /api/projects/:id/updates/:updateId
// ---------------------------------------------------------------------------
export const editProjectUpdate = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const id = req.params.id as string;
  const updateId = req.params.updateId as string;
  const update = await projectService.editProjectUpdate(id, updateId, req.body, {
    id: req.user!.id,
    name: req.user!.name,
  });
  res.json({ data: update });
});

// ---------------------------------------------------------------------------
// DELETE /api/projects/:id/updates/:updateId
// ---------------------------------------------------------------------------
export const deleteProjectUpdate = asyncHandler(async (req, res: Response, _next: NextFunction) => {
  const id = req.params.id as string;
  const updateId = req.params.updateId as string;
  const result = await projectService.deleteProjectUpdate(id, updateId, {
    id: req.user!.id,
    name: req.user!.name,
  });
  res.json({ data: result });
});
