import { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
    statusCode: number;
    isOperational: boolean;
    code?: string;

    constructor(message: string, statusCode: number = 500, code?: string) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;
        this.code = code;

        Object.setPrototypeOf(this, AppError.prototype);
        Error.captureStackTrace(this, this.constructor);
    }
}

export const errorHandler = (
    err: any,
    _req: Request,
    res: Response,
    _next: NextFunction
): void => {
    const statusCode = err?.statusCode || err?.status;
    const isAppError = err instanceof AppError || err?.isOperational === true;

    // Operational client errors (4xx or explicit status)
    if (statusCode && statusCode >= 400 && statusCode < 500) {
        res.status(statusCode).json({
            error: err.message || 'Authentication error',
            ...(err?.code ? { code: err.code } : {}),
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
        });
        return;
    }

    if (isAppError) {
        const code = statusCode || err.statusCode || 500;
        res.status(code).json({
            error: err.message,
            ...(err?.code ? { code: err.code } : {}),
            ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
        });
        return;
    }

    // Unhandled errors
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Our hive is experiencing high traffic. Please try again in a few moments.',
        ...(process.env.NODE_ENV === 'development' && {
            message: err?.message,
            stack: err?.stack,
        }),
    });
};

export const notFoundHandler = (
    _req: Request,
    res: Response,
    _next: NextFunction
): void => {
    res.status(404).json({ error: 'The requested resource is no longer available or could not be found.' });
};
