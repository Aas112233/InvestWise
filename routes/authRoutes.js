import express from 'express';
const router = express.Router();
import { authUser, registerUser, getUserProfile } from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';
import { loginValidation, registerValidation } from '../middleware/validator.js';

router.post('/login', loginValidation, authUser);
router.post('/register', registerValidation, registerUser);
router.get('/profile', protect, getUserProfile);

export default router;
