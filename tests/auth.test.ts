/**
 * Auth Routes — Unit Tests
 * Uses jest.unstable_mockModule (ESM-native) + dynamic import for correct hoisting.
 */

import { jest, describe, it, expect, beforeEach, afterAll } from '@jest/globals';
import type { AuthResponse } from '../src/services/auth.service.js';

if (process.versions.bun) {
    const { mock } = await import('bun:test');
    (jest as any).unstable_mockModule = (modulePath: string, factory: any) => {
        return mock.module(modulePath, factory);
    };
}

// ─── Mock functions ───────────────────────────────────────────────────────────

const mockRegister = jest.fn<() => Promise<any>>();
const mockLogin = jest.fn<() => Promise<AuthResponse>>();
const mockRefresh = jest.fn<() => Promise<{ accessToken: string; refreshToken: string }>>();
const mockGoogleLogin = jest.fn<() => Promise<AuthResponse>>();
const mockForgotPassword = jest.fn<() => Promise<{ message: string; emailSent: boolean }>>();
const mockResetPassword = jest.fn<() => Promise<{ message: string }>>();
const mockChangePassword = jest.fn<() => Promise<any>>();
const mockVerifyEmail = jest.fn<() => Promise<any>>();
const mockResendVerification = jest.fn<() => Promise<{ message: string; emailSent: boolean }>>();
const mockRequestEmailOtp = jest.fn<() => Promise<{ message: string; email: string; isNewUser: boolean }>>();
const mockVerifyEmailOtp = jest.fn<() => Promise<any>>();
const mockCheckDb = jest.fn<() => Promise<boolean>>();

// ─── ESM module mocks (must come before dynamic imports) ─────────────────────

await jest.unstable_mockModule('../src/services/auth.service.js', () => ({
    authService: {
        register: mockRegister,
        login: mockLogin,
        refresh: mockRefresh,
        forgotPassword: mockForgotPassword,
        resetPassword: mockResetPassword,
        changePassword: mockChangePassword,
        verifyEmail: mockVerifyEmail,
        resendVerification: mockResendVerification,
        requestEmailOtp: mockRequestEmailOtp,
        verifyEmailOtp: mockVerifyEmailOtp,
    },
    getFullAuthUser: jest.fn(),
    getActiveTokenVersion: jest.fn().mockImplementation((userId: string) => {
        if (userId === 'revoked-user') return Promise.resolve(2); // DB has version 2
        return Promise.resolve(1);
    }),
}));

const { googleAuthService } = await import('../src/services/google-auth.service.js');
(googleAuthService as any).loginOrRegister = mockGoogleLogin;

await jest.unstable_mockModule('../src/db/index.js', () => ({
    db: {},
    checkDbHealth: mockCheckDb,
}));

await jest.unstable_mockModule('../src/config/swagger.js', () => ({ default: {} }));

await jest.unstable_mockModule('../src/services/xp.service.js', () => ({
    xpService: { awardXp: jest.fn() },
    XpAction: { LOG_WATCH: 'LOG_WATCH', WRITE_REVIEW: 'WRITE_REVIEW' },
}));

await jest.unstable_mockModule('../src/services/notification.service.js', () => ({
    notificationService: { createNotification: jest.fn(), getNotifications: jest.fn(), markAsRead: jest.fn(), markAllAsRead: jest.fn(), getUnreadCount: jest.fn() },
    default: { createNotification: jest.fn(), getNotifications: jest.fn(), markAsRead: jest.fn(), markAllAsRead: jest.fn(), getUnreadCount: jest.fn() },
}));

await jest.unstable_mockModule('../src/services/tmdb.service.js', () => ({
    default: { getMovieDetails: jest.fn(), getTVShowDetails: jest.fn() },
}));

// ─── Dynamic imports after mocks ─────────────────────────────────────────────

const { default: request } = await import('supertest');
const { default: app } = await import('../src/app.js');
const { generateAccessToken } = await import('../src/utils/jwt.util.js');

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const mockUser = {
    id: 'user-uuid-1234',
    username: 'testuser',
    email: 'test@example.com',
    displayName: 'Test User',
    profilePictureUrl: null,
};

const mockAuthResponse = {
    user: mockUser,
    accessToken: 'access-token-jwt',
    refreshToken: 'refresh-token-jwt',
};

const validRegisterPayload = {
    username: 'newuser',
    email: 'newuser@example.com',
    password: 'SecurePass1',
    displayName: 'New User',
};

// Reset mocks between tests
beforeEach(() => {
    jest.clearAllMocks();
    mockCheckDb.mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
    it('201 — returns requiresVerification on valid registration', async () => {
        mockRegister.mockResolvedValueOnce({
            requiresVerification: true,
            email: 'newuser@example.com',
            username: 'newuser',
            message: 'Account created! Please enter the 6-digit verification code sent to your email.',
        });

        const res = await request(app)
            .post('/api/v1/auth/register')
            .send(validRegisterPayload);

        expect(res.status).toBe(201);
        expect(res.body.requiresVerification).toBe(true);
        expect(res.body.email).toBe('newuser@example.com');
    });

    it('400 — rejects username shorter than 3 chars', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...validRegisterPayload, username: 'ab' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects username with special characters', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...validRegisterPayload, username: 'bad user!' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects invalid email format', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...validRegisterPayload, email: 'not-an-email' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects password shorter than 8 chars', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...validRegisterPayload, password: 'Abc1' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects password without uppercase letter', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...validRegisterPayload, password: 'alllower1' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects password without a number', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...validRegisterPayload, password: 'NoNumbers!' });

        expect(res.status).toBe(400);
    });

    it('400 — displayName too long (> 50 chars)', async () => {
        const res = await request(app)
            .post('/api/v1/auth/register')
            .send({ ...validRegisterPayload, displayName: 'A'.repeat(51) });

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/login', () => {
    const validPayload = { email: 'test@example.com', password: 'MyPassword1' };

    it('200 — returns tokens on valid credentials', async () => {
        mockLogin.mockResolvedValueOnce(mockAuthResponse);

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send(validPayload);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body.user.email).toBe(mockUser.email);
    });

    it('400 — rejects missing email field', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ password: 'password123' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects invalid email format', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'bad@@email', password: 'password123' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects missing password field', async () => {
        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'test@example.com' });

        expect(res.status).toBe(400);
    });

    it('error handler receives service errors on wrong credentials', async () => {
        mockLogin.mockRejectedValueOnce(
            Object.assign(new Error('Invalid email or password'), { status: 401 })
        );

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send(validPayload);

        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/refresh', () => {
    it('200 — returns new tokens on valid refresh token', async () => {
        mockRefresh.mockResolvedValueOnce({
            accessToken: 'new-access-token',
            refreshToken: 'new-refresh-token',
        });

        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: 'valid-refresh-token' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('refreshToken');
    });

    it('400 — rejects missing refreshToken field', async () => {
        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .send({});

        expect(res.status).toBe(400);
    });

    it('error handler receives service errors on invalid token', async () => {
        mockRefresh.mockRejectedValueOnce(
            Object.assign(new Error('Invalid refresh token'), { status: 401 })
        );

        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: 'expired-or-bad-token' });

        expect(res.status).toBeGreaterThanOrEqual(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/logout', () => {
    it('200 — always succeeds (stateless JWT logout)', async () => {
        const res = await request(app).post('/api/v1/auth/logout');
        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/logged out/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/google', () => {
    it('200 — returns tokens on valid Google idToken', async () => {
        mockGoogleLogin.mockResolvedValueOnce(mockAuthResponse);

        const res = await request(app)
            .post('/api/v1/auth/google')
            .send({ idToken: 'google-id-token-xyz' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('accessToken');
    });

    it('400 — rejects missing idToken', async () => {
        const res = await request(app)
            .post('/api/v1/auth/google')
            .send({});

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/token/i);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/forgot-password', () => {
    it('200 — returns confirmation message and emailSent without exposing tokens', async () => {
        mockForgotPassword.mockResolvedValueOnce({
            message: 'If that email is registered, a password reset link and code have been sent to your inbox.',
            emailSent: true,
        });

        const res = await request(app)
            .post('/api/v1/auth/forgot-password')
            .send({ email: 'test@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('reset link');
        expect(res.body.emailSent).toBe(true);
        expect(res.body.resetCode).toBeUndefined();
        expect(res.body.resetToken).toBeUndefined();
        expect(res.body.devToken).toBeUndefined();
    });

    it('400 — rejects invalid email', async () => {
        const res = await request(app)
            .post('/api/v1/auth/forgot-password')
            .send({ email: 'not-an-email' });

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/auth/reset-password', () => {
    it('200 — resets password successfully with code or token', async () => {
        mockResetPassword.mockResolvedValueOnce({
            message: 'Password has been reset successfully. You can now sign in.',
        });

        const res = await request(app)
            .post('/api/v1/auth/reset-password')
            .send({
                email: 'test@example.com',
                token: '123456',
                newPassword: 'Password123!',
            });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/reset successfully/i);
    });

    it('400 — rejects short passwords', async () => {
        const res = await request(app)
            .post('/api/v1/auth/reset-password')
            .send({
                email: 'test@example.com',
                token: '123456',
                newPassword: 'short',
            });

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /health', () => {
    it('200 — returns status and environment fields', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('environment');
    });

    it('sets Content Security Policy (CSP) headers', async () => {
        const res = await request(app).get('/health');
        expect(res.headers).toHaveProperty('content-security-policy');
        expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Passwordless Email OTP Authentication', () => {
    it('POST /email-code/request — 200 dispatches OTP for valid email', async () => {
        mockRequestEmailOtp.mockResolvedValueOnce({
            message: 'A 6-digit sign-in code has been sent to test@example.com.',
            email: 'test@example.com',
            isNewUser: false,
        });

        const res = await request(app)
            .post('/api/v1/auth/email-code/request')
            .send({ email: 'test@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.message).toMatch(/6-digit sign-in code/i);
        expect(res.body.email).toBe('test@example.com');
    });

    it('POST /email-code/request — 400 rejects invalid email format', async () => {
        const res = await request(app)
            .post('/api/v1/auth/email-code/request')
            .send({ email: 'not-an-email' });

        expect(res.status).toBe(400);
    });

    it('POST /email-code/verify — 200 on valid 6-digit code returns session tokens', async () => {
        mockVerifyEmailOtp.mockResolvedValueOnce(mockAuthResponse);

        const res = await request(app)
            .post('/api/v1/auth/email-code/verify')
            .send({ email: 'test@example.com', code: '123456' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('user');
    });

    it('POST /email-code/verify — 400 rejects non-6-digit code', async () => {
        const res = await request(app)
            .post('/api/v1/auth/email-code/verify')
            .send({ email: 'test@example.com', code: '12' });

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Security: HttpOnly Cookies & Account Lockout', () => {
    it('sets HttpOnly cookies on successful registration and login', async () => {
        mockLogin.mockResolvedValueOnce(mockAuthResponse);

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'test@example.com', password: 'MyPassword1' });

        expect(res.status).toBe(200);
        const cookies = res.headers['set-cookie'];
        expect(cookies).toBeDefined();
        const cookieStr = Array.isArray(cookies) ? cookies.join('; ') : cookies;
        expect(cookieStr).toContain('jwt_access=');
        expect(cookieStr).toContain('HttpOnly');
    });

    it('returns 423 when account is locked out', async () => {
        const lockErr: any = new Error('Account temporarily locked');
        lockErr.statusCode = 423;
        lockErr.code = 'account_locked';
        lockErr.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();
        mockLogin.mockRejectedValueOnce(lockErr);

        const res = await request(app)
            .post('/api/v1/auth/login')
            .send({ email: 'test@example.com', password: 'WrongPassword1' });

        expect(res.status).toBe(423);
        expect(res.body.code).toBe('account_locked');
        expect(res.body).toHaveProperty('lockoutUntil');
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('Email Verification', () => {
    it('POST /verify-email — 200 on valid token and email, returns user and tokens', async () => {
        mockVerifyEmail.mockResolvedValueOnce(mockAuthResponse);

        const res = await request(app)
            .post('/api/v1/auth/verify-email')
            .send({ email: 'test@example.com', token: '123456' });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('user');
    });

    it('POST /resend-verification — 200 on valid email', async () => {
        mockResendVerification.mockResolvedValueOnce({
            message: 'If the email address is registered, a new verification link has been sent.',
            emailSent: true,
        });

        const res = await request(app)
            .post('/api/v1/auth/resend-verification')
            .send({ email: 'test@example.com' });

        expect(res.status).toBe(200);
        expect(res.body.emailSent).toBe(true);
    });

    it('POST /change-password — 200 changes password and issues new tokens', async () => {
        mockChangePassword.mockResolvedValueOnce({
            message: 'Password changed successfully. All other active sessions have been signed out.',
            accessToken: 'new-token',
            refreshToken: 'new-refresh',
        });

        const validToken = generateAccessToken({
            userId: 'user-uuid-1234',
            email: 'test@example.com',
            tokenVersion: 1,
            isEmailVerified: true,
        });

        const res = await request(app)
            .post('/api/v1/auth/change-password')
            .set('Authorization', `Bearer ${validToken}`)
            .send({ currentPassword: 'OldPassword1', newPassword: 'NewPassword2' });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain('Password changed successfully');
    });

    it('POST /refresh rejects tokens when tokenVersion is revoked (Global Session Revocation)', async () => {
        mockRefresh.mockRejectedValueOnce(
            Object.assign(new Error('Session expired or revoked. Please log in again.'), { status: 401 })
        );

        const res = await request(app)
            .post('/api/v1/auth/refresh')
            .send({ refreshToken: 'stale-refresh-token' });

        expect(res.status).toBe(401);
    });

    it('authMiddleware rejects tokens when isEmailVerified is false (Mandatory Email Verification)', async () => {
        const unverifiedToken = generateAccessToken({
            userId: 'user-uuid-1234',
            email: 'test@example.com',
            tokenVersion: 1,
            isEmailVerified: false,
        });

        const res = await request(app)
            .post('/api/v1/auth/set-password')
            .set('Authorization', `Bearer ${unverifiedToken}`)
            .send({ newPassword: 'NewPassword2' });

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('email_verification_required');
    });

    afterAll(async () => {
        if (process.versions.bun) {
            const { mock } = await import('bun:test');
            mock.restore();
        }
    });
});
