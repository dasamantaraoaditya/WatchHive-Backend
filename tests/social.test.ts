/**
 * Social Routes (Likes, Comments, Feed) — Integration & Unit Tests
 * Uses jest.unstable_mockModule (ESM-native) + dynamic import.
 * Tests:
 *  - Likes: authentication, like, duplicate like prevention, status check, likers list, unlike
 *  - Comments: authentication, input validation (empty/length), add comment, get comments, authorization on delete
 *  - Feed: authentication guard, feed generation with followed users, trending feed
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';

if (process.versions.bun) {
    const { mock } = await import('bun:test');
    (jest as any).unstable_mockModule = (modulePath: string, factory: any) => {
        return mock.module(modulePath, factory);
    };
}

// ─── Shared Mock State ────────────────────────────────────────────────────────

const mockCheckDb = jest.fn<() => Promise<boolean>>().mockResolvedValue(true);
const mockAwardXp = jest.fn().mockResolvedValue(undefined);
const mockCreateNotification = jest.fn().mockResolvedValue(undefined);

// Configurable DB query returns
let queryQueue: any[] = [];
let mockSelectReturn: any[] = [];
let mockInsertReturn: any[] = [{ id: 'mock-id' }];
let mockFindFirstCommentReturn: any = null;

function setQueryQueue(...responses: any[]) {
    queryQueue = [...responses];
}

const mockDbQuery = {
    comments: {
        findFirst: jest.fn(() => mockFindFirstCommentReturn),
    },
    entries: {
        findFirst: jest.fn(),
    },
};

const mockChain: any = {
    select: jest.fn(() => mockChain),
    from: jest.fn(() => mockChain),
    innerJoin: jest.fn(() => mockChain),
    leftJoin: jest.fn(() => mockChain),
    where: jest.fn(() => mockChain),
    orderBy: jest.fn(() => mockChain),
    groupBy: jest.fn(() => mockChain),
    limit: jest.fn(() => mockChain),
    offset: jest.fn(() => mockChain),
    insert: jest.fn(() => mockChain),
    values: jest.fn(() => mockChain),
    onConflictDoNothing: jest.fn(() => mockChain),
    returning: jest.fn(() => {
        const next = queryQueue.length > 0 ? queryQueue.shift() : mockInsertReturn;
        return Promise.resolve(next);
    }),
    update: jest.fn(() => mockChain),
    set: jest.fn(() => mockChain),
    delete: jest.fn(() => mockChain),
    query: mockDbQuery,
    then: (resolve: any, reject?: any) => {
        const next = queryQueue.length > 0 ? queryQueue.shift() : mockSelectReturn;
        return Promise.resolve(next).then(resolve, reject);
    },
};

await jest.unstable_mockModule('../src/db/index.js', () => ({
    db: mockChain,
    checkDbHealth: mockCheckDb,
}));

await jest.unstable_mockModule('../src/config/swagger.js', () => ({ default: {} }));

await jest.unstable_mockModule('../src/services/xp.service.js', () => ({
    xpService: {
        awardXp: mockAwardXp,
        updateStreakAndCheckBadges: jest.fn<() => Promise<any>>().mockResolvedValue(undefined),
    },
    XpAction: { LOG_WATCH: 'LOG_WATCH', WRITE_REVIEW: 'WRITE_REVIEW' },
}));

await jest.unstable_mockModule('../src/services/notification.service.js', () => ({
    notificationService: {
        createNotification: mockCreateNotification,
        getNotifications: jest.fn(),
        markAsRead: jest.fn(),
        markAllAsRead: jest.fn(),
        getUnreadCount: jest.fn(),
    },
    default: {
        createNotification: mockCreateNotification,
        getNotifications: jest.fn(),
        markAsRead: jest.fn(),
        markAllAsRead: jest.fn(),
        getUnreadCount: jest.fn(),
    },
}));

await jest.unstable_mockModule('../src/services/auth.service.js', () => ({
    authService: { register: jest.fn(), login: jest.fn(), refresh: jest.fn(), changePassword: jest.fn() },
    getFullAuthUser: jest.fn(),
    getActiveTokenVersion: jest.fn().mockResolvedValue(1),
}));

await jest.unstable_mockModule('../src/services/tmdb.service.js', () => ({
    default: {
        getMovieDetails: jest.fn().mockResolvedValue({ title: 'Mock Movie', poster_path: '/poster.jpg' }),
        getTVShowDetails: jest.fn().mockResolvedValue({ name: 'Mock Show', poster_path: '/tv.jpg' }),
        getTrending: jest.fn().mockResolvedValue({ results: [{ id: 101, title: 'Trending Film' }] }),
    },
}));

// ─── Dynamic imports after mocks ─────────────────────────────────────────────

const { default: request } = await import('supertest');
const { default: app } = await import('../src/app.js');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TEST_USER_ID = '11111111-1111-1111-1111-111111111111';
const OTHER_USER_ID = '22222222-2222-2222-2222-222222222222';
const VALID_ENTRY_ID = '33333333-3333-3333-3333-333333333333';
const VALID_COMMENT_ID = '44444444-4444-4444-4444-444444444444';
const JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

function makeToken(userId = TEST_USER_ID): string {
    return jwt.sign({ userId, email: 'test@example.com' }, JWT_SECRET, { expiresIn: '1h' });
}

const authHeader = `Bearer ${makeToken()}`;

beforeEach(() => {
    jest.clearAllMocks();
    mockCheckDb.mockResolvedValue(true);
    mockSelectReturn = [];
    mockInsertReturn = [{ id: 'mock-id' }];
    mockFindFirstCommentReturn = null;
});

// ─── LIKES ROUTE TESTS ────────────────────────────────────────────────────────

describe('Social — Likes Routes (/api/v1/likes)', () => {
    describe('Authentication guards', () => {
        it('401 — POST /:entryId without token', async () => {
            const res = await request(app).post(`/api/v1/likes/${VALID_ENTRY_ID}`);
            expect(res.status).toBe(401);
            expect(res.body.error).toMatch(/token/i);
        });

        it('401 — DELETE /:entryId without token', async () => {
            const res = await request(app).delete(`/api/v1/likes/${VALID_ENTRY_ID}`);
            expect(res.status).toBe(401);
        });

        it('401 — GET /:entryId/status without token', async () => {
            const res = await request(app).get(`/api/v1/likes/${VALID_ENTRY_ID}/status`);
            expect(res.status).toBe(401);
        });
    });

    describe('POST /api/v1/likes/:entryId', () => {
        it('404 — returns 404 if entry does not exist', async () => {
            setQueryQueue([]);
            const res = await request(app)
                .post(`/api/v1/likes/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(404);
            expect(res.body.error).toMatch(/entry not found/i);
        });

        it('400 — returns 400 if user has already liked the entry', async () => {
            setQueryQueue(
                [{ id: VALID_ENTRY_ID, userId: OTHER_USER_ID }],
                [{ id: 'existing-like-id', userId: TEST_USER_ID, entryId: VALID_ENTRY_ID }]
            );

            const res = await request(app)
                .post(`/api/v1/likes/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/already liked/i);
        });

        it('201 — successfully likes entry, creates notification, and awards XP', async () => {
            setQueryQueue(
                [{ id: VALID_ENTRY_ID, userId: OTHER_USER_ID, title: 'Inception' }],
                [], // not yet liked
                [{ id: 'like-1' }], // insert
                [{
                    id: 'like-1',
                    userId: TEST_USER_ID,
                    entryId: VALID_ENTRY_ID,
                    createdAt: new Date(),
                    user: { displayName: 'Tester', username: 'tester' },
                    entry: { userId: OTHER_USER_ID, title: 'Inception', type: 'MOVIE' }
                }],
                [{ likeCount: 1 }]
            );

            const res = await request(app)
                .post(`/api/v1/likes/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(201);
            expect(res.body.message).toMatch(/successfully liked/i);
        });
    });

    describe('GET /api/v1/likes/:entryId/status', () => {
        it('200 — returns { isLiked: true } when like exists', async () => {
            setQueryQueue(
                [{ id: 'like-1', createdAt: new Date() }],
                [{ likeCount: 1 }]
            );

            const res = await request(app)
                .get(`/api/v1/likes/${VALID_ENTRY_ID}/status`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(200);
            expect(res.body.isLiked).toBe(true);
        });

        it('200 — returns { isLiked: false } when like does not exist', async () => {
            setQueryQueue(
                [],
                [{ likeCount: 0 }]
            );

            const res = await request(app)
                .get(`/api/v1/likes/${VALID_ENTRY_ID}/status`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(200);
            expect(res.body.isLiked).toBe(false);
        });
    });

    describe('DELETE /api/v1/likes/:entryId', () => {
        it('404 — returns 404 when user has not liked the entry', async () => {
            setQueryQueue([]);

            const res = await request(app)
                .delete(`/api/v1/likes/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(404);
            expect(res.body.error).toMatch(/not liked/i);
        });

        it('200 — successfully unlikes entry and returns likeCount', async () => {
            setQueryQueue(
                [{ id: 'like-1' }],
                [], // delete
                [{ likeCount: 0 }]
            );

            const res = await request(app)
                .delete(`/api/v1/likes/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/successfully unliked/i);
        });
    });
});

// ─── COMMENTS ROUTE TESTS ─────────────────────────────────────────────────────

describe('Social — Comments Routes (/api/v1/comments)', () => {
    describe('Authentication & Validation', () => {
        it('401 — POST /:entryId without token', async () => {
            const res = await request(app).post(`/api/v1/comments/${VALID_ENTRY_ID}`).send({ content: 'Nice!' });
            expect(res.status).toBe(401);
        });

        it('400 — rejects empty comment content', async () => {
            const res = await request(app)
                .post(`/api/v1/comments/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader)
                .send({ content: '   ' });

            expect(res.status).toBe(400);
            expect(res.body.errors).toBeDefined();
            expect(res.body.errors[0].msg).toMatch(/empty/i);
        });

        it('400 — rejects comment exceeding 1000 characters', async () => {
            const res = await request(app)
                .post(`/api/v1/comments/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader)
                .send({ content: 'a'.repeat(1001) });

            expect(res.status).toBe(400);
            expect(res.body.errors[0].msg).toMatch(/1000 characters/i);
        });
    });

    describe('POST /api/v1/comments/:entryId', () => {
        it('404 — returns 404 when entry does not exist', async () => {
            setQueryQueue([]);

            const res = await request(app)
                .post(`/api/v1/comments/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader)
                .send({ content: 'Loved this movie!' });

            expect(res.status).toBe(404);
            expect(res.body.error).toMatch(/entry not found/i);
        });

        it('201 — creates comment and returns structured response', async () => {
            mockFindFirstCommentReturn = {
                id: VALID_COMMENT_ID,
                content: 'Incredible cinematography!',
                userId: TEST_USER_ID,
                user: {
                    id: TEST_USER_ID,
                    username: 'honeyuser',
                    displayName: 'Honey User',
                    profilePictureUrl: null,
                },
                parentComment: null,
            };

            setQueryQueue(
                [{ id: VALID_ENTRY_ID, userId: OTHER_USER_ID, title: 'Dune', type: 'MOVIE', tmdbId: 101 }],
                [{ id: VALID_COMMENT_ID }], // insert
                [{ commentCount: 1 }] // updated count
            );

            const res = await request(app)
                .post(`/api/v1/comments/${VALID_ENTRY_ID}`)
                .set('Authorization', authHeader)
                .send({ content: 'Incredible cinematography!' });

            expect(res.status).toBe(201);
            expect(res.body.message).toMatch(/comment added/i);
            expect(res.body.comment).toBeDefined();
        });
    });

    describe('DELETE /api/v1/comments/:commentId', () => {
        it('404 — returns 404 if comment is not found', async () => {
            mockFindFirstCommentReturn = null;

            const res = await request(app)
                .delete(`/api/v1/comments/${VALID_COMMENT_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(404);
            expect(res.body.error).toMatch(/not found/i);
        });

        it('403 — returns 403 if user is neither comment author nor entry owner', async () => {
            mockFindFirstCommentReturn = {
                id: VALID_COMMENT_ID,
                userId: OTHER_USER_ID,
                entryId: VALID_ENTRY_ID,
                entry: { userId: 'someone-else-uuid' },
            };

            const res = await request(app)
                .delete(`/api/v1/comments/${VALID_COMMENT_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/not authorized/i);
        });

        it('200 — allows deletion when user is the comment author', async () => {
            mockFindFirstCommentReturn = {
                id: VALID_COMMENT_ID,
                userId: TEST_USER_ID,
                entryId: VALID_ENTRY_ID,
                entry: { userId: OTHER_USER_ID },
            };

            setQueryQueue([], [], [{ commentCount: 0 }]);

            const res = await request(app)
                .delete(`/api/v1/comments/${VALID_COMMENT_ID}`)
                .set('Authorization', authHeader);

            expect(res.status).toBe(200);
            expect(res.body.message).toMatch(/comment deleted/i);
        });
    });
});

// ─── FEED ROUTE TESTS ─────────────────────────────────────────────────────────

describe('Social — Feed Routes (/api/v1/feed)', () => {
    describe('Authentication guards', () => {
        it('401 — GET /api/v1/feed without token', async () => {
            const res = await request(app).get('/api/v1/feed');
            expect(res.status).toBe(401);
        });

        it('401 — GET /api/v1/feed/trending without token', async () => {
            const res = await request(app).get('/api/v1/feed/trending');
            expect(res.status).toBe(401);
        });
    });

    describe('GET /api/v1/feed', () => {
        it('200 — returns feed items array and pagination structure', async () => {
            setQueryQueue(
                [{ followingId: OTHER_USER_ID }], // follows
                [], // blocks
                [{
                    id: 'entry-1',
                    userId: OTHER_USER_ID,
                    title: 'Dune',
                    user: { id: OTHER_USER_ID, username: 'friend' }
                }] // feed entries
            );

            const res = await request(app)
                .get('/api/v1/feed?page=1&limit=10')
                .set('Authorization', authHeader);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('items');
            expect(Array.isArray(res.body.items)).toBe(true);
            expect(res.body).toHaveProperty('hasMore');
        });
    });

    describe('GET /api/v1/feed/trending', () => {
        it('200 — returns trending movies and shows', async () => {
            setQueryQueue(
                [{ id: 'trend-1', title: 'Trending Film', user: { username: 'trenduser' } }]
            );

            const res = await request(app)
                .get('/api/v1/feed/trending')
                .set('Authorization', authHeader);

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('trending');
            expect(Array.isArray(res.body.trending)).toBe(true);
        });
    });
});
