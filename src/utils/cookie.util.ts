import { Response } from 'express';
import { config } from '../config.js';

export const setAuthCookies = (res: Response, accessToken: string, refreshToken: string): void => {
    const isProduction = config.nodeEnv === 'production';
    const isCrossDomainProd = isProduction && Boolean(config.cors.origin?.includes('watchershive.com'));
    const sameSite = isCrossDomainProd ? 'none' : 'lax';
    const secure = isProduction;

    res.cookie('jwt_access', accessToken, {
        httpOnly: true,
        secure,
        sameSite,
        maxAge: 60 * 60 * 1000, // 1 hour
        path: '/',
    });

    res.cookie('jwt_refresh', refreshToken, {
        httpOnly: true,
        secure,
        sameSite,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        path: '/',
    });
};

export const clearAuthCookies = (res: Response): void => {
    const isProduction = config.nodeEnv === 'production';
    const isCrossDomainProd = isProduction && Boolean(config.cors.origin?.includes('watchershive.com'));
    const sameSite = isCrossDomainProd ? 'none' : 'lax';
    const secure = isProduction;

    res.clearCookie('jwt_access', { httpOnly: true, secure, sameSite, path: '/' });
    res.clearCookie('jwt_refresh', { httpOnly: true, secure, sameSite, path: '/' });
};
