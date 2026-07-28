import rateLimit from 'express-rate-limit';

/**
 * General API Rate Limiter
 * Allows 300 requests per 15 minutes window per IP.
 */
export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Too many requests from this IP, please try again after 15 minutes.',
    },
});

/**
 * Authentication Rate Limiter
 * Allows 15 login/register attempts per 15 minutes window per IP.
 */
export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 15,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Too many authentication attempts. Please try again after 15 minutes.',
    },
});

/**
 * Password Reset Rate Limiter
 * Allows 5 password reset requests per 15 minutes window per IP.
 */
export const passwordResetLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Too many password reset requests. Please try again after 15 minutes.',
    },
});
