import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { googleAuthService } from '../services/google-auth.service.js';

export const authController = {
    async register(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { username, email, password, displayName } = req.body;

            const result = await authService.register({
                username,
                email,
                password,
                displayName,
            });

            res.status(201).json(result);
        } catch (error) {
            next(error);
        }
    },

    async login(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, password } = req.body;

            const result = await authService.login({ email, password });

            res.status(200).json(result);
        } catch (error: any) {
            // Propagate structured error codes for smart frontend handling
            if (error?.code === 'google_only_account') {
                res.status(400).json({
                    error: error.message,
                    code: 'google_only_account',
                    hasGoogleLinked: error.hasGoogleLinked ?? false,
                });
                return;
            }
            next(error);
        }
    },

    async googleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { idToken } = req.body;

            if (!idToken) {
                res.status(400).json({ error: 'Google ID token is required' });
                return;
            }

            const result = await googleAuthService.loginOrRegister(idToken);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { refreshToken } = req.body;

            if (!refreshToken) {
                res.status(400).json({ error: 'Refresh token is required' });
                return;
            }

            const result = await authService.refresh(refreshToken);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async logout(_req: Request, res: Response): Promise<void> {
        // For JWT, logout is handled client-side by removing tokens
        // In future, we could implement token blacklisting with Redis
        res.status(200).json({ message: 'Logged out successfully' });
    },

    async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email } = req.body;

            const result = await authService.forgotPassword(email);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { token, email, newPassword } = req.body;

            const result = await authService.resetPassword(token, email, newPassword);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async setPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = (req as any).user?.userId;

            if (!userId) {
                res.status(401).json({ error: 'Unauthorized' });
                return;
            }

            const { newPassword } = req.body;

            const result = await authService.setPassword(userId, newPassword);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },
};
