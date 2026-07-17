import { Router } from 'express';
import { protect, admin, managerOrAdmin } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { authLimiter } from '../../middleware/rate-limiter.js';
import {
  loginSchema,
  registerSchema,
  updateUserSchema,
  changePasswordSchema,
  adminPasswordResetSchema,
} from './validation.js';
import {
  authUser,
  registerUser,
  getUserProfile,
  getUsers,
  updateUser,
  deleteUser,
  updateUserPassword,
  changeCurrentUserPassword,
  refreshToken,
  logoutUser,
  logoutAllDevices,
  getActiveSessions,
  revokeSession,
  getLoginHistory,
} from './controller.js';

const router = Router();

// Public
router.post('/login', authLimiter, validate(loginSchema), authUser);
router.post('/refresh', refreshToken);

// Authenticated — self-service
router.post('/logout', protect, logoutUser);
router.post('/logout-all', protect, logoutAllDevices);
router.get('/sessions', protect, getActiveSessions);
router.delete('/sessions/:sessionId', protect, revokeSession);
router.get('/login-history', protect, getLoginHistory);
router.get('/profile', protect, getUserProfile);
router.put('/profile/password', protect, validate(changePasswordSchema), changeCurrentUserPassword);

// Admin or Manager
router.get('/users', protect, managerOrAdmin, getUsers);

// Admin only
router.post('/register', protect, admin, validate(registerSchema), registerUser);
router.put('/users/:id', protect, admin, validate(updateUserSchema), updateUser);
router.delete('/users/:id', protect, admin, deleteUser);
router.put('/users/:id/password', protect, admin, validate(adminPasswordResetSchema), updateUserPassword);

export default router;
