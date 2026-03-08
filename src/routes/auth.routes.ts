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

/**
 * @openapi
 * tags:
 *   name: Authentication
 *   description: User registration and login management
 */

// Routes
/**
 * @openapi
 * /api/v1/auth/register:
 *   post:
 *     tags: [Authentication]
 *     summary: Register a new user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - email
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *               displayName:
 *                 type: string
 *     responses:
 *       201:
 *         description: User registered successfully
 *       400:
 *         description: Validation error
 */
router.post('/register', registerValidation, validate, authController.register);

/**
 * @openapi
 * /api/v1/auth/login:
 *   post:
 *     tags: [Authentication]
 *     summary: Login a user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *     responses:
 *       200:
 *         description: Login successful
 *       401:
 *         description: Unauthorized
 */
router.post('/login', loginValidation, validate, authController.login);

/**
 * @openapi
 * /api/v1/auth/google:
 *   post:
 *     tags: [Authentication]
 *     summary: Login with Google OAuth
 *     responses:
 *       200:
 *         description: Google login successful
 */
router.post('/google', authController.googleLogin);

/**
 * @openapi
 * /api/v1/auth/refresh:
 *   post:
 *     tags: [Authentication]
 *     summary: Refresh access token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Token refreshed successfuly
 */
router.post('/refresh', refreshValidation, validate, authController.refresh);

/**
 * @openapi
 * /api/v1/auth/logout:
 *   post:
 *     tags: [Authentication]
 *     summary: Logout a user
 *     responses:
 *       200:
 *         description: Logout successful
 */
router.post('/logout', authController.logout);

export default router;
