/**
 * Auth Routes — Unit Tests
 * Uses jest.unstable_mockModule (ESM-native) + dynamic import for correct hoisting.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { AuthResponse } from '../src/services/auth.service.js';

// ─── Mock functions ───────────────────────────────────────────────────────────

const mockRegister = jest.fn<() => Promise<AuthResponse>>();
const mockLogin = jest.fn<() => Promise<AuthResponse>>();
const mockRefresh = jest.fn<() => Promise<{ accessToken: string; refreshToken: string }>>();
const mockGoogleLogin = jest.fn<() => Promise<AuthResponse>>();
const mockCheckDb = jest.fn<() => Promise<boolean>>();

// ─── ESM module mocks (must come before dynamic imports) ─────────────────────

await jest.unstable_mockModule('../src/services/auth.service.js', () => ({
    authService: { register: mockRegister, login: mockLogin, refresh: mockRefresh },
}));

await jest.unstable_mockModule('../src/services/google-auth.service.js', () => ({
    googleAuthService: { loginOrRegister: mockGoogleLogin },
}));

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
    it('201 — returns user + tokens on valid registration', async () => {
        mockRegister.mockResolvedValueOnce(mockAuthResponse);

        const res = await request(app)
            .post('/api/v1/auth/register')
            .send(validRegisterPayload);

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('accessToken');
        expect(res.body).toHaveProperty('refreshToken');
        expect(res.body.user.username).toBe(mockUser.username);
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

describe('GET /health', () => {
    it('200 — returns status and environment fields', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('status');
        expect(res.body).toHaveProperty('environment');
    });
});
