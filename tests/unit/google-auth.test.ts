import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { googleAuthService } from '../../src/services/google-auth.service.js';
import { AppError } from '../../src/middleware/error.middleware.js';

describe('Google Auth Service Tests', () => {
    it('rejects empty or whitespace-only idToken with 400 AppError', async () => {
        await expect(googleAuthService.verifyGoogleToken('')).rejects.toThrow(
            expect.objectContaining({ statusCode: 400, message: 'Google ID token is required' })
        );
        await expect(googleAuthService.verifyGoogleToken('   ')).rejects.toThrow(
            expect.objectContaining({ statusCode: 400, message: 'Google ID token is required' })
        );
    });

    it('rejects invalid token with 401 AppError instead of 500 error', async () => {
        try {
            await googleAuthService.verifyGoogleToken('invalid-jwt-token-string');
            fail('Should have thrown an error');
        } catch (err: any) {
            expect(err).toBeInstanceOf(AppError);
            expect(err.statusCode).toBe(401);
            expect(err.message).toMatch(/Failed to verify Google token/i);
        }
    });

    it('AppError has correct statusCode and prototype', () => {
        const error = new AppError('Test unauthorized', 401);
        expect(error).toBeInstanceOf(AppError);
        expect(error).toBeInstanceOf(Error);
        expect(error.statusCode).toBe(401);
        expect(error.isOperational).toBe(true);
    });
});
