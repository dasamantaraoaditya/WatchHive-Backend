import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '../utils/jwt.util.js';
import { getActiveTokenVersion } from '../services/auth.service.js';

// Extend Express Request type to include user
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: JWTPayload;
        }
    }
}

export const authMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        let token: string | undefined;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7); // Remove 'Bearer ' prefix
        } else if (req.cookies && (req.cookies.jwt_access || req.cookies.accessToken)) {
            token = req.cookies.jwt_access || req.cookies.accessToken;
        }

        if (!token) {
            res.status(401).json({ error: 'No token provided' });
            return;
        }

        const payload = verifyAccessToken(token);

        // Mandatory Email Verification Enforcement
        if (payload.isEmailVerified === false) {
            res.status(403).json({
                error: 'Please verify your email address to access this service.',
                code: 'email_verification_required',
            });
            return;
        }

        // Global Session Revocation Enforcement
        if (payload.tokenVersion !== undefined) {
            const activeVersion = await getActiveTokenVersion(payload.userId);
            if (activeVersion !== null && activeVersion !== payload.tokenVersion) {
                res.status(401).json({
                    error: 'Session has been revoked. Please sign in again.',
                    code: 'session_revoked',
                });
                return;
            }
        }

        req.user = payload;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};

export const optionalAuthMiddleware = async (
    req: Request,
    _res: Response,
    next: NextFunction
): Promise<void> => {
    try {
        const authHeader = req.headers.authorization;
        let token: string | undefined;

        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && (req.cookies.jwt_access || req.cookies.accessToken)) {
            token = req.cookies.jwt_access || req.cookies.accessToken;
        }

        if (token) {
            const payload = verifyAccessToken(token);
            if (payload.tokenVersion !== undefined) {
                const activeVersion = await getActiveTokenVersion(payload.userId);
                if (activeVersion !== null && activeVersion !== payload.tokenVersion) {
                    // Token version revoked; continue without user
                    next();
                    return;
                }
            }
            req.user = payload;
        }

        next();
    } catch (error) {
        // If token is invalid, just continue without user
        next();
    }
};
