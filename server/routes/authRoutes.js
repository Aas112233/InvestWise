import express from 'express';
const router = express.Router();
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
} from '../controllers/authController.js';
import { protect, admin, managerOrAdmin } from '../middleware/authMiddleware.js';
import { loginValidation, registerValidation } from '../middleware/validator.js';

router.post('/login', loginValidation, authUser);
router.post('/register', registerValidation, registerUser);
router.post('/refresh', refreshToken);
router.post('/logout', protect, logoutUser);
router.post('/logout-all', protect, logoutAllDevices);
router.get('/sessions', protect, getActiveSessions);
router.delete('/sessions/:sessionId', protect, revokeSession);
router.get('/login-history', protect, getLoginHistory);
router.get('/profile', protect, getUserProfile);

// User Management
router.get('/users', protect, managerOrAdmin, getUsers);
router.put('/users/:id', protect, admin, updateUser);
router.delete('/users/:id', protect, admin, deleteUser);
router.put('/users/:id/password', protect, admin, updateUserPassword);
router.put('/profile/password', protect, changeCurrentUserPassword);

export default router;
