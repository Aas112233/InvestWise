import type { Request, Response } from 'express';
import { asyncHandler } from '../../shared/asyncHandler.js';
import * as authService from './service.js';
import { ForbiddenError } from '../../shared/errors.js';

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
export const authUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress || '0.0.0.0';
  const userAgent = req.headers['user-agent'] || 'Unknown';
  const location = req.body.location as authService.Location | undefined;

  try {
    const result = await authService.loginUser(email, password, ip, userAgent, location);

    // Frontend stores the entire response as the user object,
    // so spread user fields + tokens at the top level.
    res.status(200).json({
      ...result.user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err: any) {
    console.error('[LOGIN ERROR]', {
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      name: err.name,
      stack: err.stack?.split('\n').slice(0, 4),
    });
    throw err;
  }
});

// ---------------------------------------------------------------------------
// POST /register
// ---------------------------------------------------------------------------
export const registerUser = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw new ForbiddenError();
  }

  const user = await authService.registerUser(req.user, req.body);

  res.status(201).json({
    success: true,
    data: { user },
    message: 'User created successfully',
  });
});

// ---------------------------------------------------------------------------
// GET /profile
// ---------------------------------------------------------------------------
export const getUserProfile = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.getProfile(req.user!.id);

  // Frontend expects user object directly (no wrapper)
  res.status(200).json(user);
});

// ---------------------------------------------------------------------------
// GET /users
// ---------------------------------------------------------------------------
export const getUsers = asyncHandler(async (_req: Request, res: Response) => {
  const users = await authService.getAllUsers();
  res.status(200).json(users);
});

// ---------------------------------------------------------------------------
// PUT /users/:id
// ---------------------------------------------------------------------------
export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const user = await authService.updateUser(req.user!, req.params.id as string, req.body);

  res.status(200).json({
    success: true,
    data: { user },
    message: 'User updated successfully',
  });
});

// ---------------------------------------------------------------------------
// DELETE /users/:id
// ---------------------------------------------------------------------------
export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  await authService.deleteUser(req.user!, req.params.id as string);

  res.status(200).json({
    success: true,
    message: 'User deleted successfully',
  });
});

// ---------------------------------------------------------------------------
// PUT /users/:id/password  (admin reset)
// ---------------------------------------------------------------------------
export const updateUserPassword = asyncHandler(async (req: Request, res: Response) => {
  await authService.updateUserPassword(req.user!, req.params.id as string, req.body.password);

  res.status(200).json({
    success: true,
    message: 'Password updated successfully',
  });
});

// ---------------------------------------------------------------------------
// PUT /profile/password  (self-service)
// ---------------------------------------------------------------------------
export const changeCurrentUserPassword = asyncHandler(async (req: Request, res: Response) => {
  const { currentPassword, newPassword } = req.body;
  await authService.changePassword(req.user!.id, currentPassword, newPassword);

  res.status(200).json({
    success: true,
    message: 'Password changed successfully',
  });
});

// ---------------------------------------------------------------------------
// POST /refresh
// ---------------------------------------------------------------------------
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const { refreshToken: token } = req.body;

  if (!token) {
    res.status(400).json({
      success: false,
      message: 'Refresh token is required',
    });
    return;
  }

  const tokens = await authService.refreshTokens(token);

  res.status(200).json({
    success: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });
});

// ---------------------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------------------
export const logoutUser = asyncHandler(async (req: Request, res: Response) => {
  const refreshToken = req.body.refreshToken as string | undefined;
  const sessionId = req.body.sessionId as string | undefined;

  await authService.logoutUser(req.user!.id, refreshToken, sessionId);

  res.status(200).json({
    success: true,
    message: 'Logged out successfully',
  });
});

// ---------------------------------------------------------------------------
// POST /logout-all
// ---------------------------------------------------------------------------
export const logoutAllDevices = asyncHandler(async (req: Request, res: Response) => {
  await authService.logoutAllDevices(req.user!.id);

  res.status(200).json({
    success: true,
    message: 'Logged out from all devices',
  });
});

// ---------------------------------------------------------------------------
// GET /sessions
// ---------------------------------------------------------------------------
export const getActiveSessions = asyncHandler(async (req: Request, res: Response) => {
  const sessions = await authService.getSessions(req.user!.id);

  res.status(200).json({
    success: true,
    data: { sessions },
  });
});

// ---------------------------------------------------------------------------
// DELETE /sessions/:sessionId
// ---------------------------------------------------------------------------
export const revokeSession = asyncHandler(async (req: Request, res: Response) => {
  await authService.revokeSession(req.user!.id, req.params.sessionId as string);

  res.status(200).json({
    success: true,
    message: 'Session revoked successfully',
  });
});

// ---------------------------------------------------------------------------
// GET /login-history
// ---------------------------------------------------------------------------
export const getLoginHistory = asyncHandler(async (req: Request, res: Response) => {
  const loginHistory = await authService.getLoginHistory(req.user!.id);

  res.status(200).json({
    success: true,
    data: { loginHistory },
  });
});
