import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as meetingService from './service.js';

export const createMeetingHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await meetingService.createMeeting(req.body, req.user!.id, req.user!.name);
  res.status(201).json({ success: true, ...result });
});

export const listMeetingsHandler = asyncHandler(async (req: Request, res: Response) => {
  const query = req.query as Record<string, string | undefined>;
  const result = await meetingService.listMeetings(query);
  res.json(result);
});

export const getMeetingByIdHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await meetingService.getMeetingById(req.params.id as string);
  res.json(result);
});

export const updateMeetingHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await meetingService.updateMeeting(
    req.params.id as string,
    req.body,
    req.user!.id,
    req.user!.name,
  );
  res.json({ success: true, ...result });
});

export const startMeetingHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await meetingService.startMeeting(
    req.params.id as string,
    req.user!.id,
    req.user!.name,
  );
  res.json({ success: true, message: 'Meeting started', ...result });
});

export const recordAttendanceHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await meetingService.recordAttendance(
    req.params.id as string,
    req.body.records,
    req.user!.id,
    req.user!.name,
  );
  res.json({ success: true, ...result });
});

export const completeMeetingHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await meetingService.completeMeeting(
    req.params.id as string,
    req.user!.id,
    req.user!.name,
    req.body.notes,
  );
  res.json({ success: true, message: 'Meeting completed and attendance finalized', ...result });
});

export const deleteMeetingHandler = asyncHandler(async (req: Request, res: Response) => {
  const result = await meetingService.deleteMeeting(
    req.params.id as string,
    req.user!.id,
    req.user!.name,
  );
  res.json(result);
});
