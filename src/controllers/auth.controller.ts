import { Request, Response, NextFunction } from 'express';
import { authService } from '../services/auth.service.js';
import { googleAuthService } from '../services/google-auth.service.js';
import { appleAuthService } from '../services/apple-auth.service.js';
import { verifyRefreshToken } from '../utils/jwt.util.js';
import { setAuthCookies, clearAuthCookies } from '../utils/cookie.util.js';

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

            // Registration requires email verification before issuing active sessions
            res.status(201).json(result);
        } catch (error: any) {
            if (error?.code === 'email_already_registered') {
                res.status(409).json({
                    error: error.message,
                    code: 'email_already_registered',
                });
                return;
            }
            next(error);
        }
    },

    async login(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, password } = req.body;

            const result = await authService.login({ email, password });

            // Set HttpOnly / SameSite cookies for web clients
            setAuthCookies(res, result.accessToken, result.refreshToken);

            res.status(200).json(result);
        } catch (error: any) {
            // Propagate structured error codes for smart frontend handling
            if (error?.code === 'email_not_verified') {
                res.status(403).json({
                    error: error.message,
                    code: 'email_not_verified',
                    email: error.email,
                });
                return;
            }
            if (error?.code === 'google_only_account') {
                res.status(400).json({
                    error: error.message,
                    code: 'google_only_account',
                    hasGoogleLinked: error.hasGoogleLinked ?? false,
                });
                return;
            }
            if (error?.code === 'account_locked') {
                res.status(423).json({
                    error: error.message,
                    code: 'account_locked',
                    lockoutUntil: error.lockoutUntil,
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

            // Set HttpOnly / SameSite cookies for web clients
            setAuthCookies(res, result.accessToken, result.refreshToken);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async appleLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { identityToken, userIdentifier, email, givenName, familyName } = req.body;

            if (!identityToken) {
                res.status(400).json({ error: 'Apple identityToken is required' });
                return;
            }

            const result = await appleAuthService.loginOrRegister({
                identityToken,
                userIdentifier,
                email,
                givenName,
                familyName,
            });

            // Set HttpOnly / SameSite cookies for web clients
            setAuthCookies(res, result.accessToken, result.refreshToken);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            // Support both body payload and HttpOnly cookie
            const refreshToken = req.body?.refreshToken || req.cookies?.jwt_refresh;

            if (!refreshToken) {
                res.status(400).json({ error: 'Refresh token is required' });
                return;
            }

            const result = await authService.refresh(refreshToken);

            // Update HttpOnly cookies
            setAuthCookies(res, result.accessToken, result.refreshToken);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async logout(req: Request, res: Response): Promise<void> {
        try {
            // Always clear HttpOnly cookies on logout
            clearAuthCookies(res);

            const refreshToken = req.body?.refreshToken || req.cookies?.jwt_refresh;
            if (refreshToken) {
                try {
                    const payload = verifyRefreshToken(refreshToken);
                    if (payload.userId) {
                        await authService.revokeSessions(payload.userId);
                    }
                } catch {
                    // Safe to ignore token verification errors on logout
                }
            }
        } catch {
            // Never block successful client logout
        }
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

    async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const token = (req.body?.token || req.query?.token) as string;
            const email = (req.body?.email || req.query?.email) as string;

            if (!token || !email) {
                res.status(400).json({ error: 'Token and email are required for verification' });
                return;
            }

            const result = await authService.verifyEmail(token, email);

            // Set HttpOnly / SameSite cookies upon email verification
            if (result.accessToken && result.refreshToken) {
                setAuthCookies(res, result.accessToken, result.refreshToken);
            }

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async resendVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email } = req.body;

            if (!email) {
                res.status(400).json({ error: 'Email is required' });
                return;
            }

            const result = await authService.resendVerification(email);

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async requestEmailOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email } = req.body;
            if (!email) {
                res.status(400).json({ error: 'Email is required' });
                return;
            }
            const result = await authService.requestEmailOtp(email);
            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },

    async verifyEmailOtp(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email, code } = req.body;
            if (!email || !code) {
                res.status(400).json({ error: 'Email and 6-digit code are required' });
                return;
            }
            const result = await authService.verifyEmailOtp(email, code);

            // Set HttpOnly / SameSite cookies for web clients
            if (result.accessToken && result.refreshToken) {
                setAuthCookies(res, result.accessToken, result.refreshToken);
            }

            res.status(200).json(result);
        } catch (error) {
            next(error);
        }
    },
};
