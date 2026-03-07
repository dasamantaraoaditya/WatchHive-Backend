import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import app from '../src/app';

const prisma = new PrismaClient();

describe('Follow System Integration Tests', () => {
    let userA: any;
    let userB: any; // Public User
    let userC: any; // Private User
    let userD: any; // Non-follower
    let tokenA: string;
    let tokenD: string;

    const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_key_123';

    beforeAll(async () => {
        // Clean database
        await prisma.notification.deleteMany();
        await prisma.comment.deleteMany();
        await prisma.like.deleteMany();
        await prisma.entry.deleteMany();
        await prisma.follow.deleteMany();
        await prisma.user.deleteMany();

        // Create Users
        userA = await prisma.user.create({
            data: { username: 'test_a', email: 'a@test.com', passwordHash: 'hash', displayName: 'User A' }
        });
        userB = await prisma.user.create({
            data: { username: 'test_b', email: 'b@test.com', passwordHash: 'hash', displayName: 'Public User B', isPrivate: false }
        });
        userC = await prisma.user.create({
            data: { username: 'test_c', email: 'c@test.com', passwordHash: 'hash', displayName: 'Private User C', isPrivate: true }
        });
        userD = await prisma.user.create({
            data: { username: 'test_d', email: 'd@test.com', passwordHash: 'hash' }
        });

        // Generate Tokens
        tokenA = jwt.sign({ userId: userA.id, email: userA.email }, JWT_SECRET, { expiresIn: '1h' });
        tokenD = jwt.sign({ userId: userD.id, email: userD.email }, JWT_SECRET, { expiresIn: '1h' });
    });

    afterAll(async () => {
        await prisma.$disconnect();
    });

    describe('POST /api/v1/follows/:id', () => {
        it('should allow User A to follow User B', async () => {
            const res = await request(app)
                .post(`/api/v1/follows/${userB.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(201);
            expect(res.body.message).toMatch(/successfully/i);

            // Verify DB
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: userA.id, followingId: userB.id } }
            });
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

            expect(res.status).toBe(400); // Or 409 Conflict
        });
    });

    describe('DELETE /api/v1/follows/:id', () => {
        it('should allow User A to unfollow User B', async () => {
            const res = await request(app)
                .delete(`/api/v1/follows/${userB.id}`)
                .set('Authorization', `Bearer ${tokenA}`);

            expect(res.status).toBe(200);

            // Verify DB
            const follow = await prisma.follow.findUnique({
                where: { followerId_followingId: { followerId: userA.id, followingId: userB.id } }
            });
            expect(follow).toBeNull();
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
            await prisma.follow.create({
                data: { followerId: userA.id, followingId: userC.id }
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
            await prisma.entry.create({
                data: {
                    userId: userC.id,
                    tmdbId: 100, // Dummy
                    title: 'Test Entry',
                    type: 'MOVIE',
                    watchedAt: new Date()
                }
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
