import request from 'supertest';
import jwt from 'jsonwebtoken';
import { db } from '../src/db/index.js';
import { users, follows, entries, likes, comments, notifications } from '../src/db/schema.js';
import { eq, and } from 'drizzle-orm';
import app from '../src/app.js';

describe('Follow System Integration Tests', () => {
    let userA: any;
    let userB: any; // Public User
    let userC: any; // Private User
    let userD: any; // Non-follower
    let tokenA: string;
    let tokenD: string;

    const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_123';

    beforeAll(async () => {
        // Clean database (order matters due to foreign keys)
        await db.delete(notifications);
        await db.delete(comments);
        await db.delete(likes);
        await db.delete(entries);
        await db.delete(follows);
        await db.delete(users);

        // Create Users
        const [uA] = await db.insert(users).values({
            username: 'test_a',
            email: 'a@test.com',
            passwordHash: 'hash',
            displayName: 'User A'
        }).returning();
        userA = uA;

        const [uB] = await db.insert(users).values({
            username: 'test_b',
            email: 'b@test.com',
            passwordHash: 'hash',
            displayName: 'Public User B',
            isPrivate: false
        }).returning();
        userB = uB;

        const [uC] = await db.insert(users).values({
            username: 'test_c',
            email: 'c@test.com',
            passwordHash: 'hash',
            displayName: 'Private User C',
            isPrivate: true
        }).returning();
        userC = uC;

        const [uD] = await db.insert(users).values({
            username: 'test_d',
            email: 'd@test.com',
            passwordHash: 'hash'
        }).returning();
        userD = uD;

        // Generate Tokens
        tokenA = jwt.sign({ userId: userA.id, email: userA.email }, JWT_SECRET, { expiresIn: '1h' });
        tokenD = jwt.sign({ userId: userD.id, email: userD.email }, JWT_SECRET, { expiresIn: '1h' });
    });

    afterAll(async () => {
        // No explicit disconnect needed for drizzle-orm/postgres-js in this setup
    });

    describe('POST /api/v1/follows/:id', () => {
        it('should allow User A to follow User B', async () => {
            const res = await request(app)
                .post(`/api/v1/follows/${userB.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(201);
            expect(res.body.message).toMatch(/successfully/i);

            // Verify DB
            const [follow] = await db.select().from(follows).where(
                and(
                    eq(follows.followerId, userA.id),
                    eq(follows.followingId, userB.id)
                )
            );
            expect(follow).toBeTruthy();
        });

        it('should prevent following yourself', async () => {
            const res = await request(app)
                .post(`/api/v1/follows/${userA.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(400);
        });

        it('should prevent following someone twice', async () => {
            const res = await request(app)
                .post(`/api/v1/follows/${userB.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(400);
        });
    });

    describe('DELETE /api/v1/follows/:id', () => {
        it('should allow User A to unfollow User B', async () => {
            const res = await request(app)
                .delete(`/api/v1/follows/${userB.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(200);

            // Verify DB
            const [follow] = await db.select().from(follows).where(
                and(
                    eq(follows.followerId, userA.id),
                    eq(follows.followingId, userB.id)
                )
            );
            expect(follow).toBeUndefined();
        });

        it('should return 404 if not following', async () => {
            const res = await request(app)
                .delete(`/api/v1/follows/${userB.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(404);
        });
    });

    describe('Private Account Logic (GET /entries)', () => {
        it('should block non-follower (User D) from viewing private user (User C) entries', async () => {
            const res = await request(app)
                .get(`/api/v1/entries?userId=${userC.id}`)
                .set('Authorization', `Bearer ${tokenD}`);

            expect(res.status).toBe(403);
            expect(res.body.error).toMatch(/private/i);
        });

        it('should allow follower (User A) to view private user (User C) entries', async () => {
            // First follow C
            await db.insert(follows).values({
                followerId: userA.id,
                followingId: userC.id
            });

            const res = await request(app)
                .get(`/api/v1/entries?userId=${userC.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.entries)).toBe(true);
        });
    });

    describe('Feed Consistency', () => {
        it('should show followed user entries in feed', async () => {
            // User C creates an entry
            await db.insert(entries).values({
                userId: userC.id,
                tmdbId: 100, // Dummy
                title: 'Test Entry',
                type: 'MOVIE',
                watchedAt: new Date()
            });

            // User A (follows C) fetches feed
            const res = await request(app)
                .get('/api/v1/feed')
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(200);
            const feedItems = res.body.items;
            const entryItem = feedItems.find((item: any) => item.type === 'ENTRY' && item.data.title === 'Test Entry');
            expect(entryItem).toBeDefined();
        });
    });
});
