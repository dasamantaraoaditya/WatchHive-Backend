/**
 * Entries Routes — Unit Tests
 * Uses jest.unstable_mockModule (ESM-native) + dynamic import for correct hoisting.
 * Covers: auth middleware guard + all input validation rules.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

// ─── Mock functions ───────────────────────────────────────────────────────────

const mockCheckDb = jest.fn<() => Promise<boolean>>();
const mockAwardXp = jest.fn();
const mockTmdbMovie = jest.fn();
const mockTmdbTv = jest.fn();

// ─── ESM module mocks ─────────────────────────────────────────────────────────

await jest.unstable_mockModule('../src/db/index.js', () => ({
    db: {},
    checkDbHealth: mockCheckDb,
}));

await jest.unstable_mockModule('../src/config/swagger.js', () => ({ default: {} }));

await jest.unstable_mockModule('../src/services/xp.service.js', () => ({
    xpService: { awardXp: mockAwardXp },
    XpAction: { LOG_WATCH: 'LOG_WATCH', WRITE_REVIEW: 'WRITE_REVIEW' },
}));

await jest.unstable_mockModule('../src/services/tmdb.service.js', () => ({
    default: { getMovieDetails: mockTmdbMovie, getTVShowDetails: mockTmdbTv },
}));

await jest.unstable_mockModule('../src/services/auth.service.js', () => ({
    authService: { register: jest.fn(), login: jest.fn(), refresh: jest.fn() },
}));

await jest.unstable_mockModule('../src/services/google-auth.service.js', () => ({
    googleAuthService: { loginOrRegister: jest.fn() },
}));

await jest.unstable_mockModule('../src/services/notification.service.js', () => ({
    notificationService: { createNotification: jest.fn(), getNotifications: jest.fn(), markAsRead: jest.fn(), markAllAsRead: jest.fn(), getUnreadCount: jest.fn() },
    default: { createNotification: jest.fn(), getNotifications: jest.fn(), markAsRead: jest.fn(), markAllAsRead: jest.fn(), getUnreadCount: jest.fn() },
}));

// ─── Dynamic imports after mocks ─────────────────────────────────────────────

const { default: request } = await import('supertest');
const { default: app } = await import('../src/app.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
const VALID_UUID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeToken(userId = TEST_USER_ID): string {
    return jwt.sign({ userId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

const authHeader = `Bearer ${makeToken()}`;

beforeEach(() => {
    jest.clearAllMocks();
    mockCheckDb.mockResolvedValue(true);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Auth middleware — entries routes', () => {
    it('401 — GET /entries without token', async () => {
        const res = await request(app).get('/api/v1/entries');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/token/i);
    });

    it('401 — POST /entries without token', async () => {
        const res = await request(app).post('/api/v1/entries').send({});
        expect(res.status).toBe(401);
    });

    it('401 — GET /entries with malformed token', async () => {
        const res = await request(app)
            .get('/api/v1/entries')
            .set('Authorization', 'Bearer this.is.not.valid');
        expect(res.status).toBe(401);
        expect(res.body.error).toMatch(/invalid|expired/i);
    });

    it('401 — DELETE /entries/:id without token', async () => {
        const res = await request(app).delete(`/api/v1/entries/${VALID_UUID}`);
        expect(res.status).toBe(401);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/entries — input validation', () => {
    it('400 — missing required field: title', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, type: 'MOVIE' });

        expect(res.status).toBe(400);
        expect(res.body.errors).toBeDefined();
    });

    it('400 — missing required field: type', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, title: 'Test Movie' });

        expect(res.status).toBe(400);
    });

    it('400 — missing required field: tmdbId', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ title: 'Test Movie', type: 'MOVIE' });

        expect(res.status).toBe(400);
    });

    it('400 — invalid entry type (not MOVIE | TV_SHOW | EPISODE)', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, title: 'Test', type: 'ANIME' });

        expect(res.status).toBe(400);
    });

    it('400 — rating above max (> 10)', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, title: 'Test', type: 'MOVIE', rating: 11 });

        expect(res.status).toBe(400);
    });

    it('400 — rating below min (< 0)', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, title: 'Test', type: 'MOVIE', rating: -1 });

        expect(res.status).toBe(400);
    });

    it('400 — invalid watchedAt date string', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, title: 'Test', type: 'MOVIE', watchedAt: 'not-a-date' });

        expect(res.status).toBe(400);
    });

    it('400 — tags must be an array, not a string', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, title: 'Test', type: 'MOVIE', tags: 'action' });

        expect(res.status).toBe(400);
    });

    it('400 — tmdbId must be an integer, not a string', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 'abc', title: 'Test', type: 'MOVIE' });

        expect(res.status).toBe(400);
    });

    it('400 — isRewatch must be boolean', async () => {
        const res = await request(app)
            .post('/api/v1/entries')
            .set('Authorization', authHeader)
            .send({ tmdbId: 550, title: 'Test', type: 'MOVIE', isRewatch: 'yes' });

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/entries/:id — param validation', () => {
    it('400 — rejects non-UUID id param', async () => {
        const res = await request(app)
            .get('/api/v1/entries/not-a-uuid')
            .set('Authorization', authHeader);

        expect(res.status).toBe(400);
    });

    it('400 — rejects numeric id param', async () => {
        const res = await request(app)
            .get('/api/v1/entries/12345')
            .set('Authorization', authHeader);

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('PUT /api/v1/entries/:id — param & body validation', () => {
    it('400 — rejects non-UUID id param', async () => {
        const res = await request(app)
            .put('/api/v1/entries/not-a-uuid')
            .set('Authorization', authHeader)
            .send({ title: 'Updated' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects empty title string (whitespace only)', async () => {
        const res = await request(app)
            .put(`/api/v1/entries/${VALID_UUID}`)
            .set('Authorization', authHeader)
            .send({ title: '   ' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects invalid type on update', async () => {
        const res = await request(app)
            .put(`/api/v1/entries/${VALID_UUID}`)
            .set('Authorization', authHeader)
            .send({ type: 'CARTOON' });

        expect(res.status).toBe(400);
    });

    it('400 — rejects rating > 10 on update', async () => {
        const res = await request(app)
            .put(`/api/v1/entries/${VALID_UUID}`)
            .set('Authorization', authHeader)
            .send({ rating: 11 });

        expect(res.status).toBe(400);
    });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/entries/:id — param validation', () => {
    it('400 — rejects non-UUID id param', async () => {
        const res = await request(app)
            .delete('/api/v1/entries/bad-id')
            .set('Authorization', authHeader);

        expect(res.status).toBe(400);
    });

    it('400 — rejects numeric id param', async () => {
        const res = await request(app)
            .delete('/api/v1/entries/99999')
            .set('Authorization', authHeader);

        expect(res.status).toBe(400);
    });
});
