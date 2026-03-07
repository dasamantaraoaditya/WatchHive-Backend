import { Router } from 'express';
import { body } from 'express-validator';
import { authController } from '../controllers/auth.controller.js';
import { validate } from '../middleware/validation.middleware.js';

const router = Router();

// Validation rules
const registerValidation = [
    body('username')
        .trim()
        .isLength({ min: 3, max: 30 })
        .withMessage('Username must be between 3 and 30 characters')
        .matches(/^[a-zA-Z0-9_]+$/)
        .withMessage('Username can only contain letters, numbers, and underscores'),
    body('email')
        .trim()
        .isEmail()
        .withMessage('Must be a valid email address')
        .normalizeEmail(),
    body('password')
        .isLength({ min: 8 })
        .withMessage('Password must be at least 8 characters long')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
    body('displayName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Display name must be between 1 and 50 characters'),
];

const loginValidation = [
    body('email')
        .trim()
        .isEmail()
        .withMessage('Must be a valid email address')
        .normalizeEmail(),
    body('password')
        .notEmpty()
        .withMessage('Password is required'),
];

const refreshValidation = [
    body('refreshToken')
        .notEmpty()
        .withMessage('Refresh token is required'),
];

// Routes
router.post('/register', registerValidation, validate, authController.register);
router.post('/login', loginValidation, validate, authController.login);
router.post('/google', authController.googleLogin);
router.post('/refresh', refreshValidation, validate, authController.refresh);
router.post('/logout', authController.logout);

export default router;
