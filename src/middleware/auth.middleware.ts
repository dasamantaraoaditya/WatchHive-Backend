import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, JWTPayload } from '../utils/jwt.util.js';

// Extend Express Request type to include user
declare global {
    // eslint-disable-next-line @typescript-eslint/no-namespace
    namespace Express {
        interface Request {
            user?: JWTPayload;
        }
    }
}

export const authMiddleware = (
    req: Request,
    res: Response,
    next: NextFunction
): void => {
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

        req.user = payload;
        next();
    } catch (error) {
        res.status(401).json({ error: 'Invalid or expired token' });
    }
};

export const optionalAuthMiddleware = (
    req: Request,
    _res: Response,
    next: NextFunction
): void => {
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
            req.user = payload;
        }

        next();
    } catch (error) {
        // If token is invalid, just continue without user
        next();
    }
};
